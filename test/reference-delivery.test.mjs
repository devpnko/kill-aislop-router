import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertDesignReferenceRequirement, continueDesignExploration, dryRunDesignExploration,
  readDesignState, resumeDesignExploration, startDesignExploration, validateDesignBrief
} from "../src/design.mjs";
import { inspectDistribution } from "../src/distribution.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";
import { loadHostManifest } from "../src/execution.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";
import { PLUGIN_BUNDLE_ENTRIES } from "../src/skill-catalog.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "bin/killsloprouter.mjs");
const example = JSON.parse(fs.readFileSync(path.join(root, "examples/design-brief.example.json")));
const requirement = { mode: "required", required_recipe_families: ["comparison-table"] };

function workspace(t, mutate = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-reference-delivery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const baseline = path.join(directory, "artifact");
  fs.mkdirSync(baseline);
  fs.writeFileSync(path.join(baseline, "index.html"), "<!doctype html><main>existing product</main>");
  const brief = structuredClone(example);
  mutate(brief);
  const briefPath = path.join(directory, "brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(brief));
  return { directory, baselinePath: baseline, briefPath,
    statePath: path.join(directory, ".killsloprouter/design.json"), root: directory };
}

function run(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
}

test("explicit reference requirement rejects internal planning/bright wording as reference evidence", (t) => {
  const space = workspace(t, (brief) => {
    brief.reference_requirement = requirement;
    brief.directions.forEach((direction) => {
      direction.aesthetic_sources = ["OWNER_DIRECTION.md", "internal planning report", "UI Bowl처럼 밝고 편안하게"];
    });
  });
  for (const invoke of [dryRunDesignExploration, startDesignExploration]) {
    assert.throws(() => invoke(space), /reference-required design is blocked/);
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(fs.existsSync(space.statePath.replace(/\.json$/, ".design")), false);
  }
});

test("real CLI start and dry-run fail before state/creator output when a required pack is absent", (t) => {
  const space = workspace(t, (brief) => { brief.reference_requirement = requirement; });
  const baselineDigest = hashArtifact(space.baselinePath);
  for (const extra of [["--dry-run"], ["--out", space.statePath]]) {
    const result = run(["design", "run", "--brief", space.briefPath,
      "--baseline", space.baselinePath, "--root", space.directory, "--require-reference", ...extra, "--json"]);
    assert.equal(result.status, 5, result.stderr);
    assert.match(result.stderr, /reference-required design is blocked/);
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(hashArtifact(space.baselinePath), baselineDigest);
  }
});

test("CLI assertion cannot silently upgrade a legacy no-reference brief", (t) => {
  const space = workspace(t);
  const result = run(["design", "run", "--brief", space.briefPath,
    "--baseline", space.baselinePath, "--require-reference", "--dry-run", "--json"]);
  assert.equal(result.status, 5, result.stderr);
  assert.match(result.stderr, /reference_requirement.mode=required/);
  assert.throws(() => assertDesignReferenceRequirement(example, true), /successor/);
});

test("ordinary exact-three flow remains manual and honestly reports no reference binding", (t) => {
  const space = workspace(t);
  const dry = dryRunDesignExploration(space);
  assert.equal(dry.direction_matrix.length, 9);
  assert.equal(dry.status, "manual_pending");
  assert.equal(dry.reference_delivery.status, "not_bound");
  const state = startDesignExploration(space);
  assert.equal(state.packets.length, 9);
  assert.equal(state.attempts.length, 9);
  assert.ok(state.attempts.every((attempt) => attempt.execution_status === "manual_pending"));
  const before = hashArtifact(space.statePath);
  const provenance = run(["design", "provenance", "--run", space.statePath, "--json"]);
  assert.equal(provenance.status, 0, provenance.stderr);
  const report = JSON.parse(provenance.stdout);
  assert.equal(report.status, "not_bound");
  assert.equal(report.reference_bound_creator_packets, 0);
  assert.equal(report.human_authorship_certified, false);
  assert.equal(report.state_digest, state.state_digest);
  assert.equal(hashArtifact(space.statePath), before);
  const text = run(["design", "status", "--run", space.statePath]);
  assert.match(text.stdout, /reference delivery: not_bound/);
  assert.match(text.stdout, /not a UI Bowl\/reference-derived/);
  const json = run(["design", "status", "--run", space.statePath, "--json"]);
  assert.deepEqual(JSON.parse(json.stdout), readDesignState(space.statePath));
});

test("resume assertion and retrofitted requirement both fail without changing a historical run", (t) => {
  const space = workspace(t);
  startDesignExploration(space);
  const original = fs.readFileSync(space.statePath, "utf8");
  assert.throws(() => resumeDesignExploration(space.statePath, { requireReference: true }), /successor/);
  assert.equal(fs.readFileSync(space.statePath, "utf8"), original);
  const state = JSON.parse(original);
  state.brief.reference_requirement = requirement;
  const { state_digest: _digest, ...body } = state;
  state.state_digest = canonicalDigest(body);
  fs.writeFileSync(space.statePath, JSON.stringify(state));
  assert.throws(() => readDesignState(space.statePath), /reference-required design is blocked/);
});

test("public continuation enforces the same assertion before a real fixture child can spawn", (t) => {
  const space = workspace(t);
  const state = startDesignExploration(space);
  const original = fs.readFileSync(space.statePath, "utf8");
  const marker = path.join(space.directory, "child-spawned");
  const entrypoint = path.join(root, "test/fixtures/design-host-adapter.mjs");
  const hostPath = path.join(space.directory, "host.json");
  fs.writeFileSync(hostPath, JSON.stringify({
    host_adapter_version: 1, allowed_providers: ["design-direction-agent"],
    granted_permissions: ["artifact:read", "evidence:write"],
    providers: { "design-direction-agent": {
      adapter: "agent-json-v1", entrypoint, entrypoint_digest: hashArtifact(entrypoint),
      entrypoint_graph_digest: sealedEntrypointGraphDigest(entrypoint), strength: 3,
      capabilities: ["design-direction-generation", "baseline-preservation", "responsive-prototype", "locale-prototype"],
      permissions: ["artifact:read", "evidence:write"], timeout_ms: 30_000,
      settings: { spawn_marker: marker, fail_attempts: [2] }
    } }
  }));
  const hostManifest = loadHostManifest(hostPath);
  assert.throws(() => continueDesignExploration(state, {
    requireReference: true, retry: "all", hostManifest
  }), /successor/);
  assert.equal(fs.existsSync(marker), false);
  assert.equal(fs.readFileSync(space.statePath, "utf8"), original);
});

test("provenance command rejects modified state instead of printing invented reference delivery", (t) => {
  const space = workspace(t);
  startDesignExploration(space);
  const state = JSON.parse(fs.readFileSync(space.statePath));
  state.reference_pack = { pack_digest: `sha256:${"1".repeat(64)}` };
  fs.writeFileSync(space.statePath, JSON.stringify(state));
  const result = run(["design", "provenance", "--run", space.statePath, "--json"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /state digest mismatch/);
  assert.equal(result.stdout, "");
});

test("a coherently resealed cached provenance report cannot replace verified default status", (t) => {
  const space = workspace(t);
  const state = startDesignExploration(space);
  state.reference_delivery = { status: "bound", note: "UI Bowl reference delivery verified",
    pack_digest: `sha256:${"1".repeat(64)}` };
  const { state_digest: _digest, ...body } = state;
  state.state_digest = canonicalDigest(body);
  fs.writeFileSync(space.statePath, JSON.stringify(state));
  assert.throws(() => readDesignState(space.statePath), /derived report/);
  for (const command of ["status", "provenance"]) {
    const result = run(["design", command, "--run", space.statePath]);
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
    assert.match(result.stderr, /derived report/);
  }
});

test("schema and runtime reject a weakening requirement or missing pack", () => {
  for (const value of [null, { mode: "optional", required_recipe_families: [] },
    { mode: "required" }, { mode: "required", required_recipe_families: ["tabs", "tabs"] },
    { mode: "required", required_recipe_families: ["../escape"] }, requirement]) {
    const brief = { ...structuredClone(example), reference_requirement: value };
    assert.throws(() => validateDesignBrief(brief));
    assert.throws(() => assertPublishedSchema("design-brief", brief));
  }
  assertPublishedSchema("design-brief", example);
  validateDesignBrief(example);
});

test("require-reference flag is never ignored by an unrelated command", () => {
  const result = run(["doctor", "--require-reference", "--json"]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /only supported by design/);
});

test("unified package exposes reference craft, onboarding and account-sync together", () => {
  const report = inspectDistribution();
  assert.equal(report.status, "available");
  assert.equal(report.features.length, 6);
  assert.equal(report.project_reference_bound, false);
  assert.equal(report.live_skill_loading_verified, false);
  const { distribution_digest: digest, ...body } = report;
  assert.equal(digest, canonicalDigest(body));
  const result = run(["capabilities", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), report);
});

test("distribution inventory does not trust a version string when feature files are missing", (t) => {
  const space = workspace(t);
  fs.mkdirSync(path.join(space.directory, ".codex-plugin"));
  fs.copyFileSync(path.join(root, ".codex-plugin/plugin.json"), path.join(space.directory, ".codex-plugin/plugin.json"));
  const report = inspectDistribution(space.directory);
  assert.equal(report.status, "incomplete");
  assert.ok(report.features.every((feature) => feature.status === "missing"));
});

test("a copied bundle without its reasoning registry fails installed capability preflight", (t) => {
  const space = workspace(t);
  const copy = path.join(space.directory, "partial-plugin");
  fs.mkdirSync(copy);
  for (const entry of PLUGIN_BUNDLE_ENTRIES.filter((item) => item !== "registry")) {
    fs.cpSync(path.join(root, entry), path.join(copy, entry), { recursive: true });
  }
  const report = inspectDistribution(copy);
  assert.equal(report.status, "incomplete");
  assert.equal(report.features.find((item) => item.id === "reference-intelligence").status, "missing");
  const result = spawnSync(process.execPath,
    [path.join(copy, "bin/killsloprouter.mjs"), "capabilities", "--json"],
    { cwd: space.directory, encoding: "utf8", timeout: 30_000 });
  assert.equal(result.status, 5, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "incomplete");
  const skillPath = path.join(copy, "skills/kill-slop-router/SKILL.md");
  const before = inspectDistribution(copy).distribution_digest;
  fs.appendFileSync(skillPath, "\nChanged entrypoint guidance\n");
  assert.notEqual(inspectDistribution(copy).distribution_digest, before);
});
