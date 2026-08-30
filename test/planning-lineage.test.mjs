import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { canonicalDigest, hashArtifact, sha256 } from "../src/integrity.mjs";
import {
  resolvePlanningGate,
  verifyBaselineLineage,
  verifyPlanningGateForAudit
} from "../src/planning.mjs";

const startedAt = "2026-08-29T00:00:00.000Z";

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function replaceWithSameBytes(filePath) {
  const replacement = `${filePath}.same-bytes-replacement`;
  fs.writeFileSync(replacement, fs.readFileSync(filePath), { flag: "wx" });
  fs.renameSync(replacement, filePath);
}

function createFixture({
  candidateVersion = "99.0.0",
  supersedesParent = false,
  includeOwnerGate = true
} = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lineage-"));
  const parent = path.join(directory, "store-parent-v2.2.39.html");
  const candidate = path.join(directory, "policy-slice-v99.html");
  const receiptPath = path.join(directory, "planning.json");
  const profilePath = path.join(directory, "profile.json");
  const approvalPath = path.join(directory, "candidate-scope-owner-approval.json");
  fs.writeFileSync(parent, "<!doctype html><main>all-menu parent baseline</main>\n");
  fs.writeFileSync(candidate, "<!doctype html><main>latest policy slice</main>\n");
  const baselineLineage = {
    baseline_lineage_version: 1,
    lineage_id: "store-operator/policy",
    relationship: "slice-of",
    parent_baseline: {
      id: "store-parent",
      version: "2.2.39",
      artifacts: [{ path: path.basename(parent), digest: hashArtifact(parent) }]
    },
    candidate: {
      id: "store-policy-slice",
      version: candidateVersion,
      slice_id: "policy-source-to-setting",
      artifacts: [{ path: path.basename(candidate), digest: hashArtifact(candidate) }]
    },
    inheritance: {
      inherits: ["global shell", "navigation", "visual language"],
      slice_owned: ["policy workflow", "policy state model"],
      forbidden_parent_changes: ["silent global token replacement", "implicit parent promotion"]
    },
    promotion: {
      authority: "explicit-owner-only",
      supersedes_parent: supersedesParent
    }
  };
  const gates = {
    G6: {
      status: "passed",
      evidence: [{ kind: "mockup", path: path.basename(candidate), digest: hashArtifact(candidate) }]
    }
  };
  if (includeOwnerGate) {
    writeJson(approvalPath, {
      status: "approved",
      owner_id: "fixture-owner",
      lineage_id: baselineLineage.lineage_id,
      baseline_lineage_digest: canonicalDigest(baselineLineage),
      decision_scope: "candidate-slice-binding",
      parent_promotion: false,
      candidate: baselineLineage.candidate,
      decided_at: startedAt,
      note: "Bind this exact candidate as a slice without promoting the parent."
    });
    gates.G7 = {
      status: "approved",
      evidence: [{
        kind: "approved-artifact",
        path: path.basename(candidate),
        digest: hashArtifact(candidate)
      }, {
        kind: "owner-approval",
        path: path.basename(approvalPath),
        digest: hashArtifact(approvalPath)
      }]
    };
  }
  writeJson(receiptPath, {
    planning_gate_version: 1,
    protocol: { id: "fixture-planning", version: "1", authority: "fixture-owner" },
    project_id: "lineage-product",
    surface: "operator-product-ui",
    scope_id: "policy-source-to-setting",
    phase: "phase_2",
    baseline_lineage: baselineLineage,
    gates,
    updated_at: startedAt
  });
  const profile = {
    project_id: "lineage-product",
    planning: { required: true, receipt: receiptPath }
  };
  writeJson(profilePath, profile);
  const input = {
    surface: "operator-product-ui",
    task: "audit",
    scope: "mockup"
  };
  return {
    directory,
    parent,
    candidate,
    receiptPath,
    profilePath,
    approvalPath,
    profile,
    input
  };
}

function resolveFixture(fixture, artifacts = [fixture.candidate]) {
  return resolvePlanningGate({
    profile: fixture.profile,
    profilePath: fixture.profilePath,
    input: fixture.input,
    artifacts,
    root: fixture.directory
  });
}

test("a newer slice remains attached to the immutable parent instead of becoming the parent", () => {
  const fixture = createFixture({ candidateVersion: "999.0.0" });
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "ready");
    assert.equal(gate.enforced, true);
    assert.equal(gate.lineage_required, true);
    assert.equal(gate.baseline_lineage.relationship, "slice-of");
    assert.equal(gate.baseline_lineage.parent_baseline.version, "2.2.39");
    assert.equal(gate.baseline_lineage.candidate.version, "999.0.0");
    assert.equal(gate.baseline_lineage.promotion.authority, "explicit-owner-only");
    assert.equal(gate.baseline_lineage.promotion.supersedes_parent, false);
    assert.match(gate.baseline_lineage.lineage_digest, /^sha256:[a-f0-9]{64}$/);
    verifyBaselineLineage(gate.baseline_lineage);

    const verified = verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory });
    assert.equal(verified.baseline_lineage.lineage_digest, gate.baseline_lineage.lineage_digest);
    assert.throws(() => verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [], root: fixture.directory }), /requires the exact slice candidate artifacts/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a declared slice lineage cannot become route-ready without exact G7 owner scope binding", () => {
  const fixture = createFixture({ includeOwnerGate: false });
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.equal(gate.lineage_required, true);
    assert.ok(gate.requirements.some((requirement) => requirement.gate === "G7"));
    assert.match(gate.unresolved.join("\n"), /G7 is missing/);
    assert.equal(gate.baseline_lineage, undefined);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a slice route cannot substitute its parent or add artifacts outside candidate scope", () => {
  const fixture = createFixture();
  try {
    const parentRoute = resolveFixture(fixture, [fixture.parent]);
    assert.equal(parentRoute.status, "blocked");
    assert.match(parentRoute.unresolved.join("\n"), /missing baseline_lineage candidate artifact/);
    assert.match(parentRoute.unresolved.join("\n"), /outside baseline_lineage candidate scope/);

    const expandedRoute = resolveFixture(fixture, [fixture.candidate, fixture.parent]);
    assert.equal(expandedRoute.status, "blocked");
    assert.match(expandedRoute.unresolved.join("\n"), /outside baseline_lineage candidate scope/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("parent baseline tamper invalidates a previously planned slice", () => {
  const fixture = createFixture();
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "ready");
    fs.appendFileSync(fixture.parent, "<!-- parent tampered -->\n");
    assert.throws(() => verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory }),
    /parent_baseline artifact digest changed/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("an initially invalid lineage is blocked and never exposed as verified authority", () => {
  const fixture = createFixture();
  try {
    fs.appendFileSync(fixture.parent, "<!-- parent changed before planning -->\n");
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.equal(gate.baseline_lineage, undefined);
    assert.match(gate.unresolved.join("\n"), /parent_baseline artifact digest changed/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("slice candidate tamper invalidates a previously planned lineage", () => {
  const fixture = createFixture();
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "ready");
    fs.appendFileSync(fixture.candidate, "<!-- candidate tampered -->\n");
    assert.throws(() => verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory }),
    /candidate artifact digest changed/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("parent and slice artifacts cannot share or nest the same path boundary", () => {
  const fixture = createFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    receipt.baseline_lineage.parent_baseline.artifacts = [{
      path: path.basename(fixture.candidate),
      digest: hashArtifact(fixture.candidate)
    }];
    writeJson(fixture.receiptPath, receipt);
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /separate, non-nested paths/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("hard-linked parent and slice files cannot masquerade as separate baselines", () => {
  const fixture = createFixture();
  try {
    fs.unlinkSync(fixture.candidate);
    fs.linkSync(fixture.parent, fixture.candidate);
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    const sharedDigest = sha256(fs.readFileSync(fixture.parent));
    receipt.baseline_lineage.candidate.artifacts[0].digest = sharedDigest;
    receipt.gates.G6.evidence[0].digest = sharedDigest;
    writeJson(fixture.receiptPath, receipt);
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.equal(gate.baseline_lineage, undefined);
    assert.match(gate.unresolved.join("\n"),
      /single-link|hard-linked artifacts|physically separate, non-nested paths/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a symlinked ancestor cannot alias the parent as the routed slice", () => {
  const fixture = createFixture();
  try {
    const alias = path.join(fixture.directory, "alias");
    fs.symlinkSync(fixture.directory, alias, "dir");
    const aliasedParent = path.join(alias, path.basename(fixture.parent));
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    receipt.baseline_lineage.candidate.artifacts = [{
      path: path.relative(fixture.directory, aliasedParent),
      digest: hashArtifact(fixture.parent)
    }];
    receipt.gates.G6.evidence = [{
      kind: "mockup",
      path: path.relative(fixture.directory, aliasedParent),
      digest: hashArtifact(fixture.parent)
    }];
    writeJson(fixture.receiptPath, receipt);
    const gate = resolveFixture(fixture, [aliasedParent]);
    assert.equal(gate.status, "blocked");
    assert.equal(gate.baseline_lineage, undefined);
    assert.match(gate.unresolved.join("\n"), /unsupported symlink component/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a symlinked project authority root cannot host a lineage receipt", () => {
  const fixture = createFixture();
  const alias = `${fixture.directory}-authority-link`;
  try {
    fs.symlinkSync(fixture.directory, alias, "dir");
    const aliasedProfile = JSON.parse(fs.readFileSync(fixture.profilePath, "utf8"));
    aliasedProfile.planning.receipt = "planning.json";
    const aliasedProfilePath = path.join(alias, "profile.json");
    const gate = resolvePlanningGate({
      profile: aliasedProfile,
      profilePath: aliasedProfilePath,
      input: fixture.input,
      artifacts: [path.join(alias, path.basename(fixture.candidate))],
      root: alias
    });
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /authority root must not be a symlink|symlink ancestor/);
  } finally {
    fs.rmSync(alias, { force: true });
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("absolute lineage artifacts outside the project authority root fail closed", () => {
  const fixture = createFixture();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lineage-outside-"));
  try {
    const outsideParent = path.join(outside, "parent.html");
    fs.writeFileSync(outsideParent, "<!doctype html><main>outside parent</main>\n");
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    receipt.baseline_lineage.parent_baseline.artifacts = [{
      path: outsideParent,
      digest: hashArtifact(outsideParent)
    }];
    writeJson(fixture.receiptPath, receipt);
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /escapes the project authority root/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("outside-root symlink and hard-link aliases cannot enter lineage authority", () => {
  for (const aliasKind of ["symlink", "hard-link"]) {
    const fixture = createFixture();
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lineage-alias-"));
    try {
      const outsideCandidate = path.join(outside, "outside-candidate.html");
      fs.writeFileSync(outsideCandidate, "<!doctype html><main>outside candidate</main>\n");
      fs.unlinkSync(fixture.candidate);
      if (aliasKind === "symlink") fs.symlinkSync(outsideCandidate, fixture.candidate);
      else fs.linkSync(outsideCandidate, fixture.candidate);
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
      const digest = sha256(fs.readFileSync(outsideCandidate));
      receipt.baseline_lineage.candidate.artifacts[0].digest = digest;
      receipt.gates.G6.evidence[0].digest = digest;
      writeJson(fixture.receiptPath, receipt);
      const gate = resolveFixture(fixture);
      assert.equal(gate.status, "blocked");
      assert.match(
        gate.unresolved.join("\n"),
        aliasKind === "symlink" ? /symlink/ : /single-link|hard-linked artifacts/
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("macOS /var and /private/var spellings resolve to one valid authority root", {
  skip: process.platform !== "darwin"
}, () => {
  const fixture = createFixture();
  try {
    const canonicalRoot = fs.realpathSync.native(fixture.directory);
    if (canonicalRoot === path.resolve(fixture.directory)) return;
    const mixedProfile = structuredClone(fixture.profile);
    mixedProfile.planning.receipt = path.join(canonicalRoot, "planning.json");
    const gate = resolvePlanningGate({
      profile: mixedProfile,
      profilePath: fixture.profilePath,
      input: fixture.input,
      artifacts: [fixture.candidate],
      root: fixture.directory
    });
    assert.equal(gate.status, "ready", gate.unresolved.join("\n"));
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("a supplied lineage digest must be valid even when it is falsey", () => {
  for (const invalid of ["", null, false, 0]) {
    const fixture = createFixture();
    try {
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
      receipt.baseline_lineage.lineage_digest = invalid;
      writeJson(fixture.receiptPath, receipt);
      const gate = resolveFixture(fixture);
      assert.equal(gate.status, "blocked");
      assert.match(gate.unresolved.join("\n"), /lineage_digest must be a sha256 digest/);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("a slice id must equal the planning receipt scope id", () => {
  const fixture = createFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    receipt.baseline_lineage.candidate.slice_id = "different-slice";
    writeJson(fixture.receiptPath, receipt);
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /candidate\.slice_id must match.*scope_id/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("G7 approval must bind the exact lineage candidate and artifact set", () => {
  const fixture = createFixture();
  try {
    const auditEvidence = path.join(fixture.directory, "audit-receipt.json");
    const approvalPath = path.join(fixture.directory, "candidate-owner-approval.json");
    fs.writeFileSync(auditEvidence, "{\"status\":\"passed\"}\n");
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    const lineage = structuredClone(receipt.baseline_lineage);
    lineage.lineage_digest = canonicalDigest(lineage);
    writeJson(approvalPath, {
      status: "approved",
      owner_id: "fixture-owner",
      lineage_id: lineage.lineage_id,
      baseline_lineage_digest: lineage.lineage_digest,
      decision_scope: "candidate-slice-binding",
      parent_promotion: false,
      candidate: lineage.candidate,
      decided_at: startedAt,
      note: "Approved only the exact policy slice candidate."
    });
    receipt.gates = {
      G6T: {
        status: "passed",
        evidence: [{
          kind: "audit-receipt",
          path: path.basename(auditEvidence),
          digest: hashArtifact(auditEvidence)
        }]
      },
      G7: {
        status: "approved",
        evidence: [{
          kind: "approved-artifact",
          path: path.basename(fixture.candidate),
          digest: hashArtifact(fixture.candidate)
        }, {
          kind: "owner-approval",
          path: path.basename(approvalPath),
          digest: hashArtifact(approvalPath)
        }]
      }
    };
    writeJson(fixture.receiptPath, receipt);
    const input = { ...fixture.input, task: "systemize", scope: "mockup" };
    const approved = resolvePlanningGate({
      profile: fixture.profile,
      profilePath: fixture.profilePath,
      input,
      artifacts: [fixture.candidate],
      root: fixture.directory
    });
    assert.equal(approved.status, "ready", approved.unresolved.join("\n"));

    const wrongApproval = JSON.parse(fs.readFileSync(approvalPath, "utf8"));
    wrongApproval.candidate.version = "unapproved-version";
    writeJson(approvalPath, wrongApproval);
    receipt.gates.G7.evidence[1].digest = hashArtifact(approvalPath);
    writeJson(fixture.receiptPath, receipt);
    const blocked = resolvePlanningGate({
      profile: fixture.profile,
      profilePath: fixture.profilePath,
      input,
      artifacts: [fixture.candidate],
      root: fixture.directory
    });
    assert.equal(blocked.status, "blocked");
    assert.match(blocked.unresolved.join("\n"), /does not bind the exact lineage candidate/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("G7 owner approval enforces the published top-level schema", () => {
  const invalidApprovals = [{
    label: "nested owner",
    mutate(approval) {
      delete approval.owner_id;
      approval.owner_approval = { owner_id: "nested-owner" };
    },
    pattern: /unsupported field: owner_approval|owner_id/
  }, {
    label: "missing timestamp",
    mutate(approval) { delete approval.decided_at; },
    pattern: /decided_at/
  }, {
    label: "invalid timestamp",
    mutate(approval) { approval.decided_at = "yesterday"; },
    pattern: /RFC3339 date-time/
  }, {
    label: "extra property",
    mutate(approval) { approval.unscoped_authority = true; },
    pattern: /unsupported field: unscoped_authority/
  }, {
    label: "parent promotion",
    mutate(approval) { approval.parent_promotion = true; },
    pattern: /cannot promote or replace the parent baseline/
  }, {
    label: "unbounded decision scope",
    mutate(approval) { approval.decision_scope = "replace-parent"; },
    pattern: /candidate-slice-binding/
  }];
  for (const invalid of invalidApprovals) {
    const fixture = createFixture();
    try {
      const auditEvidence = path.join(fixture.directory, "audit-receipt.json");
      const approvalPath = path.join(fixture.directory, "candidate-owner-approval.json");
      fs.writeFileSync(auditEvidence, "{\"status\":\"passed\"}\n");
      const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
      const lineage = structuredClone(receipt.baseline_lineage);
      lineage.lineage_digest = canonicalDigest(lineage);
      const approval = {
        status: "approved",
        owner_id: "fixture-owner",
        lineage_id: lineage.lineage_id,
        baseline_lineage_digest: lineage.lineage_digest,
        decision_scope: "candidate-slice-binding",
        parent_promotion: false,
        candidate: lineage.candidate,
        decided_at: startedAt
      };
      invalid.mutate(approval);
      writeJson(approvalPath, approval);
      receipt.gates = {
        G6T: {
          status: "passed",
          evidence: [{
            kind: "audit-receipt",
            path: path.basename(auditEvidence),
            digest: hashArtifact(auditEvidence)
          }]
        },
        G7: {
          status: "approved",
          evidence: [{
            kind: "approved-artifact",
            path: path.basename(fixture.candidate),
            digest: hashArtifact(fixture.candidate)
          }, {
            kind: "owner-approval",
            path: path.basename(approvalPath),
            digest: hashArtifact(approvalPath)
          }]
        }
      };
      writeJson(fixture.receiptPath, receipt);
      const gate = resolvePlanningGate({
        profile: fixture.profile,
        profilePath: fixture.profilePath,
        input: { ...fixture.input, task: "systemize", scope: "mockup" },
        artifacts: [fixture.candidate],
        root: fixture.directory
      });
      assert.equal(gate.status, "blocked", invalid.label);
      assert.match(gate.unresolved.join("\n"), invalid.pattern, invalid.label);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});

test("a slice lineage cannot declare itself as a parent replacement", () => {
  const fixture = createFixture({ supersedesParent: true });
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /cannot supersede the parent baseline/);
    assert.equal(gate.baseline_lineage, undefined);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("planning receipt hash and parse stay bound to one descriptor during a path swap", () => {
  const fixture = createFixture();
  try {
    const replacement = path.join(fixture.directory, "planning-replacement.json");
    const displaced = path.join(fixture.directory, "planning-displaced.json");
    const changed = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    changed.project_id = "substituted-project";
    writeJson(replacement, changed);
    let swapped = false;
    const gate = resolvePlanningGate({
      profile: fixture.profile,
      profilePath: fixture.profilePath,
      input: fixture.input,
      artifacts: [fixture.candidate],
      root: fixture.directory,
      faultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== fs.realpathSync.native(fixture.receiptPath)) return;
        swapped = true;
        fs.renameSync(fixture.receiptPath, displaced);
        fs.renameSync(replacement, fixture.receiptPath);
      }
    });
    assert.equal(swapped, true);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /path identity changed while it was being read/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("G7 owner decision digest and status stay bound to one descriptor during a path swap", () => {
  const fixture = createFixture();
  try {
    const receipt = JSON.parse(fs.readFileSync(fixture.receiptPath, "utf8"));
    const rejected = JSON.parse(fs.readFileSync(fixture.approvalPath, "utf8"));
    rejected.status = "rejected";
    writeJson(fixture.approvalPath, rejected);
    receipt.gates.G7.evidence.find((item) => item.kind === "owner-approval").digest =
      hashArtifact(fixture.approvalPath);
    writeJson(fixture.receiptPath, receipt);

    const replacement = path.join(fixture.directory, "approved-replacement.json");
    const displaced = path.join(fixture.directory, "rejected-displaced.json");
    writeJson(replacement, { ...rejected, status: "approved" });
    let swapped = false;
    const gate = resolvePlanningGate({
      profile: fixture.profile,
      profilePath: fixture.profilePath,
      input: fixture.input,
      artifacts: [fixture.candidate],
      root: fixture.directory,
      faultInjector(checkpoint, detail) {
        if (swapped || checkpoint !== "after-read-before-path-revalidation") return;
        if (detail.path !== fs.realpathSync.native(fixture.approvalPath)) return;
        swapped = true;
        fs.renameSync(fixture.approvalPath, displaced);
        fs.renameSync(replacement, fixture.approvalPath);
      }
    });
    assert.equal(swapped, true);
    assert.equal(gate.status, "blocked");
    assert.match(gate.unresolved.join("\n"), /path identity changed while it was being read/);
    assert.notEqual(gate.status, "ready");
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("planning receipt same-byte inode replacement fails between route planning and audit", () => {
  const fixture = createFixture();
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "ready");
    const before = fs.statSync(fixture.receiptPath, { bigint: true });
    replaceWithSameBytes(fixture.receiptPath);
    const after = fs.statSync(fixture.receiptPath, { bigint: true });
    assert.notEqual(after.ino, before.ino);
    assert.throws(() => verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory }),
    /planning authority source physical identity changed.*planning\.json/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("G7 owner approval same-byte inode replacement fails between planning and audit", () => {
  const fixture = createFixture();
  try {
    const gate = resolveFixture(fixture);
    assert.equal(gate.status, "ready");
    const before = fs.statSync(fixture.approvalPath, { bigint: true });
    replaceWithSameBytes(fixture.approvalPath);
    const after = fs.statSync(fixture.approvalPath, { bigint: true });
    assert.notEqual(after.ino, before.ino);
    assert.throws(() => verifyPlanningGateForAudit({
      project_id: fixture.profile.project_id,
      input: fixture.input,
      planning_gate: gate
    }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory }),
    /planning authority source physical identity changed.*candidate-scope-owner-approval\.json/);
  } finally {
    fs.rmSync(fixture.directory, { recursive: true, force: true });
  }
});

test("same-byte parent and candidate replacements cannot retain baseline authority", () => {
  for (const targetName of ["parent", "candidate"]) {
    const fixture = createFixture();
    try {
      const gate = resolveFixture(fixture);
      assert.equal(gate.status, "ready");
      const target = fixture[targetName];
      const before = fs.statSync(target, { bigint: true });
      replaceWithSameBytes(target);
      const after = fs.statSync(target, { bigint: true });
      assert.notEqual(after.ino, before.ino);
      assert.throws(() => verifyPlanningGateForAudit({
        project_id: fixture.profile.project_id,
        input: fixture.input,
        planning_gate: gate
      }, "mockup", { artifacts: [fixture.candidate], root: fixture.directory }),
      /physical identity changed/);
    } finally {
      fs.rmSync(fixture.directory, { recursive: true, force: true });
    }
  }
});
