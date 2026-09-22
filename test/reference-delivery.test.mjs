import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  assertDesignReferenceRequirement, continueDesignExploration, dispatchDesignPackets, dryRunDesignExploration,
  inspectDesignStateLease, readDesignState, resumeDesignExploration, startDesignExploration, validateDesignBrief
} from "../src/design.mjs";
import { inspectDistribution } from "../src/distribution.mjs";
import { canonicalDigest, hashArtifact, snapshotArtifact } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";
import { loadHostManifest } from "../src/execution.mjs";
import { sealedEntrypointGraphDigest } from "../src/sealed-entrypoint.mjs";
import { PLUGIN_BUNDLE_ENTRIES } from "../src/skill-catalog.mjs";
import { fixtureOptOutPath, noReferenceFixtureBrief } from "./fixtures/design-no-reference.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "bin/killsloprouter.mjs");
const publicStarter = JSON.parse(fs.readFileSync(path.join(root, "examples/design-brief.example.json")));
const example = noReferenceFixtureBrief();
const requirement = { mode: "required", required_recipe_families: ["comparison-table"] };

function workspace(t, mutate = () => {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-reference-delivery-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const baseline = path.join(directory, "artifact");
  fs.mkdirSync(baseline);
  fs.writeFileSync(path.join(baseline, "index.html"), "<!doctype html><main>existing product</main>");
  const brief = structuredClone(example);
  mutate(brief);
  fs.copyFileSync(fixtureOptOutPath,
    path.join(directory, "design-reference-opt-out.example.json"));
  const briefPath = path.join(directory, "brief.json");
  fs.writeFileSync(briefPath, JSON.stringify(brief));
  return { directory, baselinePath: baseline, briefPath,
    decisionPath: path.join(directory, "design-reference-opt-out.example.json"),
    statePath: path.join(directory, ".killsloprouter/design.json"), root: directory };
}

function fixtureHost(space, settings = {}) {
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
      settings: { spawn_marker: marker, ...settings }
    } }
  }));
  return { marker, hostPath, hostManifest: loadHostManifest(hostPath) };
}

function seal(space, state) {
  const { state_digest: _digest, ...body } = state;
  state.state_digest = canonicalDigest(body);
  fs.writeFileSync(space.statePath, JSON.stringify(state));
  return state;
}

function ownerDecision(space, mutate) {
  const decision = JSON.parse(fs.readFileSync(space.decisionPath));
  mutate(decision);
  fs.writeFileSync(space.decisionPath, JSON.stringify(decision));
  const brief = JSON.parse(fs.readFileSync(space.briefPath));
  brief.reference_opt_out.digest = hashArtifact(space.decisionPath);
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
}

function rewritePacket(space, state, packet) {
  const { packet_digest: _digest, ...body } = packet;
  packet.packet_digest = canonicalDigest(body);
  const target = state.packet_files[packet.packet_id].resolved_path;
  fs.writeFileSync(target, JSON.stringify(packet));
  state.packet_files[packet.packet_id] = snapshotArtifact(target, { root: state.state_directory });
  for (const attempt of state.attempts.filter((item) => item.packet_id === packet.packet_id)) {
    attempt.packet_digest = packet.packet_digest;
  }
  return seal(space, state);
}

// Synthetic pre-gate shape only. Never migrate or re-seal a real historical
// ledger: old bytes must remain untouched while a successor resolves intent.
function historicalSpace(t) {
  const space = workspace(t);
  const state = startDesignExploration(space);
  delete state.brief.reference_opt_out;
  delete state.reference_opt_out_source;
  fs.writeFileSync(space.briefPath, JSON.stringify(state.brief));
  state.brief_source = snapshotArtifact(space.briefPath, { root: space.root });
  for (const packet of state.packets) {
    delete packet.design_task.reference_delivery;
    packet.design_task.brief_digest = state.brief_source.digest;
    rewritePacket(space, state, packet);
  }
  readDesignState(space.statePath);
  return space;
}

function run(args, cwd = root) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 30_000 });
}

test("public new-dashboard starter requires UI Bowl without a CLI flag or synthetic Owner waiver", (t) => {
  assert.equal(publicStarter.reference_requirement.mode, "required");
  assert.equal(Object.hasOwn(publicStarter, "reference_opt_out"), false);
  assert.equal(Object.hasOwn(publicStarter, "reference_pack"), false);
  assert.equal(fs.existsSync(path.join(root, "examples/design-reference-opt-out.example.json")), false);
  const space = workspace(t, (brief) => {
    delete brief.reference_opt_out;
    Object.assign(brief, structuredClone(publicStarter));
  });
  const host = fixtureHost(space);
  const baselineDigest = hashArtifact(space.baselinePath);
  assert.throws(() => assertPublishedSchema("design-brief", publicStarter),
    "the unbound starter is deliberately not an executable project brief");
  for (const invoke of [dryRunDesignExploration, startDesignExploration]) {
    assert.throws(() => invoke({ ...space, hostManifest: host.hostManifest, requireReference: false }),
      /reference-required design is blocked/);
  }
  for (const extra of [["--dry-run"], ["--out", space.statePath]]) {
    const result = run(["design", "run", "--brief", space.briefPath,
      "--baseline", space.baselinePath, "--host-config", host.hostPath, ...extra, "--json"]);
    assert.equal(result.status, 5, result.stderr);
    assert.match(result.stderr, /reference-required design is blocked/);
    assert.equal(result.stdout, "");
  }
  assert.equal(fs.existsSync(space.statePath), false);
  assert.equal(fs.existsSync(host.marker), false);
  assert.equal(hashArtifact(space.baselinePath), baselineDigest);
});

test("Owner Korean required-reference correction cannot be replaced by a synthetic no-reference file", (t) => {
  const space = workspace(t, (brief) => {
    brief.reference_requirement = structuredClone(publicStarter.reference_requirement);
    brief.directions[0].aesthetic_sources = ["지금 ksr이 ui bowl 레퍼런스를 필수로 두라고 안했어?"];
  });
  const host = fixtureHost(space);
  const before = hashArtifact(space.briefPath);
  for (const invoke of [dryRunDesignExploration, startDesignExploration]) {
    assert.throws(() => invoke({ ...space, hostManifest: host.hostManifest, requireReference: false }),
      /reference-required design is blocked/);
  }
  assert.equal(fs.existsSync(host.marker), false);
  assert.equal(fs.existsSync(space.statePath), false);
  assert.equal(hashArtifact(space.briefPath), before);
});

test("new visual exploration stops before dispatch when reference intent is unresolved", (t) => {
  const space = workspace(t, (brief) => { delete brief.reference_opt_out; });
  const host = fixtureHost(space);
  for (const invoke of [dryRunDesignExploration, startDesignExploration]) {
    assert.throws(() => invoke({ ...space, hostManifest: host.hostManifest }), /reference intent is unresolved/);
    assert.equal(fs.existsSync(space.statePath), false);
    assert.equal(fs.existsSync(host.marker), false);
  }
  const result = run(["design", "run", "--brief", space.briefPath,
    "--baseline", space.baselinePath, "--host-config", host.hostPath, "--out", space.statePath, "--json"]);
  assert.equal(result.status, 5, result.stderr);
  assert.match(result.stderr, /reference-first/);
  assert.equal(fs.existsSync(space.statePath), false);
  assert.equal(fs.existsSync(host.marker), false);
});

test("historical status/provenance remain readable but resume, manual ingest and dispatch need a successor", (t) => {
  const space = historicalSpace(t);
  const state = readDesignState(space.statePath);
  const host = fixtureHost(space);
  const before = fs.readFileSync(space.statePath, "utf8");
  const beforePackets = state.packets.map((packet) => hashArtifact(state.packet_files[packet.packet_id].resolved_path));
  for (const command of ["status", "provenance"]) {
    const result = run(["design", command, "--run", space.statePath, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    if (command === "provenance") {
      const report = JSON.parse(result.stdout);
      assert.equal(report.intent_status, "unresolved-historical");
      assert.match(report.next_action, /successor/);
    }
  }
  for (const invoke of [
    () => resumeDesignExploration(space.statePath, { retry: "all", hostManifest: host.hostManifest }),
    () => continueDesignExploration(state, { resultPaths: ["not-read-before-gate.json"] }),
    () => dispatchDesignPackets(state, path.join(space.directory, "dispatched"))
  ]) assert.throws(invoke, /reference intent is unresolved/);
  const resumed = run(["design", "run", "--resume", space.statePath, "--host-config", host.hostPath, "--retry", "all", "--json"]);
  assert.equal(resumed.status, 5, resumed.stderr);
  assert.match(resumed.stderr, /successor/);
  assert.equal(fs.existsSync(host.marker), false);
  assert.equal(fs.existsSync(path.join(space.directory, "dispatched")), false);
  assert.equal(fs.readFileSync(space.statePath, "utf8"), before);
  assert.deepEqual(state.packets.map((packet) => hashArtifact(state.packet_files[packet.packet_id].resolved_path)), beforePackets);
});

for (const wording of ["진행해", "이어서 진행해", "최신 KSR로 해", "UI Bowl 아니야?",
  "UI Bowl 레퍼런스를 필수로 두라고 안했어?", "Playwright 통과했으니까 디자인해"]) {
  test(`conversation wording is not a no-reference Owner decision: ${wording}`, (t) => {
    const space = workspace(t, (brief) => {
      delete brief.reference_opt_out;
      brief.directions.forEach((direction) => { direction.aesthetic_sources = [wording]; });
    });
    assert.throws(() => dryRunDesignExploration(space), /reference intent is unresolved/);
    const decision = JSON.parse(fs.readFileSync(space.decisionPath));
    decision.decision = wording;
    assert.throws(() => assertPublishedSchema("design-reference-opt-out", decision));
  });
}

for (const [name, mutate, error] of [
  ["wrong project", (d) => { d.project_id = "another-project"; }, /project_id scope mismatch/],
  ["wrong surface", (d) => { d.surface = "consumer-product-ui"; }, /surface scope mismatch/],
  ["wrong screen", (d) => { d.screen_id = "another-screen"; }, /screen_id scope mismatch/],
  ["generic continue", (d) => { d.decision = "진행해"; }, /explicit no-reference/],
  ["missing Owner", (d) => { delete d.owner_id; }, /owner_id/],
  ["empty rationale", (d) => { d.rationale = "  "; }, /rationale/],
  ["non timestamp", (d) => { d.decided_at = "2026-09-22"; }, /decided_at/],
  ["invented approval field", (d) => { d.approved = true; }, /unsupported/]
]) test(`no-reference decision rejects ${name} before execution`, (t) => {
  const space = workspace(t);
  const decision = JSON.parse(fs.readFileSync(space.decisionPath));
  mutate(decision);
  fs.writeFileSync(space.decisionPath, JSON.stringify(decision));
  const brief = JSON.parse(fs.readFileSync(space.briefPath));
  brief.reference_opt_out.digest = hashArtifact(space.decisionPath);
  fs.writeFileSync(space.briefPath, JSON.stringify(brief));
  assert.throws(() => startDesignExploration(space), error);
  assert.equal(fs.existsSync(space.statePath), false);
});

test("missing/mismatched Owner decision and a decision inside child output fail before state creation", (t) => {
  for (const mutation of ["missing", "mismatch", "child-output"]) {
    const space = workspace(t);
    if (mutation === "missing") fs.unlinkSync(space.decisionPath);
    if (mutation === "mismatch") fs.appendFileSync(space.decisionPath, "\n");
    if (mutation === "child-output") {
      const target = path.join(space.directory, ".killsloprouter/design.design/owner.json");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(space.decisionPath, target);
      const brief = JSON.parse(fs.readFileSync(space.briefPath));
      brief.reference_opt_out.path = target;
      fs.writeFileSync(space.briefPath, JSON.stringify(brief));
    }
    assert.throws(() => startDesignExploration(space), /opt-out|child-writable|state directory already exists/);
    assert.equal(fs.existsSync(space.statePath), false);
  }
});

test("resume rechecks opt-out bytes and physical identity without spawning a child", (t) => {
  for (const mutation of ["tamper", "removed", "physical-replacement", "missing-binding", "packet-claim"]) {
    const space = workspace(t);
    const state = startDesignExploration(space);
    const host = fixtureHost(space);
    if (mutation === "tamper") fs.appendFileSync(space.decisionPath, "\n");
    if (mutation === "removed") fs.unlinkSync(space.decisionPath);
    if (mutation === "physical-replacement") {
      const content = fs.readFileSync(space.decisionPath);
      fs.renameSync(space.decisionPath, `${space.decisionPath}.old`);
      fs.writeFileSync(space.decisionPath, content);
    }
    if (mutation === "missing-binding") { delete state.reference_opt_out_source; seal(space, state); }
    if (mutation === "packet-claim") {
      state.packets[0].design_task.reference_delivery.source_derived_craft = true;
      rewritePacket(space, state, state.packets[0]);
    }
    const before = fs.readFileSync(space.statePath, "utf8");
    assert.throws(() => resumeDesignExploration(space.statePath, { hostManifest: host.hostManifest, retry: "all" }), /opt-out/);
    assert.equal(fs.existsSync(host.marker), false);
    assert.equal(fs.readFileSync(space.statePath, "utf8"), before);
  }
});

test("a scoped opt-out binds child provenance and ordinary resume can execute the fixture creator", (t) => {
  const space = workspace(t);
  const state = startDesignExploration(space);
  assertPublishedSchema("design-reference-opt-out", JSON.parse(fs.readFileSync(space.decisionPath)));
  assertPublishedSchema("design-exploration-run", state);
  for (const packet of state.packets) {
    assertPublishedSchema("design-packet", packet);
    assert.deepEqual(packet.design_task.reference_delivery, {
      status: "not_bound", intent_status: "owner-opt-out",
      owner_decision_digest: hashArtifact(space.decisionPath), source_derived_craft: false
    });
    assert.doesNotMatch(JSON.stringify(packet), /synthetic-example-owner|design-reference-opt-out.example.json/);
  }
  const host = fixtureHost(space);
  const resumed = resumeDesignExploration(space.statePath, { hostManifest: host.hostManifest });
  assert.equal(fs.existsSync(host.marker), true);
  assert.equal(resumed.results.filter((record) => record.normalized.kind === "direction-candidate").length, 9);
  assert.equal(resumed.phase, "direction-browser-evidence");
  assert.equal(resumed.status, "manual_pending");
  assert.equal(resumed.shortlist, null);
  assert.equal(resumed.approval, null);
  readDesignState(space.statePath);
});

test("parent aliases and every declared creator/critic/browser provider cannot make the reference opt-out", (t) => {
  const ids = new Set(["kill-slop-router", "KillSlopRouter", "killsloprouter:kill-slop-router",
    "  KILLSLOPROUTER  ", ...example.directions.map((d) => d.creator_provider_id),
    ...example.color_strategies.map((c) => c.creator_provider_id), ...Object.values(example.providers)]);
  for (const ownerId of ids) {
    const space = workspace(t);
    ownerDecision(space, (decision) => { decision.owner_id = ownerId; });
    const host = fixtureHost(space);
    for (const invoke of [dryRunDesignExploration, startDesignExploration]) {
      assert.throws(() => invoke({ ...space, hostManifest: host.hostManifest }), /Owner|orchestrator/);
    }
    assert.equal(fs.existsSync(space.statePath), false, ownerId);
    assert.equal(fs.existsSync(host.marker), false, ownerId);
  }
});

test("newly discovered creator actor cannot also be the opt-out Owner at child ingest", (t) => {
  const space = workspace(t);
  ownerDecision(space, (decision) => { decision.owner_id = "external-person"; });
  startDesignExploration(space);
  const host = fixtureHost(space, { actor_id: "  EXTERNAL-PERSON  " });
  const state = resumeDesignExploration(space.statePath, { hostManifest: host.hostManifest });
  assert.equal(fs.existsSync(host.marker), true, "the previously unknown actor is learned only from the child result");
  assert.equal(state.status, "blocked");
  assert.equal(state.results.length, 0);
  assert.ok(state.attempts.filter((a) => a.attempt === 2).every((a) =>
    a.execution_status === "blocked_result_validation" && /opt-out Owner/.test(a.error)));
  assert.equal(state.phase, "direction-generation");
  readDesignState(space.statePath);
});

test("opt-out mutation immediately before child spawn fails closed and retains the unresolved lease", (t) => {
  const space = workspace(t);
  startDesignExploration(space);
  const host = fixtureHost(space);
  let injected = false;
  assert.throws(() => resumeDesignExploration(space.statePath, {
    hostManifest: host.hostManifest,
    faultInjector(point) {
      if (point === "after-child-lease-before-spawn" && !injected) {
        injected = true;
        fs.appendFileSync(space.decisionPath, "\n");
      }
    }
  }), /opt-out Owner decision changed/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(host.marker), false);
  assert.equal(inspectDesignStateLease(space.statePath).status, "locked");
});

test("explicit reference requirement rejects internal planning/bright wording as reference evidence", (t) => {
  const space = workspace(t, (brief) => {
    delete brief.reference_opt_out;
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
  const space = workspace(t, (brief) => { delete brief.reference_opt_out; brief.reference_requirement = requirement; });
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

test("CLI assertion cannot silently upgrade an opted-out brief", (t) => {
  const space = workspace(t);
  const result = run(["design", "run", "--brief", space.briefPath,
    "--baseline", space.baselinePath, "--require-reference", "--dry-run", "--json"]);
  assert.equal(result.status, 5, result.stderr);
  assert.match(result.stderr, /reference_requirement.mode=required/);
  assert.throws(() => assertDesignReferenceRequirement(example, true), /successor/);
});

test("Owner opted-out exact-three flow remains manual and honestly reports no reference binding", (t) => {
  const space = workspace(t);
  const dry = dryRunDesignExploration(space);
  assert.equal(dry.direction_matrix.length, 9);
  assert.equal(dry.status, "manual_pending");
  assert.equal(dry.reference_delivery.status, "not_bound");
  assert.equal(dry.reference_delivery.intent_status, "owner-opt-out");
  const state = startDesignExploration(space);
  assert.equal(state.packets.length, 9);
  assert.equal(state.attempts.length, 9);
  assert.ok(state.attempts.every((attempt) => attempt.execution_status === "manual_pending"));
  const before = hashArtifact(space.statePath);
  const provenance = run(["design", "provenance", "--run", space.statePath, "--json"]);
  assert.equal(provenance.status, 0, provenance.stderr);
  const report = JSON.parse(provenance.stdout);
  assert.equal(report.status, "not_bound");
  assert.equal(report.intent_status, "owner-opt-out");
  assert.equal(report.opt_out_decision_digest, hashArtifact(space.decisionPath));
  assert.equal(report.reference_bound_creator_packets, 0);
  assert.deepEqual(report.selected_references, []);
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
  assert.equal(report.features.length, 8);
  assert.equal(report.features.find((item) => item.id === "reference-research-library").status, "available");
  assert.equal(report.features.find((item) => item.id === "reference-selection-handoff").status, "available");
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
