#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { canonicalDigest, hashArtifact, sha256, snapshotArtifact } from "../integrity.mjs";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "../identity.mjs";

const CONTRACT = "killsloprouter-playwright-v1";
const ACTION_TYPES = new Set(["click", "fill", "press", "check", "uncheck", "select", "hover", "wait-for"]);
const ASSERTION_TYPES = new Set([
  "visible", "hidden", "text", "value", "checked", "url", "count", "no-overlap", "no-clipping",
  "computed-style"
]);
const SCENARIO_KEYS = new Set(["id", "path", "actions", "assertions"]);
const ACTION_KEYS = new Set(["type", "locator", "value"]);
const ASSERTION_KEYS = new Set(["type", "locator", "property", "value"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const VISUAL_COMPARISON = Object.freeze({
  comparator: "pixelmatch",
  threshold: 0.2,
  maxDiffPixels: 0
});
const CHILD_AUTHORITY_KEYS = new Set([
  "playwright_child_authority_version",
  "runtime_digest",
  "runtime_source_physical_identity_digest",
  "runtime_seal_physical_identity_digest",
  "scenario",
  "baselines",
  "authority_digest"
]);
const RUNTIME_PACKAGES = Object.freeze({
  "axe-core": "4.13.0",
  "playwright-core": "1.62.1"
});

function runtimePackagePath(runtimeRoot, packageName) {
  return path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
}

function runtimeDigest(runtimeRoot) {
  const packages = {};
  for (const [packageName, expectedVersion] of Object.entries(RUNTIME_PACKAGES)) {
    const directory = runtimePackagePath(runtimeRoot, packageName);
    const metadata = JSON.parse(fs.readFileSync(path.join(directory, "package.json"), "utf8"));
    requireValue(metadata.version === expectedVersion,
      `sealed runtime package ${packageName} version mismatch`);
    packages[packageName] = {
      version: metadata.version,
      digest: hashArtifact(directory, { ignores: [] })
    };
  }
  return canonicalDigest({ playwright_runtime_version: 1, packages });
}

function runtimePhysicalIdentityDigest(runtimeRoot) {
  const packages = {};
  for (const packageName of Object.keys(RUNTIME_PACKAGES)) {
    const directory = runtimePackagePath(runtimeRoot, packageName);
    packages[packageName] = snapshotArtifact(directory, {
      root: path.dirname(directory),
      ignores: []
    }).physical_identity_digest;
  }
  return canonicalDigest({
    playwright_runtime_physical_identity_version: 1,
    packages
  });
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function validateScenarioDocument(value) {
  requireValue(value?.playwright_scenario_version === 1, "playwright_scenario_version must be 1");
  requireValue(Array.isArray(value.scenarios) && value.scenarios.length > 0 && value.scenarios.length <= 50,
    "Playwright scenarios must contain between 1 and 50 entries");
  const ids = new Set();
  for (const scenario of value.scenarios) {
    requireValue(scenario && typeof scenario === "object" && !Array.isArray(scenario),
      "each Playwright scenario must be an object");
    for (const key of Object.keys(scenario)) {
      requireValue(SCENARIO_KEYS.has(key), `Playwright scenario contains unsupported field: ${key}`);
    }
    requireValue(typeof scenario.id === "string" && /^[A-Za-z0-9._-]+$/.test(scenario.id),
      "each Playwright scenario requires a safe id");
    requireValue(!ids.has(scenario.id), `duplicate Playwright scenario id: ${scenario.id}`);
    ids.add(scenario.id);
    requireValue(typeof scenario.path === "string" && scenario.path.startsWith("/"),
      `Playwright scenario ${scenario.id} path must start with /`);
    requireValue(Array.isArray(scenario.actions || []) && (scenario.actions || []).length <= 100,
      `Playwright scenario ${scenario.id} actions must be an array of at most 100 entries`);
    for (const action of scenario.actions || []) {
      requireValue(action && typeof action === "object" && !Array.isArray(action),
        `Playwright scenario ${scenario.id} actions must contain objects`);
      for (const key of Object.keys(action)) {
        requireValue(ACTION_KEYS.has(key), `Playwright action contains unsupported field: ${key}`);
      }
      requireValue(ACTION_TYPES.has(action?.type),
        `Playwright scenario ${scenario.id} has unsupported action: ${action?.type || "missing"}`);
      requireValue(typeof action.locator === "string" && action.locator.length > 0 && action.locator.length <= 1000,
        `Playwright scenario ${scenario.id} action ${action.type} requires locator`);
      if (["fill", "press", "select"].includes(action.type)) {
        requireValue(typeof action.value === "string", `Playwright action ${action.type} requires a string value`);
      }
    }
    requireValue(Array.isArray(scenario.assertions || []) && (scenario.assertions || []).length <= 100,
      `Playwright scenario ${scenario.id} assertions must be an array of at most 100 entries`);
    for (const assertion of scenario.assertions || []) {
      requireValue(assertion && typeof assertion === "object" && !Array.isArray(assertion),
        `Playwright scenario ${scenario.id} assertions must contain objects`);
      for (const key of Object.keys(assertion)) {
        requireValue(ASSERTION_KEYS.has(key), `Playwright assertion contains unsupported field: ${key}`);
      }
      requireValue(ASSERTION_TYPES.has(assertion?.type),
        `Playwright scenario ${scenario.id} has unsupported assertion: ${assertion?.type || "missing"}`);
      if (assertion.type !== "url") {
        requireValue(typeof assertion.locator === "string" && assertion.locator.length > 0 &&
          assertion.locator.length <= 1000,
        `Playwright assertion ${assertion.type} requires locator`);
      }
      if (["text", "value", "url", "computed-style"].includes(assertion.type)) {
        requireValue(typeof assertion.value === "string",
          `Playwright assertion ${assertion.type} requires a string value`);
      }
      if (assertion.type === "computed-style") {
        requireValue(typeof assertion.property === "string" &&
          /^(?:--)?[a-z][a-z0-9-]{0,100}$/.test(assertion.property),
        "Playwright computed-style assertion requires a safe CSS property");
      }
      if (assertion.type === "count") {
        requireValue(Number.isInteger(assertion.value) && assertion.value >= 0,
          "Playwright count assertion requires a non-negative integer value");
      }
    }
  }
  return value.scenarios;
}

function exactKeys(value, expected) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value)) &&
    Object.keys(value).length === expected.size &&
    Object.keys(value).every((key) => expected.has(key));
}

function readPlaywrightChildAuthority(request, settings) {
  const authority = request.playwright_authority;
  requireValue(exactKeys(authority, CHILD_AUTHORITY_KEYS),
    "Playwright child authority has an invalid shape");
  const body = Object.fromEntries(
    Object.entries(authority).filter(([key]) => key !== "authority_digest")
  );
  requireValue(authority.playwright_child_authority_version === 1,
    "Playwright child authority version must be 1");
  requireValue(authority.authority_digest === canonicalDigest(body),
    "Playwright child authority digest mismatch");
  requireValue(authority.runtime_digest === settings.runtime_digest,
    "Playwright child runtime authority conflicts with settings");
  requireValue(DIGEST_PATTERN.test(authority.runtime_source_physical_identity_digest || "") &&
    authority.runtime_source_physical_identity_digest ===
      settings.runtime_physical_identity_digest,
  "Playwright child runtime source physical authority conflicts with settings");
  requireValue(DIGEST_PATTERN.test(authority.runtime_seal_physical_identity_digest || ""),
    "Playwright child runtime seal physical authority is invalid");
  requireValue(runtimeDigest(settings.runtime_root) === authority.runtime_digest,
    "sealed Playwright child runtime digest mismatch");
  requireValue(runtimePhysicalIdentityDigest(settings.runtime_root) ===
    authority.runtime_seal_physical_identity_digest,
  "sealed Playwright child runtime physical identity mismatch");
  const runtime = loadRuntime(settings.runtime_root);
  requireValue(exactKeys(authority.scenario, new Set([
    "digest", "bytes", "physical_identity_digest", "source_base64"
  ])),
    "Playwright child scenario authority has an invalid shape");
  requireValue(DIGEST_PATTERN.test(authority.scenario.physical_identity_digest || ""),
    "Playwright child scenario physical identity is invalid");
  const scenarioSource = Buffer.from(authority.scenario.source_base64, "base64");
  requireValue(scenarioSource.length === authority.scenario.bytes,
    "Playwright child scenario authority byte count mismatch");
  requireValue(sha256(scenarioSource) === authority.scenario.digest &&
    authority.scenario.digest === settings.scenario_digest,
  "Playwright child scenario authority digest mismatch");
  let scenarioDocument;
  try {
    scenarioDocument = JSON.parse(scenarioSource.toString("utf8"));
  } catch (error) {
    throw new Error(`cannot parse Playwright child scenario authority: ${error.message}`);
  }

  requireValue(exactKeys(authority.baselines,
    new Set(["directory_digest", "physical_identity_digest", "total_bytes", "files"])),
  "Playwright child baseline authority has an invalid shape");
  requireValue(DIGEST_PATTERN.test(authority.baselines.physical_identity_digest || ""),
    "Playwright child baseline physical identity is invalid");
  requireValue(Array.isArray(authority.baselines.files),
    "Playwright child baseline files must be an array");
  const baselineFiles = new Map();
  let totalBytes = 0;
  const manifest = [];
  for (const file of authority.baselines.files) {
    requireValue(exactKeys(file, new Set([
      "name", "bytes", "digest", "physical_identity_digest", "source_base64"
    ])),
      "Playwright child baseline file has an invalid shape");
    requireValue(DIGEST_PATTERN.test(file.physical_identity_digest || ""),
      `Playwright child baseline physical identity is invalid: ${file.name}`);
    requireValue(/^[A-Za-z0-9._-]+\.png$/.test(file.name) && !baselineFiles.has(file.name),
      `Playwright child baseline filename is invalid or duplicated: ${file.name}`);
    const source = Buffer.from(file.source_base64, "base64");
    requireValue(source.length === file.bytes && sha256(source) === file.digest,
      `Playwright child baseline digest mismatch: ${file.name}`);
    totalBytes += source.length;
    baselineFiles.set(file.name, source);
    manifest.push({ type: "file", path: file.name, bytes: file.bytes, digest: file.digest });
  }
  requireValue(totalBytes === authority.baselines.total_bytes,
    "Playwright child baseline total byte count mismatch");
  const directoryDigest = canonicalDigest({ type: "directory", entries: manifest });
  requireValue(directoryDigest === authority.baselines.directory_digest &&
    directoryDigest === settings.baseline_digest,
  "Playwright child baseline directory digest mismatch");
  return {
    scenarios: validateScenarioDocument(scenarioDocument),
    baselineFiles,
    runtime
  };
}

function findingFactory() {
  let sequence = 0;
  const findings = [];
  const add = ({ severity = "blocker", category, claim, evidence, ruleId = null, suggestedFix = null,
    informational = false }) => {
    sequence += 1;
    findings.push({
      id: `playwright-${safeId(category)}-${sequence}`,
      rule_id: ruleId,
      severity,
      category,
      location: null,
      claim,
      evidence,
      suggested_fix: suggestedFix,
      disposition: informational ? "informational" : "open",
      rationale: informational ? evidence : null,
      conflicts_with: []
    });
  };
  return { findings, add };
}

function loadRuntime(runtimeRoot) {
  const runtimeRequire = createRequire(path.join(runtimeRoot, "package.json"));
  const playwright = runtimeRequire("playwright-core");
  const coreBundle = runtimeRequire("playwright-core/lib/coreBundle");
  const axeSource = fs.readFileSync(runtimeRequire.resolve("axe-core/axe.min.js"), "utf8");
  const comparePng = coreBundle.utils?.getComparator?.("image/png");
  requireValue(typeof comparePng === "function", "Playwright runtime does not expose its PNG comparator");
  return { playwright, axeSource, comparePng };
}

async function performAction(page, action, timeout) {
  const locator = page.locator(action.locator);
  if (action.type === "click") await locator.click({ timeout });
  else if (action.type === "fill") await locator.fill(action.value, { timeout });
  else if (action.type === "press") await locator.press(action.value, { timeout });
  else if (action.type === "check") await locator.check({ timeout });
  else if (action.type === "uncheck") await locator.uncheck({ timeout });
  else if (action.type === "select") await locator.selectOption(action.value, { timeout });
  else if (action.type === "hover") await locator.hover({ timeout });
  else if (action.type === "wait-for") await locator.waitFor({ state: "visible", timeout });
}

async function performAssertion(page, assertion, timeout) {
  if (assertion.type === "url") {
    const actual = page.url();
    if (!actual.includes(assertion.value)) throw new Error(`URL ${actual} does not include ${assertion.value}`);
    return;
  }
  const locator = page.locator(assertion.locator);
  if (assertion.type === "visible") {
    await locator.waitFor({ state: "visible", timeout });
  } else if (assertion.type === "hidden") {
    await locator.waitFor({ state: "hidden", timeout });
  } else if (assertion.type === "text") {
    const actual = await locator.innerText({ timeout });
    if (!actual.includes(assertion.value)) throw new Error(`${assertion.locator} text does not include expected value`);
  } else if (assertion.type === "value") {
    const actual = await locator.inputValue({ timeout });
    if (actual !== assertion.value) throw new Error(`${assertion.locator} value does not match`);
  } else if (assertion.type === "checked") {
    if (!await locator.isChecked({ timeout })) throw new Error(`${assertion.locator} is not checked`);
  } else if (assertion.type === "count") {
    const actual = await locator.count();
    if (actual !== assertion.value) throw new Error(`${assertion.locator} count ${actual} does not match ${assertion.value}`);
  } else if (assertion.type === "no-overlap") {
    await locator.first().waitFor({ state: "visible", timeout });
    const result = await inspectSelectedOverlap(locator);
    if (result.visible_count < 2) {
      throw new Error(`${assertion.locator} must match at least two visible elements for no-overlap`);
    }
    if (result.overlaps.length > 0) {
      throw new Error(`${assertion.locator} contains overlapping elements: ${JSON.stringify(result.overlaps)}`);
    }
  } else if (assertion.type === "no-clipping") {
    await locator.first().waitFor({ state: "visible", timeout });
    const result = await inspectSelectedClipping(locator);
    if (result.visible_count < 1) {
      throw new Error(`${assertion.locator} must match at least one visible element for no-clipping`);
    }
    if (result.clipped_text.length > 0) {
      throw new Error(`${assertion.locator} contains clipped text: ${JSON.stringify(result.clipped_text)}`);
    }
  } else if (assertion.type === "computed-style") {
    await locator.first().waitFor({ state: "visible", timeout });
    const result = await inspectComputedStyle(locator, assertion.property, assertion.value);
    if (result.visible_count < 1) {
      throw new Error(`${assertion.locator} must match at least one visible element for computed-style`);
    }
    if (result.mismatches.length > 0) {
      throw new Error(`${assertion.locator} computed ${assertion.property} does not match ${assertion.value}: ${JSON.stringify(result.mismatches)}`);
    }
  }
}

async function inspectComputedStyle(locator, property, expected) {
  return locator.evaluateAll((elements, options) => {
    const mismatches = [];
    let visibleCount = 0;
    for (let index = 0; index < elements.length; index += 1) {
      const element = elements[index];
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) continue;
      visibleCount += 1;
      const actual = style.getPropertyValue(options.property).trim();
      if (actual === options.expected) continue;
      mismatches.push({ index, actual });
      if (mismatches.length >= 25) break;
    }
    return { visible_count: visibleCount, property: options.property, expected: options.expected, mismatches };
  }, { property, expected });
}

async function inspectSelectedOverlap(locator) {
  return locator.evaluateAll((elements) => {
    const visible = elements.flatMap((element, index) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return [];
      return [{ element, index, rect }];
    });
    const overlaps = [];
    for (let leftIndex = 0; leftIndex < visible.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < visible.length; rightIndex += 1) {
        const left = visible[leftIndex];
        const right = visible[rightIndex];
        if (left.element.contains(right.element) || right.element.contains(left.element)) continue;
        const width = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
        const height = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
        if (width <= 1 || height <= 1) continue;
        overlaps.push({
          left_index: left.index,
          right_index: right.index,
          width: Math.round(width),
          height: Math.round(height)
        });
        if (overlaps.length >= 25) break;
      }
      if (overlaps.length >= 25) break;
    }
    return { visible_count: visible.length, overlaps };
  });
}

async function inspectSelectedClipping(locator) {
  return locator.evaluateAll((elements) => {
    const clippedText = [];
    let visibleCount = 0;
    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const className = typeof element.className === "string"
        ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("")
        : "";
      return `${element.tagName.toLowerCase()}${className}`;
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const isVisuallyHidden = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const clipped = (style.clip && style.clip !== "auto") ||
        (style.clipPath && style.clipPath !== "none");
      return clipped && rect.width <= 2 && rect.height <= 2;
    };
    const clippingFor = (root) => {
      const candidates = [root, ...root.querySelectorAll("*")];
      for (const element of candidates) {
        if (!(element instanceof HTMLElement) || !isVisible(element) || isVisuallyHidden(element)) continue;
        if (element.closest('[data-killsloprouter-clipping="allow"]')) continue;
        const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
        if (!text) continue;
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1;
        const clipsY = ["hidden", "clip"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1;
        const lineClamp = Number.parseInt(style.webkitLineClamp, 10);
        const clamped = Number.isFinite(lineClamp) && lineClamp > 0 &&
          element.scrollHeight > element.clientHeight + 1;
        if (!clipsX && !clipsY && !clamped) continue;
        clippedText.push({
          selector: selectorFor(element),
          text: text.slice(0, 120),
          horizontal: clipsX,
          vertical: clipsY || clamped,
          client: [element.clientWidth, element.clientHeight],
          scroll: [element.scrollWidth, element.scrollHeight]
        });
        if (clippedText.length >= 25) break;
      }
    };
    for (const element of elements) {
      if (!(element instanceof HTMLElement) || !isVisible(element)) continue;
      visibleCount += 1;
      clippingFor(element);
      if (clippedText.length >= 25) break;
    }
    return { visible_count: visibleCount, clipped_text: clippedText };
  });
}

async function inspectOverflow(page) {
  return page.evaluate(() => {
    const documentOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const offenders = [];
    const overlaps = [];
    const clippedText = [];
    const selectorFor = (element) => {
      if (element.id) return `#${CSS.escape(element.id)}`;
      const className = typeof element.className === "string"
        ? element.className.trim().split(/\s+/).filter(Boolean).slice(0, 3).map((name) => `.${CSS.escape(name)}`).join("")
        : "";
      return `${element.tagName.toLowerCase()}${className}`;
    };
    const isVisible = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const isVisuallyHidden = (element) => {
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const clipped = (style.clip && style.clip !== "auto") ||
        (style.clipPath && style.clipPath !== "none");
      return clipped && rect.width <= 2 && rect.height <= 2;
    };
    for (const element of document.querySelectorAll("body *")) {
      const style = getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) continue;
      const parent = element.parentElement;
      const parentStyle = parent ? getComputedStyle(parent) : null;
      const intentionalScroller = parentStyle && ["auto", "scroll"].includes(parentStyle.overflowX) &&
        parent.scrollWidth > parent.clientWidth;
      if (!intentionalScroller && (rect.left < -1 || rect.right > window.innerWidth + 1)) {
        offenders.push({
          tag: element.tagName.toLowerCase(),
          id: element.id || null,
          class: typeof element.className === "string" ? element.className.slice(0, 160) : null,
          left: Math.round(rect.left),
          right: Math.round(rect.right)
        });
      }
      if (offenders.length >= 25) break;
    }
    for (const parent of document.querySelectorAll("body *")) {
      if (!(parent instanceof HTMLElement) || !isVisible(parent)) continue;
      if (parent.closest('[data-killsloprouter-overlap="allow"]')) continue;
      const parentStyle = getComputedStyle(parent);
      if (!parentStyle.display.includes("flex") && !parentStyle.display.includes("grid")) continue;
      const children = [...parent.children].flatMap((element) => {
        if (!(element instanceof HTMLElement) || !isVisible(element)) return [];
        const style = getComputedStyle(element);
        if (["absolute", "fixed", "sticky"].includes(style.position)) return [];
        return [{ element, rect: element.getBoundingClientRect() }];
      });
      for (let leftIndex = 0; leftIndex < children.length; leftIndex += 1) {
        for (let rightIndex = leftIndex + 1; rightIndex < children.length; rightIndex += 1) {
          const left = children[leftIndex];
          const right = children[rightIndex];
          const width = Math.min(left.rect.right, right.rect.right) - Math.max(left.rect.left, right.rect.left);
          const height = Math.min(left.rect.bottom, right.rect.bottom) - Math.max(left.rect.top, right.rect.top);
          if (width <= 1 || height <= 1) continue;
          overlaps.push({
            parent: selectorFor(parent),
            left: selectorFor(left.element),
            right: selectorFor(right.element),
            width: Math.round(width),
            height: Math.round(height)
          });
          if (overlaps.length >= 25) break;
        }
        if (overlaps.length >= 25) break;
      }
      if (overlaps.length >= 25) break;
    }
    const textFitRoots = document.querySelectorAll([
      "h1", "h2", "h3", "h4", "h5", "h6", "button", "a[href]", "[role=button]", "[role=link]",
      '[data-killsloprouter-text-fit="required"]'
    ].join(","));
    const visited = new Set();
    for (const root of textFitRoots) {
      for (const element of [root, ...root.querySelectorAll("*")]) {
        if (!(element instanceof HTMLElement) || visited.has(element) || !isVisible(element) || isVisuallyHidden(element)) continue;
        visited.add(element);
        if (element.closest('[data-killsloprouter-clipping="allow"]')) continue;
        const text = element.textContent?.replace(/\s+/g, " ").trim() || "";
        if (!text) continue;
        const style = getComputedStyle(element);
        const clipsX = ["hidden", "clip"].includes(style.overflowX) &&
          element.scrollWidth > element.clientWidth + 1;
        const clipsY = ["hidden", "clip"].includes(style.overflowY) &&
          element.scrollHeight > element.clientHeight + 1;
        const lineClamp = Number.parseInt(style.webkitLineClamp, 10);
        const clamped = Number.isFinite(lineClamp) && lineClamp > 0 &&
          element.scrollHeight > element.clientHeight + 1;
        if (!clipsX && !clipsY && !clamped) continue;
        clippedText.push({
          selector: selectorFor(element),
          text: text.slice(0, 120),
          horizontal: clipsX,
          vertical: clipsY || clamped,
          client: [element.clientWidth, element.clientHeight],
          scroll: [element.scrollWidth, element.scrollHeight]
        });
        if (clippedText.length >= 25) break;
      }
      if (clippedText.length >= 25) break;
    }
    return {
      document_overflow: documentOverflow,
      scroll_width: document.documentElement.scrollWidth,
      client_width: document.documentElement.clientWidth,
      offenders,
      overlaps,
      clipped_text: clippedText
    };
  });
}

async function inspectKeyboard(page, maxTabs) {
  const selector = [
    "a[href]:not([tabindex='-1'])", "button:not([disabled]):not([tabindex='-1'])",
    "input:not([disabled]):not([tabindex='-1'])", "select:not([disabled]):not([tabindex='-1'])",
    "textarea:not([disabled]):not([tabindex='-1'])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const focusable = await page.locator(selector).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return [];
    if (element.closest("[inert]")) return [];
    const closedDetails = element.closest("details:not([open])");
    if (closedDetails) {
      const summary = closedDetails.querySelector(":scope > summary");
      if (!summary || (element !== summary && !summary.contains(element))) return [];
    }
    let ancestor = element.parentElement;
    while (ancestor && ancestor !== document.body) {
      const ancestorStyle = getComputedStyle(ancestor);
      if (ancestorStyle.display === "none" || ancestorStyle.visibility === "hidden") return [];
      ancestor = ancestor.parentElement;
    }
    const segments = [];
    let current = element;
    while (current && current !== document.body) {
      if (current.id) {
        segments.unshift(`#${current.id}`);
        break;
      }
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current.tagName)
        : [];
      segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
      current = current.parentElement;
    }
    return [{ key: segments.join(" > ") }];
  }));
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  const visited = [];
  const requiredKeys = new Set(focusable.map((entry) => entry.key));
  const visitedKeys = new Set();
  let stagnantSteps = 0;
  const limit = Math.max(1, maxTabs);
  for (let index = 0; index < limit; index += 1) {
    await page.keyboard.press("Tab");
    const active = await page.evaluate(() => {
      const element = document.activeElement;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      const segments = [];
      let current = element;
      while (current && current !== document.body) {
        if (current.id) {
          segments.unshift(`#${current.id}`);
          break;
        }
        const siblings = current.parentElement
          ? [...current.parentElement.children].filter((candidate) => candidate.tagName === current.tagName)
          : [];
        segments.unshift(`${current.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(current) + 1})`);
        current = current.parentElement;
      }
      return {
        key: segments.join(" > "),
        tag: element.tagName.toLowerCase(),
        id: element.id || null,
        role: element.getAttribute("role"),
        name: element.getAttribute("aria-label") || element.textContent?.trim().slice(0, 120) || null,
        outline: `${style.outlineStyle} ${style.outlineWidth}`,
        box_shadow: style.boxShadow
      };
    });
    if (active) {
      visited.push(active);
      const previousSize = visitedKeys.size;
      visitedKeys.add(active.key);
      stagnantSteps = visitedKeys.size === previousSize ? stagnantSteps + 1 : 0;
      if ([...requiredKeys].every((key) => visitedKeys.has(key))) break;
      if (stagnantSteps > Math.max(12, focusable.length + 4)) break;
    }
  }
  return {
    focusable_count: focusable.length,
    visited,
    unreached: focusable.filter((entry) => !visitedKeys.has(entry.key))
  };
}

async function runAxe(page, axeSource) {
  await page.addScriptTag({ content: axeSource });
  return page.evaluate(async () => globalThis.axe.run(document, {
    runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] },
    resultTypes: ["violations", "incomplete"]
  }));
}

async function stabilizeVisualCapture(page) {
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    for (const activeTab of document.querySelectorAll('[role="tab"][aria-selected="true"]')) {
      activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });

  // The first rasterization warms Chromium's font and paint caches. Discarding it
  // keeps exact-byte baselines deterministic across fresh browser processes.
  await page.screenshot({ fullPage: true, animations: "disabled", caret: "hide", scale: "css" });
  await page.evaluate(() => new Promise((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

function browserLaunchOptions(channel) {
  const options = { headless: true };
  if (channel !== "bundled") options.channel = channel;
  return options;
}

function requestProtocolAllowed(url) {
  return ["data:", "blob:", "about:"].some((prefix) => url.startsWith(prefix));
}

function normalizedNetworkOrigin(url) {
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "ws:") parsed.protocol = "http:";
    if (parsed.protocol === "wss:") parsed.protocol = "https:";
    return parsed.origin;
  } catch {
    return null;
  }
}

function sameDigestMap(left, right) {
  const leftKeys = Object.keys(left || {}).sort();
  const rightKeys = Object.keys(right || {}).sort();
  return leftKeys.length === rightKeys.length &&
    leftKeys.every((key, index) => key === rightKeys[index] && left[key] === right[key]);
}

function hashFile(file) {
  return `sha256:${crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex")}`;
}

async function designMarkers(page, locales, states) {
  return page.evaluate(({ requiredLocales, requiredStates }) => {
    const localeFound = Object.fromEntries(requiredLocales.map((locale) => [locale,
      document.documentElement.lang === locale || [...document.querySelectorAll("[data-killsloprouter-locale]")]
        .some((element) => element.getAttribute("data-killsloprouter-locale") === locale)
    ]));
    const stateFound = Object.fromEntries(requiredStates.map((state) => [state,
      [...document.querySelectorAll("[data-killsloprouter-state]")]
        .some((element) => element.getAttribute("data-killsloprouter-state") === state)
    ]));
    return { localeFound, stateFound };
  }, { requiredLocales: locales, requiredStates: states });
}

async function runDesignBrowser(request, runtime) {
  const { packet, settings = {}, output_directory: outputDirectory } = request;
  const task = packet.design_task;
  requireValue(task?.kind === "browser-evidence", "design Playwright packet kind must be browser-evidence");
  requireValue(task.subject_kind === "direction-candidate" || task.subject_kind === "color-candidate",
    "design Playwright subject kind is invalid");
  requireValue(Array.isArray(task.prototypes) && task.prototypes.length === 1,
    "official design Playwright requires exactly one digest-bound HTML prototype");
  const prototype = task.prototypes[0];
  requireValue(typeof prototype.path === "string" && DIGEST_PATTERN.test(prototype.digest || ""),
    "design prototype requires path and digest");
  const prototypePath = path.resolve(prototype.path);
  requireValue(fs.existsSync(prototypePath), `design prototype is missing: ${prototypePath}`);
  const prototypeStat = fs.lstatSync(prototypePath);
  requireValue(prototypeStat.isFile() && !prototypeStat.isSymbolicLink(),
    "design prototype must be a regular non-symlink file");
  requireValue(path.extname(prototypePath).toLowerCase() === ".html",
    "official design Playwright accepts a static HTML prototype");
  requireValue(hashFile(prototypePath) === prototype.digest, "design prototype digest mismatch");
  const target = pathToFileURL(fs.realpathSync(prototypePath)).toString();
  const requiredViewports = packet.evidence_contract?.required_viewports || [];
  const requiredChecks = packet.evidence_contract?.required_checks || [];
  const requiredLocales = task.locales || [];
  const requiredStates = task.required_states || [];
  requireValue(requiredViewports.length > 0, "design Playwright requires viewports");
  for (const viewport of requiredViewports) {
    requireValue(settings.viewports?.[viewport], `missing configured viewport: ${viewport}`);
  }
  fs.mkdirSync(outputDirectory, { recursive: true });

  const { playwright, axeSource } = runtime;
  const browser = await playwright.chromium.launch(browserLaunchOptions(settings.browser_channel));
  const browserVersion = browser.version();
  const evidence = [];
  const executions = [];
  const aggregate = {
    keyboard: true,
    state: true,
    overflow: true,
    contrast: true,
    "zoom-200": true,
    "visual-regression": false,
    "screen-reader": false,
    "aria-semantics": true,
    console: true,
    network: true
  };
  const localesFound = new Set();
  const statesFound = new Set();
  try {
    for (const viewportName of requiredViewports) {
      const viewport = settings.viewports[viewportName];
      const context = await browser.newContext({
        viewport,
        colorScheme: settings.color_schemes?.[0] || "light",
        locale: requiredLocales[0] || settings.locale,
        reducedMotion: "reduce",
        serviceWorkers: "block"
      });
      const execution = {
        viewport: viewportName,
        console_errors: [],
        page_errors: [],
        request_failures: [],
        blocked_requests: []
      };
      executions.push(execution);
      const page = await context.newPage();
      page.setDefaultTimeout(settings.navigation_timeout_ms);
      page.on("console", (message) => {
        if (message.type() === "error") execution.console_errors.push(message.text());
      });
      page.on("pageerror", (error) => execution.page_errors.push(error.message));
      page.on("requestfailed", (failed) => execution.request_failures.push({
        url: failed.url(), error: failed.failure()?.errorText || "unknown"
      }));
      await context.route("**/*", async (route) => {
        const url = route.request().url();
        if (url === target) return route.continue();
        if (requestProtocolAllowed(url)) return route.continue();
        execution.blocked_requests.push({ url, origin: normalizedNetworkOrigin(url) });
        return route.abort("blockedbyclient");
      });
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: settings.navigation_timeout_ms });
        const markers = await designMarkers(page, requiredLocales, requiredStates);
        for (const [locale, found] of Object.entries(markers.localeFound)) if (found) localesFound.add(locale);
        for (const [state, found] of Object.entries(markers.stateFound)) if (found) statesFound.add(state);
        aggregate.state &&= Object.values(markers.stateFound).every(Boolean);

        execution.overflow = await inspectOverflow(page);
        aggregate.overflow &&= !execution.overflow.document_overflow &&
          execution.overflow.offenders.length === 0 &&
          execution.overflow.overlaps.length === 0 &&
          execution.overflow.clipped_text.length === 0;
        execution.keyboard = await inspectKeyboard(page, settings.max_keyboard_tabs);
        aggregate.keyboard &&= execution.keyboard.focusable_count > 0 && execution.keyboard.unreached.length === 0;

        const originalViewport = page.viewportSize();
        await page.setViewportSize({
          width: Math.max(320, Math.floor(originalViewport.width / 2)),
          height: originalViewport.height
        });
        execution.zoom_200 = await inspectOverflow(page);
        aggregate["zoom-200"] &&= !execution.zoom_200.document_overflow &&
          execution.zoom_200.offenders.length === 0 &&
          execution.zoom_200.overlaps.length === 0 &&
          execution.zoom_200.clipped_text.length === 0;
        await page.setViewportSize(originalViewport);

        execution.axe = await runAxe(page, axeSource);
        aggregate.contrast &&= !execution.axe.violations.some((item) => item.id === "color-contrast");
        aggregate["aria-semantics"] &&= !execution.axe.violations.some((item) => item.id !== "color-contrast");
        const ariaSnapshot = await page.locator("body").ariaSnapshot();
        aggregate["aria-semantics"] &&= Boolean(ariaSnapshot.trim());
        aggregate.console &&= execution.console_errors.length === 0 && execution.page_errors.length === 0;
        aggregate.network &&= execution.request_failures.length === 0 && execution.blocked_requests.length === 0;

        const screenshotName = `${safeId(task.subject_id)}--${safeId(viewportName)}.png`;
        await stabilizeVisualCapture(page);
        await page.screenshot({
          path: path.join(outputDirectory, screenshotName),
          fullPage: true,
          animations: "disabled",
          caret: "hide",
          scale: "css"
        });
        evidence.push({ kind: "screenshot", path: screenshotName, viewport: viewportName });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }
  aggregate.state &&= requiredLocales.every((locale) => localesFound.has(locale)) &&
    requiredStates.every((state) => statesFound.has(state));
  const checks = Object.fromEntries(requiredChecks.map((check) => [check, aggregate[check] === true]));
  const reportName = `${safeId(task.subject_id)}--playwright-report.json`;
  const report = {
    design_playwright_report_version: 1,
    run_id: request.run_id,
    packet_id: packet.packet_id,
    subject_id: task.subject_id,
    subject_result_digest: task.subject_result_digest,
    prototype: { path: prototypePath, digest: prototype.digest },
    browser: { engine: "playwright", implementation: "chromium", version: browserVersion },
    checks,
    locales_found: [...localesFound],
    states_found: [...statesFound],
    executions
  };
  fs.writeFileSync(path.join(outputDirectory, reportName), `${JSON.stringify(report, null, 2)}\n`);
  evidence.push({ kind: "test-report", path: reportName, checks: requiredChecks });
  return {
    host_adapter_response_version: 1,
    result: {
      design_result_version: 1,
      kind: "browser-evidence",
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
      actor: { actor_id: `playwright:official-v1:${process.pid}`, kind: "agent" },
      status: "completed",
      packet_digest: packet.packet_digest,
      candidate_id: task.subject_id,
      subject_kind: task.subject_kind,
      subject_id: task.subject_id,
      subject_result_digest: task.subject_result_digest,
      browser_engine: "playwright",
      browser_engine_version: browserVersion,
      checks,
      locales_tested: [...localesFound],
      states_tested: [...statesFound],
      evidence
    },
    metadata: {
      child_pid: process.pid,
      transport: "official-playwright-design-json-v1",
      browser_version: browserVersion,
      observed_journey_identity_digest: request.journey_identity.identity_digest,
      observed_participant: request.participant
    }
  };
}

async function run(request) {
  const { packet, settings = {}, output_directory: outputDirectory } = request;
  requireValue(request?.host_adapter_request_version === 1,
    "host_adapter_request_version must be 1");
  verifyJourneyIdentity(request.journey_identity, {
    runId: request.run_id,
    label: "Playwright host request journey_identity"
  });
  verifyPacketJourney(packet, request.journey_identity,
    `packet ${packet?.packet_id || "unknown"}`);
  requireValue(identitiesMatch(packet.journey_identity, request.journey_identity),
    "Playwright request and packet journey identities conflict");
  verifyParticipant(request.participant, {
    providerId: packet?.provider?.id,
    stageId: packet?.stage_id,
    designTaskKind: packet?.design_task?.kind || null,
    label: "Playwright host request participant"
  });
  requireValue(JSON.stringify(request.participant) === JSON.stringify(packet.participant),
    "Playwright host request participant conflicts with the packet");
  requireValue(packet?.stage_id === "browser-evidence", "official Playwright adapter accepts browser-evidence only");
  requireValue(settings.contract === CONTRACT, `settings.contract must be ${CONTRACT}`);
  requireValue(request.permission_scopes?.includes("artifact:read"), "artifact:read permission is required");
  requireValue(request.permission_scopes?.includes("browser:control"), "browser:control permission is required");
  requireValue(request.permission_scopes?.includes("evidence:write"), "evidence:write permission is required");
  requireValue(typeof outputDirectory === "string" && outputDirectory.length > 0,
    "output_directory is required");
  fs.mkdirSync(outputDirectory, { recursive: true });

  const childAuthority = readPlaywrightChildAuthority(request, settings);

  if (packet.design_task?.kind === "browser-evidence") {
    return runDesignBrowser(request, childAuthority.runtime);
  }

  const scenarios = childAuthority.scenarios;
  const requiredViewports = packet.evidence_contract?.required_viewports || [];
  const requiredChecks = packet.evidence_contract?.required_checks || [];
  const requiredScenarios = packet.evidence_contract?.required_scenarios || [];
  const scenariosById = new Map(scenarios.map((scenario) => [scenario.id, scenario]));
  for (const scenarioId of requiredScenarios) {
    const scenario = scenariosById.get(scenarioId);
    requireValue(scenario, `required Playwright scenario is missing: ${scenarioId}`);
    requireValue((scenario.assertions || []).length > 0,
      `required Playwright scenario has no state assertion: ${scenarioId}`);
  }
  if (requiredChecks.includes("state")) {
    requireValue(scenarios.some((scenario) => (scenario.assertions || []).length > 0),
      "Playwright state evidence requires at least one scenario assertion");
  }
  for (const viewport of requiredViewports) {
    requireValue(settings.viewports?.[viewport], `missing configured viewport: ${viewport}`);
  }
  const attestationUrl = new URL(settings.attestation_path, settings.base_url);
  const attestationResponse = await fetch(attestationUrl, {
    headers: { accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(settings.navigation_timeout_ms)
  });
  requireValue(attestationResponse.ok,
    `artifact attestation returned HTTP ${attestationResponse.status} at ${attestationUrl}`);
  const attestation = await attestationResponse.json();
  requireValue(attestation && typeof attestation === "object" && !Array.isArray(attestation),
    "artifact attestation must be a JSON object");
  requireValue(Object.keys(attestation).every((key) =>
    ["killsloprouter_browser_attestation_version", "artifact_digests"].includes(key)),
  "artifact attestation contains unsupported fields");
  requireValue(attestation?.killsloprouter_browser_attestation_version === 1,
    "artifact attestation version must be 1");
  requireValue(attestation.artifact_digests && typeof attestation.artifact_digests === "object" &&
    !Array.isArray(attestation.artifact_digests) && Object.keys(attestation.artifact_digests).length > 0,
  "artifact attestation requires a non-empty artifact_digests object");
  requireValue(Object.values(attestation.artifact_digests).every((digest) => DIGEST_PATTERN.test(digest)),
    "artifact attestation contains an invalid SHA-256 digest");
  requireValue(sameDigestMap(attestation.artifact_digests, packet.artifact_digests),
    "served artifact attestation does not match the audit packet digests");

  const { playwright, axeSource, comparePng } = childAuthority.runtime;
  const browser = await playwright.chromium.launch(browserLaunchOptions(settings.browser_channel));
  const browserVersion = browser.version();
  const { findings, add } = findingFactory();
  const evidence = [];
  const report = {
    playwright_browser_report_version: 1,
    contract: CONTRACT,
    run_id: request.run_id,
    packet_id: packet.packet_id,
    browser: { engine: "chromium", channel: settings.browser_channel, version: browserVersion },
    base_url: settings.base_url,
    attestation_path: settings.attestation_path,
    allowed_origins: settings.allowed_origins,
    required_viewports: requiredViewports,
    required_checks: requiredChecks,
    required_scenarios: requiredScenarios,
    visual_comparison: {
      comparator: "playwright-pixelmatch",
      threshold: VISUAL_COMPARISON.threshold,
      max_diff_pixels: VISUAL_COMPARISON.maxDiffPixels,
      antialiasing: "ignored"
    },
    screen_reader_scope: "automated-aria-and-axe-semantic-proxy-not-real-assistive-technology",
    artifact_attestation: {
      url: attestationUrl.toString(),
      artifact_digests: attestation.artifact_digests
    },
    executions: [],
    blocked_requests: []
  };

  try {
    for (const scenario of scenarios) {
      const target = new URL(scenario.path, settings.base_url);
      const allowedOrigins = new Set(settings.allowed_origins || []);
      allowedOrigins.add(new URL(settings.base_url).origin);
      requireValue(allowedOrigins.has(target.origin),
        `scenario ${scenario.id} resolves outside allowed origins: ${target.origin}`);
      for (const colorScheme of settings.color_schemes) {
        for (const viewportName of requiredViewports) {
          const viewport = settings.viewports[viewportName];
          const executionId = `${safeId(scenario.id)}--${safeId(colorScheme)}--${safeId(viewportName)}`;
          const traceName = `${executionId}.trace.zip`;
          const screenshotName = `${executionId}.png`;
          const ariaName = `${executionId}.aria.yml`;
          const execution = {
            id: executionId,
            scenario: scenario.id,
            target: target.toString(),
            color_scheme: colorScheme,
            viewport: { name: viewportName, ...viewport },
            actions: [],
            assertions: [],
            console_errors: [],
            page_errors: [],
            request_failures: [],
            response_errors: [],
            blocked_requests: [],
            overflow: null,
            zoom_200: null,
            keyboard: null,
            axe: null,
            visual_regression: null,
            status: "running"
          };
          report.executions.push(execution);
          const context = await browser.newContext({
            viewport,
            colorScheme,
            locale: settings.locale,
            reducedMotion: "reduce",
            serviceWorkers: "block"
          });
          await context.tracing.start({ screenshots: true, snapshots: true, sources: false });
          const page = await context.newPage();
          page.setDefaultTimeout(settings.navigation_timeout_ms);
          page.on("console", (message) => {
            if (message.type() === "error") execution.console_errors.push(message.text());
          });
          page.on("pageerror", (error) => execution.page_errors.push(error.message));
          page.on("requestfailed", (failed) => execution.request_failures.push({
            url: failed.url(), method: failed.method(), error: failed.failure()?.errorText || "unknown"
          }));
          page.on("response", (response) => {
            if (response.status() >= 400) execution.response_errors.push({
              url: response.url(), status: response.status(), method: response.request().method()
            });
          });
          await context.route("**/*", async (route) => {
            const url = route.request().url();
            if (requestProtocolAllowed(url)) return route.continue();
            const origin = normalizedNetworkOrigin(url);
            if (origin && allowedOrigins.has(origin)) return route.continue();
            const blocked = { url, method: route.request().method(), origin };
            execution.blocked_requests.push(blocked);
            report.blocked_requests.push(blocked);
            return route.abort("blockedbyclient");
          });
          await context.routeWebSocket("**/*", async (webSocket) => {
            const url = webSocket.url();
            const origin = normalizedNetworkOrigin(url);
            if (origin && allowedOrigins.has(origin)) {
              webSocket.connectToServer();
              return;
            }
            const blocked = { url, method: "WEBSOCKET", origin };
            execution.blocked_requests.push(blocked);
            report.blocked_requests.push(blocked);
            await webSocket.close({ code: 1008, reason: "KillSlopRouter blocked origin" });
          });

          try {
            await page.goto(target.toString(), {
              waitUntil: "domcontentloaded",
              timeout: settings.navigation_timeout_ms
            });
            for (const action of scenario.actions || []) {
              try {
                await performAction(page, action, settings.navigation_timeout_ms);
                execution.actions.push({ type: action.type, locator: action.locator, status: "passed" });
              } catch (error) {
                execution.actions.push({ type: action.type, locator: action.locator, status: "failed", error: error.message });
                add({
                  category: "state-action-failure",
                  ruleId: "missing-required-state",
                  claim: `Scenario ${scenario.id} action ${action.type} failed at ${viewportName}`,
                  evidence: `${executionId}: ${error.message}`,
                  suggestedFix: "Repair the control or update the digest-locked scenario contract."
                });
              }
            }
            for (const assertion of scenario.assertions || []) {
              try {
                await performAssertion(page, assertion, settings.navigation_timeout_ms);
                execution.assertions.push({
                  type: assertion.type,
                  locator: assertion.locator || null,
                  property: assertion.property || null,
                  expected: assertion.value ?? null,
                  status: "passed"
                });
              } catch (error) {
                execution.assertions.push({
                  type: assertion.type,
                  locator: assertion.locator || null,
                  property: assertion.property || null,
                  expected: assertion.value ?? null,
                  status: "failed",
                  error: error.message
                });
                const layoutAssertion = ["no-overlap", "no-clipping"].includes(assertion.type);
                const visualAssertion = assertion.type === "computed-style";
                add({
                  category: layoutAssertion ? "overflow" : visualAssertion ? "visual-intent" : "state-assertion-failure",
                  ruleId: layoutAssertion
                    ? "overflow-overlap-or-clipping"
                    : visualAssertion ? "visual-intent-contract-violation" : "missing-required-state",
                  claim: `Scenario ${scenario.id} assertion ${assertion.type} failed at ${viewportName}`,
                  evidence: `${executionId}: ${error.message}`,
                  suggestedFix: layoutAssertion
                    ? "Repair the scoped layout or declare intentional clipping with the documented opt-out marker."
                    : visualAssertion
                      ? "Restore the digest-locked project visual invariant before approval."
                      : "Restore the required state behavior before approval."
                });
              }
            }

            execution.overflow = await inspectOverflow(page);
            if (execution.overflow.document_overflow || execution.overflow.offenders.length ||
              execution.overflow.overlaps.length || execution.overflow.clipped_text.length) {
              add({
                category: "overflow",
                ruleId: "overflow-overlap-or-clipping",
                claim: `Unintended overflow, overlap, or text clipping was detected in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify(execution.overflow)}`,
                suggestedFix: "Fix the responsive layout without hiding required content; mark only approved intentional clipping."
              });
            }

            execution.keyboard = await inspectKeyboard(page, settings.max_keyboard_tabs);
            if (execution.keyboard.focusable_count > 0 && execution.keyboard.unreached.length > 0) {
              add({
                category: "keyboard",
                ruleId: "keyboard-failure",
                claim: `${execution.keyboard.unreached.length} focusable control(s) could not be reached by keyboard in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify(execution.keyboard)}`,
                suggestedFix: "Restore native focusability and a usable tab order."
              });
            }

            const originalViewport = page.viewportSize();
            const zoomViewport = {
              width: Math.max(320, Math.floor(originalViewport.width / 2)),
              height: originalViewport.height
            };
            await page.setViewportSize(zoomViewport);
            execution.zoom_200 = { viewport: zoomViewport, overflow: await inspectOverflow(page) };
            await page.setViewportSize(originalViewport);
            if (execution.zoom_200.overflow.document_overflow || execution.zoom_200.overflow.offenders.length ||
              execution.zoom_200.overflow.overlaps.length || execution.zoom_200.overflow.clipped_text.length) {
              add({
                category: "zoom-200",
                ruleId: "overflow-overlap-or-clipping",
                claim: `The 200% zoom/reflow proxy overflowed, overlapped, or clipped text in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify(execution.zoom_200)}`,
                suggestedFix: "Support reflow at half the CSS viewport width without clipping required content."
              });
            }

            execution.axe = await runAxe(page, axeSource);
            for (const violation of execution.axe.violations) {
              const contrast = violation.id === "color-contrast";
              add({
                severity: contrast || ["critical", "serious"].includes(violation.impact) ? "blocker" : "major",
                category: contrast ? "contrast" : "aria-semantics",
                ruleId: contrast ? "contrast-failure" : `axe:${violation.id}`,
                claim: `${violation.help} (${violation.nodes.length} node${violation.nodes.length === 1 ? "" : "s"})`,
                evidence: `${executionId}: ${violation.helpUrl}`,
                suggestedFix: violation.description
              });
            }

            const ariaSnapshot = await page.locator("body").ariaSnapshot();
            fs.writeFileSync(path.join(outputDirectory, ariaName), `${ariaSnapshot}\n`);
            if (!ariaSnapshot.trim()) {
              add({
                category: "screen-reader",
                ruleId: "axe:empty-aria-snapshot",
                claim: `ARIA snapshot is empty in ${executionId}`,
                evidence: ariaName,
                suggestedFix: "Restore semantic HTML, roles, names, and required states."
              });
            }
            evidence.push({
              path: ariaName,
              kind: "aria-snapshot",
              covers: ["keyboard-evidence", "state-evidence"],
              viewports: [viewportName],
              checks: requiredChecks.filter((check) => ["screen-reader", "aria-semantics"].includes(check)),
              scenarios: [scenario.id]
            });

            const screenshotPath = path.join(outputDirectory, screenshotName);
            await stabilizeVisualCapture(page);
            await page.screenshot({
              path: screenshotPath,
              fullPage: true,
              animations: "disabled",
              caret: "hide",
              scale: "css"
            });
            evidence.push({
              path: screenshotName,
              kind: "screenshot",
              covers: packet.assigned_capabilities,
              viewports: [viewportName],
              checks: [],
              scenarios: [scenario.id]
            });
            const baselinePath = path.join(settings.baseline_directory, screenshotName);
            const baseline = childAuthority.baselineFiles.get(screenshotName);
            if (!baseline) {
              execution.visual_regression = { status: "baseline-missing", baseline: baselinePath };
              add({
                category: "visual-regression",
                claim: `Approved visual baseline is missing for ${executionId}`,
                evidence: screenshotName,
                suggestedFix: "Review this candidate screenshot, place the approved file in the baseline directory, and reconfigure to lock its digest."
              });
            } else {
              const actual = fs.readFileSync(screenshotPath);
              const exact = baseline.equals(actual);
              const comparison = exact ? null : comparePng(actual, baseline, VISUAL_COMPARISON);
              const matches = comparison === null;
              execution.visual_regression = {
                status: matches ? "matched" : "changed",
                baseline: baselinePath,
                comparison: exact ? "exact-bytes" : "playwright-pixelmatch",
                threshold: VISUAL_COMPARISON.threshold,
                max_diff_pixels: VISUAL_COMPARISON.maxDiffPixels,
                difference: comparison?.errorMessage || null
              };
              if (!matches) {
                const diffName = `${executionId}.diff.png`;
                if (comparison.diff) {
                  fs.writeFileSync(path.join(outputDirectory, diffName), comparison.diff);
                  evidence.push({
                    path: diffName,
                    kind: "visual-diff",
                    covers: packet.assigned_capabilities,
                    viewports: [viewportName],
                    checks: ["visual-regression"],
                    scenarios: [scenario.id]
                  });
                }
                add({
                  category: "visual-regression",
                  claim: `Rendered pixels changed from the approved baseline for ${executionId}`,
                  evidence: `${screenshotName} differs from ${baselinePath}: ${comparison.errorMessage}`,
                  suggestedFix: "Review the visual change and approve a new digest-bound baseline only when intentional."
                });
              }
            }

            if (execution.console_errors.length || execution.page_errors.length) {
              add({
                category: "console",
                claim: `Browser errors occurred in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify({
                  console_errors: execution.console_errors,
                  page_errors: execution.page_errors
                })}`,
                suggestedFix: "Resolve runtime and console errors before approval."
              });
            }
            if (execution.request_failures.length || execution.response_errors.length ||
              execution.blocked_requests.length) {
              add({
                category: "network",
                claim: `Network failures or disallowed requests occurred in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify({
                  request_failures: execution.request_failures,
                  response_errors: execution.response_errors,
                  blocked_requests: execution.blocked_requests
                })}`,
                suggestedFix: "Fix failed resources or explicitly authorize the minimum required origin."
              });
            }
            execution.status = "completed";
          } catch (error) {
            execution.status = "blocked";
            execution.error = error.message;
            add({
              category: "browser-execution",
              claim: `Playwright could not complete ${executionId}`,
              evidence: `${executionId}: ${error.message}`,
              suggestedFix: "Ensure the approved local server is reachable and the scenario contract is valid."
            });
          } finally {
            await context.tracing.stop({ path: path.join(outputDirectory, traceName) });
            evidence.push({
              path: traceName,
              kind: "trace",
              covers: packet.assigned_capabilities,
              viewports: [viewportName],
              checks: [],
              scenarios: [scenario.id]
            });
            await context.close();
          }
        }
      }
    }
  } finally {
    await browser.close();
  }

  if (requiredChecks.includes("screen-reader")) {
    add({
      severity: "note",
      category: "screen-reader-scope",
      claim: "Playwright evidence covers ARIA semantics, not a real assistive-technology session",
      evidence: "Use the ARIA snapshots and axe results as an automated proxy; require separate human AT evidence when project risk demands it.",
      informational: true
    });
  }
  report.findings = findings;
  report.status = findings.some((finding) => finding.disposition === "open") ? "blocked" : "passed";
  const reportName = "browser-report.json";
  fs.writeFileSync(path.join(outputDirectory, reportName), `${JSON.stringify(report, null, 2)}\n`);
  evidence.push({
    path: reportName,
    kind: "test-report",
    covers: packet.assigned_capabilities,
    viewports: requiredViewports,
    checks: requiredChecks,
    scenarios: scenarios.map((scenario) => scenario.id)
  });

  return {
    host_adapter_response_version: 1,
    result: {
      audit_result_version: 1,
      run_id: request.run_id,
      packet_id: packet.packet_id,
      packet_digest: packet.packet_digest,
      journey_identity: request.journey_identity,
      provider_id: packet.provider.id,
      participant: request.participant,
      ...(request.baseline_lineage
        ? { baseline_lineage_digest: request.baseline_lineage.lineage_digest }
        : {}),
      reviewer: { actor_id: `playwright:official-v1:${process.pid}`, kind: "browser" },
      verdict: report.status === "blocked" ? "block" : findings.length ? "pass_with_findings" : "pass",
      capabilities_checked: packet.assigned_capabilities,
      artifact_digests: packet.artifact_digests,
      findings,
      evidence,
      resolutions: [],
      started_at: request.started_at || new Date().toISOString(),
      finished_at: new Date().toISOString()
    },
    metadata: {
      child_pid: process.pid,
      transport: "official-playwright-json-v1",
      browser_version: browserVersion,
      observed_journey_identity_digest: request.journey_identity.identity_digest,
      observed_participant: request.participant
    }
  };
}

let input = "";
for await (const chunk of process.stdin) input += chunk;

try {
  const request = JSON.parse(input);
  request.started_at = new Date().toISOString();
  process.stdout.write(JSON.stringify(await run(request)));
} catch (error) {
  process.stderr.write(`KillSlopRouter Playwright adapter: ${error.message}\n`);
  process.exitCode = 4;
}
