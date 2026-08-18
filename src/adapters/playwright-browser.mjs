#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const CONTRACT = "killsloprouter-playwright-v1";
const ACTION_TYPES = new Set(["click", "fill", "press", "check", "uncheck", "select", "hover", "wait-for"]);
const ASSERTION_TYPES = new Set(["visible", "hidden", "text", "value", "checked", "url", "count"]);
const SCENARIO_KEYS = new Set(["id", "path", "actions", "assertions"]);
const ACTION_KEYS = new Set(["type", "locator", "value"]);
const ASSERTION_KEYS = new Set(["type", "locator", "value"]);
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function safeId(value) {
  return String(value).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "item";
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${label} at ${file}: ${error.message}`);
  }
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
      if (["text", "value", "url"].includes(assertion.type)) {
        requireValue(typeof assertion.value === "string",
          `Playwright assertion ${assertion.type} requires a string value`);
      }
      if (assertion.type === "count") {
        requireValue(Number.isInteger(assertion.value) && assertion.value >= 0,
          "Playwright count assertion requires a non-negative integer value");
      }
    }
  }
  return value.scenarios;
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
  const axeSource = fs.readFileSync(runtimeRequire.resolve("axe-core/axe.min.js"), "utf8");
  return { playwright, axeSource };
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
  }
}

async function inspectOverflow(page) {
  return page.evaluate(() => {
    const documentOverflow = document.documentElement.scrollWidth > document.documentElement.clientWidth + 1;
    const offenders = [];
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
    return {
      document_overflow: documentOverflow,
      scroll_width: document.documentElement.scrollWidth,
      client_width: document.documentElement.clientWidth,
      offenders
    };
  });
}

async function inspectKeyboard(page, maxTabs) {
  const selector = [
    "a[href]", "button:not([disabled])", "input:not([disabled])", "select:not([disabled])",
    "textarea:not([disabled])", "[tabindex]:not([tabindex='-1'])"
  ].join(",");
  const focusable = await page.locator(selector).evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    if (style.display === "none" || style.visibility === "hidden" || rect.width <= 0 || rect.height <= 0) return [];
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
  const limit = Math.min(maxTabs, Math.max(1, focusable.length + 2));
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
    if (active) visited.push(active);
  }
  const visitedKeys = new Set(visited.map((entry) => entry.key));
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

async function run(request) {
  const { packet, settings = {}, output_directory: outputDirectory } = request;
  requireValue(packet?.stage_id === "browser-evidence", "official Playwright adapter accepts browser-evidence only");
  requireValue(settings.contract === CONTRACT, `settings.contract must be ${CONTRACT}`);
  requireValue(request.permission_scopes?.includes("artifact:read"), "artifact:read permission is required");
  requireValue(request.permission_scopes?.includes("browser:control"), "browser:control permission is required");
  requireValue(request.permission_scopes?.includes("evidence:write"), "evidence:write permission is required");
  requireValue(typeof outputDirectory === "string" && outputDirectory.length > 0,
    "output_directory is required");
  fs.mkdirSync(outputDirectory, { recursive: true });

  const scenarios = validateScenarioDocument(readJson(settings.scenario_file, "Playwright scenarios"));
  const requiredViewports = packet.evidence_contract?.required_viewports || [];
  const requiredChecks = packet.evidence_contract?.required_checks || [];
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

  const { playwright, axeSource } = loadRuntime(settings.runtime_root);
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
                execution.assertions.push({ type: assertion.type, locator: assertion.locator || null, status: "passed" });
              } catch (error) {
                execution.assertions.push({
                  type: assertion.type, locator: assertion.locator || null, status: "failed", error: error.message
                });
                add({
                  category: "state-assertion-failure",
                  ruleId: "missing-required-state",
                  claim: `Scenario ${scenario.id} assertion ${assertion.type} failed at ${viewportName}`,
                  evidence: `${executionId}: ${error.message}`,
                  suggestedFix: "Restore the required state behavior before approval."
                });
              }
            }

            execution.overflow = await inspectOverflow(page);
            if (execution.overflow.document_overflow || execution.overflow.offenders.length) {
              add({
                category: "overflow",
                ruleId: "overflow-overlap-or-clipping",
                claim: `Horizontal overflow was detected in ${executionId}`,
                evidence: `${executionId}: ${JSON.stringify(execution.overflow)}`,
                suggestedFix: "Fix unintended overflow without hiding required content."
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
            if (execution.zoom_200.overflow.document_overflow || execution.zoom_200.overflow.offenders.length) {
              add({
                category: "zoom-200",
                ruleId: "overflow-overlap-or-clipping",
                claim: `The 200% zoom/reflow proxy overflowed in ${executionId}`,
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
              checks: requiredChecks.filter((check) => ["screen-reader", "aria-semantics"].includes(check))
            });

            const screenshotPath = path.join(outputDirectory, screenshotName);
            await page.screenshot({ path: screenshotPath, fullPage: true, animations: "disabled" });
            evidence.push({
              path: screenshotName,
              kind: "screenshot",
              covers: packet.assigned_capabilities,
              viewports: [viewportName],
              checks: []
            });
            const baselinePath = path.join(settings.baseline_directory, screenshotName);
            if (!fs.existsSync(baselinePath)) {
              execution.visual_regression = { status: "baseline-missing", baseline: baselinePath };
              add({
                category: "visual-regression",
                claim: `Approved visual baseline is missing for ${executionId}`,
                evidence: screenshotName,
                suggestedFix: "Review this candidate screenshot, place the approved file in the baseline directory, and reconfigure to lock its digest."
              });
            } else {
              const matches = fs.readFileSync(baselinePath).equals(fs.readFileSync(screenshotPath));
              execution.visual_regression = { status: matches ? "matched" : "changed", baseline: baselinePath };
              if (!matches) {
                add({
                  category: "visual-regression",
                  claim: `Rendered pixels changed from the approved baseline for ${executionId}`,
                  evidence: `${screenshotName} differs from ${baselinePath}`,
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
              checks: []
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
    checks: requiredChecks
  });

  return {
    host_adapter_response_version: 1,
    result: {
      audit_result_version: 1,
      packet_id: packet.packet_id,
      provider_id: packet.provider.id,
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
      browser_version: browserVersion
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
