import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { sourceCraftSpace, sourceCraftHost, sourceCraftScope, saveSourceCraftAuthority, withoutBrowser } from "./fixtures/source-craft-space.mjs";
import { referenceCandidateSpace } from "./fixtures/reference-candidate-space.mjs";
import { startDesignExploration, dryRunDesignExploration, readDesignState, resumeDesignExploration,
  dispatchDesignPackets, verifySourceCraftCohort } from "../src/design.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const cleanup = space => fs.rmSync(space.directory, { recursive: true, force: true });
const saveBrief = space => fs.writeFileSync(space.briefPath, JSON.stringify(space.brief));
const rejectedBeforeState = (space, expression = /source craft|source-craft|source_craft|authority|rights|ENOENT/i) => {
  assert.throws(() => dryRunDesignExploration(space), expression);
  assert.throws(() => startDesignExploration(space), expression);
  assert.equal(fs.existsSync(space.statePath), false);
};

test("source craft opt-in has a fourth bounded stage while creator packets stay source-blind", () => {
  const space = sourceCraftSpace();
  try {
    assertPublishedSchema("design-brief", space.brief);
    assertPublishedSchema("source-craft-authority", space.authority);
    const dry = dryRunDesignExploration(space);
    assert.equal(dry.readiness.length, 4);
    const state = startDesignExploration(space);
    assert.equal(state.results.length, 0);
    assert.equal(state.packets.length, 1);
    assert.equal(state.approval, null);
    assertPublishedSchema("design-exploration-run", state);
    for (const packet of state.packets) {
      assertPublishedSchema("design-packet", packet);
      assert.equal(packet.design_task.source_craft_review, undefined);
      assert.ok(!packet.permission_scopes?.includes("reference-evidence:read"));
      const body = JSON.stringify(packet);
      for (const privateValue of [space.authorityPath, space.rightsPath, space.authority.primary_reference_id,
        space.authority.rights_basis.assertion]) assert.ok(!body.includes(privateValue));
    }
    assert.deepEqual(state.brief.reference_pack.reviewer_source_access.purposes,
      ["promotional-citation-firewall", "source-composition-independence"]);
    assert.throws(() => verifySourceCraftCohort(state), /every declared cohort/);
    assert.equal(verifySourceCraftCohort(state, { allowPending: true }), null);
  } finally { cleanup(space); }
});

test("source craft missing rights, wrong purpose and expanded permissions fail before creator dispatch", () => {
  const space = sourceCraftSpace();
  try {
    const initial = structuredClone(space.authority);
    for (const mutate of [
      authority => { delete authority.rights_basis; },
      authority => { authority.purpose = "source-composition-independence"; },
      authority => { authority.purpose = "promotional-citation-firewall"; },
      authority => { authority.status = "pending"; },
      ...["creator_access", "browser_access", "redistribution", "network_external", "source_duplication",
        "human_authorship", "owner_approval_granted"].map(key => authority => { authority[key] = true; })
    ]) {
      space.authority = structuredClone(initial);
      mutate(space.authority);
      saveSourceCraftAuthority(space);
      rejectedBeforeState(space);
    }
    const sentinel = "synthetic-private-rights-path-must-not-reach-cli";
    space.authority = structuredClone(initial);
    space.authority.rights_basis.evidence.path = `${sentinel}.json`;
    saveSourceCraftAuthority(space);
    const cli = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "run",
      "--brief", space.briefPath, "--baseline", space.baseline, "--out", space.statePath, "--json"], { encoding: "utf8" });
    assert.notEqual(cli.status, 0);
    assert.notEqual(cli.status, 6);
    assert.ok(!`${cli.stdout}${cli.stderr}`.includes(sentinel));
    assert.ok(!`${cli.stdout}${cli.stderr}`.includes(space.authorityPath));
    assert.equal(fs.existsSync(space.statePath), false);
  } finally { cleanup(space); }
});

test("source craft authority binds exact project, candidate, primary, pack, producer and comparison slots", () => {
  const space = sourceCraftSpace();
  try {
    const initial = structuredClone(space.authority);
    for (const field of ["project_id", "screen_id", "comparison_id", "candidate_id", "primary_reference_id",
      "pack_digest", "producer_state_digest", "task_frame_digest", "cohort_digest"]) {
      space.authority = structuredClone(initial);
      space.authority[field] = field.endsWith("_digest") ? canonicalDigest(`substituted ${field}`) : `different-${field}`;
      saveSourceCraftAuthority(space);
      rejectedBeforeState(space, /binding mismatch/);
    }
    const otherCapture = space.pack.evidence_manifest.find(item => item.kind === "source-capture" &&
      item.reference_id !== initial.primary_reference_id);
    assert.ok(otherCapture);
    for (const mutate of [
      authority => { authority.capture_digests = [otherCapture.digest]; authority.comparison_slots.forEach(slot => { slot.capture_digest = otherCapture.digest; }); },
      authority => { authority.comparison_slots[0].viewport = "unplanned"; },
      authority => { authority.comparison_slots[0].state = "unplanned"; },
      authority => { authority.comparison_slots[0].locale = "unplanned"; },
      authority => { authority.comparison_slots[0].relationship_id = "unbound-relationship"; },
      authority => { authority.comparison_slots = []; },
      authority => { authority.target_invention_relationship_ids = ["identity-value-treatment"]; }
    ]) {
      space.authority = structuredClone(initial); mutate(space.authority);
      saveSourceCraftAuthority(space); rejectedBeforeState(space);
    }
  } finally { cleanup(space); }
});

test("source craft issuer and fixed reviewer reject canonical creator, browser, target critic and producer aliases", () => {
  const space = sourceCraftSpace();
  try {
    const initial = structuredClone(space.authority);
    const identities = [space.brief.directions[0].creator_provider_id, space.brief.providers.browser_evidence,
      space.brief.providers.specimen_reviewer, space.producer.results[0].normalized.actor.actor_id];
    const alias = value => `  ${value.toUpperCase()}  `;
    for (const field of ["issuer_id", "reviewer_provider_id", "reviewer_actor_id"]) for (const identity of identities) {
      space.authority = structuredClone(initial);
      space.authority[field] = alias(identity);
      saveSourceCraftAuthority(space);
      rejectedBeforeState(space, /independent|reviewer|issuer/);
    }
    space.authority = structuredClone(initial);
    space.authority.issuer_id = initial.reviewer_actor_id;
    saveSourceCraftAuthority(space);
    rejectedBeforeState(space, /issuer.*reviewer/);
  } finally { cleanup(space); }
});

test("source craft external files must be present, pinned and outside the creator-readable baseline", () => {
  const space = sourceCraftSpace();
  try {
    const rightsBytes = fs.readFileSync(space.rightsPath);
    fs.appendFileSync(space.rightsPath, "tamper");
    rejectedBeforeState(space, /rights.*digest/);
    fs.writeFileSync(space.rightsPath, rightsBytes);
    const initial = structuredClone(space.authority);
    space.authority.rights_basis.evidence.path = "missing-rights.json";
    saveSourceCraftAuthority(space); rejectedBeforeState(space);
    const privateRights = path.join(space.baseline, "source-craft-rights.json");
    fs.writeFileSync(privateRights, rightsBytes);
    space.authority = structuredClone(initial);
    space.authority.rights_basis.evidence = { path: path.relative(space.directory, privateRights), digest: hashArtifact(privateRights) };
    Object.assign(space.authority, sourceCraftScope(space));
    saveSourceCraftAuthority(space); rejectedBeforeState(space, /outside.*baseline/);
    space.authority = structuredClone(initial); saveSourceCraftAuthority(space);
    const privateAuthority = path.join(space.baseline, "source-craft-authority.json");
    fs.copyFileSync(space.authorityPath, privateAuthority);
    space.brief.source_craft_review.authority = { path: path.relative(space.directory, privateAuthority), digest: hashArtifact(privateAuthority) };
    saveBrief(space); rejectedBeforeState(space, /outside.*baseline/);
  } finally { cleanup(space); }
});

test("source craft authority and rights tampering are rejected on read, resume and packet dispatch", () => {
  for (const targetField of ["authorityPath", "rightsPath"]) {
    const space = sourceCraftSpace();
    try {
      const state = startDesignExploration(space);
      assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
      const target = space[targetField];
      const initial = fs.readFileSync(target);
      fs.appendFileSync(target, " ");
      assert.throws(() => readDesignState(space.statePath), /authority|rights|digest|changed/);
      assert.throws(() => resumeDesignExploration(space.statePath), /authority|rights|digest|changed/);
      const out = path.join(space.directory, "tampered-dispatch");
      assert.throws(() => dispatchDesignPackets(state, out), /authority|rights|digest|changed/);
      assert.equal(fs.existsSync(out), false);
      fs.writeFileSync(target, initial);
      // Restoring bytes does not restore the externally pinned physical identity.
      assert.throws(() => readDesignState(space.statePath), /identity|binding|changed/);
    } finally { cleanup(space); }
  }
});

test("real creator child accepts opt-in obligations but source child cannot spawn before official browser evidence", () => {
  const space = sourceCraftSpace();
  try {
    const marker = path.join(space.directory, "source-child-spawned.txt");
    const state = startDesignExploration({ ...space,
      hostManifest: sourceCraftHost(space, { sourceCraft: { spawn_marker: marker } }, withoutBrowser) });
    assert.deepEqual(state.results.map(item => item.normalized.kind), ["direction-candidate"], JSON.stringify(state.blockers));
    assert.equal(state.phase, "specimen-browser-evidence");
    assert.equal(state.packets.some(item => item.design_task.kind === "source-craft-review"), false);
    assert.equal(fs.existsSync(marker), false);
    assert.equal(state.attempts.some(item => item.packet_id === "source-craft-review"), false);
    for (const packet of state.packets) {
      const body = JSON.stringify(packet);
      assert.equal(packet.design_task.source_craft_review, undefined);
      for (const capture of space.pack.evidence_manifest.filter(item => item.kind === "source-capture")) {
        assert.ok(!body.includes(capture.digest));
      }
      assert.ok(!body.includes(space.authorityPath));
      assert.ok(!body.includes(space.rightsPath));
    }
    assert.equal(readDesignState(space.statePath).state_digest, state.state_digest);
  } finally { cleanup(space); }
});

test("source access waits for every predeclared cohort member without fabricating missing browser or target review", () => {
  const spaces = [sourceCraftSpace({ count: 2 }), sourceCraftSpace({ count: 2 })];
  try {
    for (const space of spaces) {
      space.brief.reference_candidate.planned_state_paths = spaces.map(item => item.statePath);
      Object.assign(space.authority, sourceCraftScope(space));
      saveSourceCraftAuthority(space);
    }
    const first = startDesignExploration(spaces[0]);
    assert.throws(() => verifySourceCraftCohort(first), /every declared cohort/);
    const second = startDesignExploration(spaces[1]);
    for (const state of [first, second]) {
      assert.equal(verifySourceCraftCohort(state, { states: [first, second], allowPending: true }), null);
      assert.throws(() => verifySourceCraftCohort(state, { states: [first, second] }), /every declared cohort/);
      assert.equal(state.results.length, 0);
      assert.equal(state.packets.some(item => item.design_task.kind === "source-craft-review"), false);
    }
  } finally { spaces.forEach(cleanup); }
});

test("source craft cohort guards reject identity and historical executable aliases before binding synthetic records", () => {
  const space = sourceCraftSpace();
  try {
    const initial = startDesignExploration(space);
    // These are deliberately incomplete, in-memory rejection probes. They are
    // never persisted, accepted by ingest, or described as browser evidence.
    const probe = () => {
      const state = structuredClone(initial);
      state.results = ["direction-candidate", "browser-evidence", "specimen-review"].map(kind => ({
        normalized: { kind, actor: { actor_id: `synthetic-${kind}-actor` } }
      }));
      return state;
    };
    for (const kind of ["direction-candidate", "browser-evidence", "specimen-review"]) {
      const state = probe();
      state.results.find(item => item.normalized.kind === kind).normalized.actor.actor_id =
        `  ${space.authority.reviewer_actor_id.toUpperCase()}  `;
      assert.throws(() => verifySourceCraftCohort(state, { states: [state] }), /independent|recipients/);
    }
    for (const kind of ["direction-candidate", "browser-evidence", "specimen-review"]) for (const field of ["digest", "graph_digest", "physical_identity_digest", "provider_declaration_digest"]) {
      const state = probe();
      const packetId = `synthetic-${kind}`;
      state.packets.push({ packet_id: packetId, design_task: { kind } });
      const sourceAuthority = { provider_declaration_digest: canonicalDigest("source declaration"),
        adapter_entrypoint: { digest: canonicalDigest("source bytes"), graph_digest: canonicalDigest("source graph"),
          physical_identity_digest: canonicalDigest("source physical identity") } };
      const restricted = { provider_declaration_digest: canonicalDigest("restricted declaration"),
        adapter_entrypoint: { digest: canonicalDigest("restricted bytes"), graph_digest: canonicalDigest("restricted graph"),
          physical_identity_digest: canonicalDigest("restricted physical identity") } };
      if (field === "provider_declaration_digest") restricted[field] = sourceAuthority[field];
      else restricted.adapter_entrypoint[field] = sourceAuthority.adapter_entrypoint[field];
      state.attempts = [{ packet_id: packetId, adapter: "agent-json-v1", execution_status: "ran", execution_authority: restricted },
        { packet_id: "source-craft-review", adapter: "agent-json-v1", execution_status: "blocked_execution_error", execution_authority: sourceAuthority }];
      assert.throws(() => verifySourceCraftCohort(state, { states: [state] }), /executable aliases/);
    }
  } finally { cleanup(space); }
});

test("source craft is explicit opt-in: historical reference-candidate API and CLI retain three-stage flow", () => {
  const space = referenceCandidateSpace();
  try {
    const dry = dryRunDesignExploration(space);
    assert.equal(dry.readiness.length, 3);
    assert.equal(space.brief.source_craft_review, undefined);
    const state = startDesignExploration(space);
    assert.equal(state.source_craft_authority, undefined);
    assert.ok(state.packets.every(item => item.design_task.kind !== "source-craft-review"));
    const cli = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", "run",
      "--brief", space.briefPath, "--baseline", space.baseline, "--out", path.join(space.directory, "cli-state.json"), "--dry-run", "--json"],
    { encoding: "utf8", cwd: space.directory });
    assert.equal(cli.status, 6, cli.stderr); // Existing manual_pending, not opt-in source review.
    assert.equal(JSON.parse(cli.stdout).readiness.length, 3);
  } finally { cleanup(space); }
});

test("source craft CLI compare, select, recover and malformed JSON errors keep private diagnostics out of output", () => {
  const space = sourceCraftSpace();
  try {
    const sentinel = "PRIVATE_9Q";
    const privateRightsPath = path.join(space.directory, `${sentinel}-rights.json`);
    fs.renameSync(space.rightsPath, privateRightsPath);
    space.authority.rights_basis.evidence.path = path.basename(privateRightsPath);
    saveSourceCraftAuthority(space);
    const state = startDesignExploration(space);
    const stateBytes = fs.readFileSync(space.statePath);
    // Removing a bound synthetic evidence file creates a real private-path
    // diagnostic without inventing accepted browser evidence or source review.
    fs.renameSync(privateRightsPath, path.join(space.directory, "retained-private-rights.json"));
    assert.throws(() => readDesignState(space.statePath), new RegExp(sentinel));

    const out = path.join(space.directory, "private-error-comparison-output.json");
    const comparisonPath = path.join(space.directory, "private-error-comparison-input.json");
    // A deliberately incomplete rejection probe: the valid body digest only
    // reaches the real state revalidation failure. This is never published as
    // an accepted comparison, selectable result, or evidence of a browser run.
    const comparisonBody = { design_specimen_comparison_version: 1,
      candidates: [{ state_path: space.statePath, source_craft_review: { status: "pending" } }] };
    fs.writeFileSync(comparisonPath, JSON.stringify({ ...comparisonBody,
      comparison_digest: canonicalDigest(comparisonBody) }));
    const decisionPath = path.join(space.directory, "unused-owner-decision.json");
    fs.writeFileSync(decisionPath, "{}");
    const expectPrivateFailure = args => {
      const result = spawnSync(process.execPath, [path.resolve("bin/killsloprouter.mjs"), "design", ...args], { encoding: "utf8" });
      assert.ok(Number.isInteger(result.status) && result.status > 0 && result.status !== 6);
      assert.equal(result.stdout, "");
      assert.match(result.stderr, /blocked under the private-evidence output boundary/);
      for (const secret of [sentinel, privateRightsPath, space.authorityPath]) {
        assert.ok(!`${result.stdout}${result.stderr}`.includes(secret), `${args[0]} leaked private diagnostic data`);
      }
    };
    expectPrivateFailure(["compare", "--runs", space.statePath, "--out", out, "--json"]);
    expectPrivateFailure(["select", "--comparison", comparisonPath, "--decision", decisionPath, "--json"]);
    assert.equal(fs.existsSync(out), false);
    assert.equal(fs.existsSync(`${comparisonPath}.selection.json`), false);

    const leaseDirectory = `${space.statePath}.lease`;
    fs.mkdirSync(leaseDirectory);
    const malformedLeasePath = path.join(leaseDirectory, "lease.json");
    fs.writeFileSync(malformedLeasePath, sentinel);
    const recoveryOptions = ["--owner-token", "synthetic-unusable-owner-token",
      "--acquired-at", "2026-10-06T00:00:00.000Z", "--state-digest", state.state_digest, "--json"];
    expectPrivateFailure(["recover", "--state", space.statePath, ...recoveryOptions]);
    assert.equal(fs.readFileSync(malformedLeasePath, "utf8"), sentinel);
    assert.deepEqual(fs.readFileSync(space.statePath), stateBytes);

    // Privacy is unknown when JSON cannot be parsed. Fail closed rather than
    // exposing parser snippets, including through indirect comparison inputs.
    const malformedPath = path.join(space.directory, `${sentinel}-malformed.json`);
    fs.writeFileSync(malformedPath, sentinel);
    for (const args of [
      ["status", "--run", malformedPath, "--json"],
      ["run", "--brief", malformedPath, "--baseline", space.baseline, "--out", out, "--json"],
      ["compare", "--runs", malformedPath, "--out", out, "--json"],
      ["select", "--comparison", malformedPath, "--decision", decisionPath, "--json"],
      ["recover", "--state", malformedPath, ...recoveryOptions]
    ]) expectPrivateFailure(args);
    assert.equal(fs.existsSync(out), false);
    assert.equal(fs.existsSync(`${malformedPath}.selection.json`), false);
    assert.equal(fs.readFileSync(malformedPath, "utf8"), sentinel);
    assert.deepEqual(fs.readFileSync(space.statePath), stateBytes);
  } finally { cleanup(space); }
});
