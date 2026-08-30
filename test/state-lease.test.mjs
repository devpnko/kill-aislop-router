import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  continueAutomation,
  inspectAutomationStateLease,
  migrateAutomationStateIdentity,
  recoverAutomationStateLease,
  resumeAutomation,
  startAutomation
} from "../src/automation.mjs";
import {
  acquireStateLease,
  commitStateLeaseWrite,
  inspectStateLease,
  prepareStateLeaseWrite,
  releaseStateLease
} from "../src/state-lease.mjs";
import * as publicStateLease from "../src/state-lease-public.mjs";
import { canonicalDigest } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const crashHolder = path.join(root, "test", "fixtures", "lease-crash-holder.mjs");
const recoveryCrashHolder = path.join(root, "test", "fixtures", "recovery-crash-holder.mjs");
const processIdentityProbe = path.join(root, "test", "fixtures", "process-identity-probe.mjs");

test("public state-lease package surface cannot claim stale authority or forge a controller", () => {
  assert.equal("claimStaleStateLease" in publicStateLease, false);
  assert.equal("completeStateLeaseRecovery" in publicStateLease, false);
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-public-lease-"));
  const statePath = path.join(directory, "run.json");
  const controller = publicStateLease.acquireStateLease({
    statePath,
    operation: "public-controller-fixture"
  });
  try {
    const status = publicStateLease.inspectStateLease(statePath);
    assert.throws(() => publicStateLease.releaseStateLease({
      state_path: statePath,
      owner_token: status.owner_token,
      owner_pid: status.owner_pid
    }), /controller was not issued to this process/);
    assert.equal(publicStateLease.inspectStateLease(statePath).status, "locked");
    publicStateLease.releaseStateLease(controller);
    assert.equal(publicStateLease.inspectStateLease(statePath).status, "unlocked");
  } finally {
    if (fs.existsSync(`${statePath}.lease`)) {
      fs.rmSync(`${statePath}.lease`, { recursive: true, force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("lease acquisition rejects a pre-existing state-path symlink ancestor before writing", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-path-boundary-"));
  const redirected = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-redirected-"));
  const alias = path.join(directory, "state-alias");
  const statePath = path.join(alias, "run.json");
  try {
    fs.symlinkSync(redirected, alias, "dir");
    assert.throws(() => acquireStateLease({ statePath, operation: "fixture-owner" }),
      /automation state path contains a symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirected), [],
      "lease acquisition must not write through a redirected state ancestor");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
    fs.rmSync(redirected, { recursive: true, force: true });
  }
});

test("one atomic state lease excludes start, resume, and identity migration before state work", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-exclusive-"));
  const statePath = path.join(directory, ".killsloprouter", "run.json");
  const otherStatePath = path.join(directory, ".killsloprouter", "other.json");
  const lease = acquireStateLease({ statePath, operation: "fixture-owner" });
  const otherLease = acquireStateLease({ statePath: otherStatePath, operation: "fixture-other-state" });
  try {
    const status = inspectAutomationStateLease(statePath);
    assert.equal(status.status, "locked");
    assert.equal(status.owner_process_alive, true);
    assert.throws(() => acquireStateLease({ statePath, operation: "second-owner" }),
      /active automation state lease/);
    assert.throws(() => startAutomation({ statePath }), /active automation state lease/);
    assert.throws(() => resumeAutomation(statePath), /active automation state lease/);
    assert.throws(() => migrateAutomationStateIdentity(statePath), /active automation state lease/);
    assert.throws(() => continueAutomation({ state_path: statePath }),
      /active automation state lease/);
    assert.equal(inspectStateLease(otherStatePath).status, "locked",
      "leases must be scoped to one exact state path");
  } finally {
    releaseStateLease(otherLease);
    releaseStateLease(lease);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("lease record tamper blocks inspection and ownership release", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-tamper-"));
  const statePath = path.join(directory, "run.json");
  const lease = acquireStateLease({ statePath, operation: "fixture-owner" });
  const leasePath = path.join(`${statePath}.lease`, "lease.json");
  const original = fs.readFileSync(leasePath, "utf8");
  try {
    const changed = JSON.parse(original);
    changed.phase = "child-execution";
    fs.writeFileSync(leasePath, `${JSON.stringify(changed, null, 2)}\n`);
    assert.throws(() => inspectStateLease(statePath), /lease digest mismatch/);
    assert.throws(() => releaseStateLease(lease), /lease digest mismatch/);
  } finally {
    fs.writeFileSync(leasePath, original);
    releaseStateLease(lease);
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("PID reuse does not impersonate a lease owner with a different process-start identity", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-pid-reuse-"));
  const statePath = path.join(directory, "run.json");
  acquireStateLease({ statePath, operation: "fixture-owner" });
  const leasePath = path.join(`${statePath}.lease`, "lease.json");
  try {
    let status = inspectStateLease(statePath);
    assert.equal(status.owner_pid_in_use, true);
    assert.equal(status.owner_process_alive, true);
    assert.equal(status.owner_process_identity_matches, true);
    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: status.owner_token,
      acquiredAt: status.acquired_at,
      stateDigest: status.state_digest
    }), /exact recorded owner process is still active/);

    const record = JSON.parse(fs.readFileSync(leasePath, "utf8"));
    record.owner_process_identity.marker = canonicalDigest({ fixture: "older-process-same-pid" });
    record.recover_after = new Date(Date.now() - 1_000).toISOString();
    delete record.lease_digest;
    record.lease_digest = canonicalDigest(record);
    fs.writeFileSync(leasePath, `${JSON.stringify(record, null, 2)}\n`);

    status = inspectStateLease(statePath);
    assert.equal(status.owner_pid_in_use, true);
    assert.equal(status.owner_process_alive, false);
    assert.equal(status.owner_process_identity_matches, false);
    const recovered = recoverAutomationStateLease(statePath, {
      ownerToken: status.owner_token,
      acquiredAt: status.acquired_at,
      stateDigest: status.state_digest
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(inspectStateLease(statePath).status, "unlocked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("POSIX process-start markers are canonical across caller locale and timezone", {
  skip: process.platform === "win32"
}, () => {
  const probe = (environment) => spawnSync(process.execPath, [
    processIdentityProbe,
    String(process.pid)
  ], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...environment },
    shell: false
  });
  const koreanTime = probe({ LANG: "C", LC_ALL: "C", TZ: "Asia/Seoul" });
  const utcTime = probe({ LANG: "POSIX", LC_ALL: "POSIX", TZ: "UTC" });
  assert.equal(koreanTime.status, 0, koreanTime.stderr || koreanTime.stdout);
  assert.equal(utcTime.status, 0, utcTime.stderr || utcTime.stdout);
  const first = JSON.parse(koreanTime.stdout);
  const second = JSON.parse(utcTime.stdout);
  assert.equal(first.method, "posix-ps-start-time");
  assert.deepEqual(second, first);
});

test("an unresolved two-phase state write keeps its lease before and after file replacement", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-state-write-"));
  const statePath = path.join(directory, "run.json");
  const lease = acquireStateLease({ statePath, operation: "fixture-state-write" });
  const state = {
    automation_run_version: 1,
    run_id: "fault-injection",
    state_path: statePath,
    in_flight: { packet_id: "packet-under-test" }
  };
  state.state_digest = canonicalDigest(state);
  try {
    prepareStateLeaseWrite(lease, state.state_digest);
    let status = inspectStateLease(statePath);
    assert.equal(status.phase, "state-write");
    assert.deepEqual(status.bound_state_digests, ["absent", state.state_digest]);
    assert.throws(() => releaseStateLease(lease), /state write or child outcome is unresolved/,
      "prepare success followed by state-write failure must preserve the lease");
    assert.equal(inspectStateLease(statePath).status, "locked");

    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    status = inspectStateLease(statePath);
    assert.equal(status.state_digest, state.state_digest);
    assert.equal(status.phase, "state-write");
    assert.throws(() => releaseStateLease(lease), /state write or child outcome is unresolved/,
      "state replacement followed by commit failure must preserve the lease");

    commitStateLeaseWrite(lease, state, { inFlight: true });
    assert.throws(() => releaseStateLease(lease), /state write or child outcome is unresolved/,
      "a committed in-flight intent must remain recovery-only");
    state.in_flight = null;
    delete state.state_digest;
    state.state_digest = canonicalDigest(state);
    prepareStateLeaseWrite(lease, state.state_digest);
    fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
    commitStateLeaseWrite(lease, state, { inFlight: false });
    releaseStateLease(lease);
    assert.equal(inspectStateLease(statePath).status, "unlocked");
  } finally {
    if (fs.existsSync(`${statePath}.lease`)) {
      fs.rmSync(`${statePath}.lease`, { recursive: true, force: true });
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("stale lease recovery requires owner token, timestamp, and state digest instead of PID alone", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-recovery-"));
  const statePath = path.join(directory, "crashed.json");
  try {
    const holder = spawnSync(process.execPath, [crashHolder, statePath], {
      cwd: directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(holder.status, 0, holder.stderr || holder.stdout);
    const stale = inspectAutomationStateLease(statePath);
    assert.equal(stale.status, "locked");
    assert.equal(stale.owner_process_alive, false);
    assert.equal(stale.state_digest, "absent");

    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: "incorrect-owner-token",
      acquiredAt: stale.acquired_at,
      stateDigest: stale.state_digest
    }), /owner token does not match/);
    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: "2000-01-01T00:00:00.000Z",
      stateDigest: stale.state_digest
    }), /acquired timestamp does not match/);
    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: stale.acquired_at,
      stateDigest: canonicalDigest({ wrong: "state" })
    }), /state digest does not match/);

    const recovered = recoverAutomationStateLease(statePath, {
      ownerToken: stale.owner_token,
      acquiredAt: stale.acquired_at,
      stateDigest: stale.state_digest
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(recovered.previous_state_digest, "absent");
    assert.equal(recovered.abandoned_packet, null);
    assert.ok(fs.existsSync(recovered.receipt_path));
    assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("a crash after recovery lease replacement adopts the exact orphan claim and completes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-claim-crash-"));
  const statePath = path.join(directory, "crashed.json");
  try {
    const holder = spawnSync(process.execPath, [crashHolder, statePath], {
      cwd: directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(holder.status, 0, holder.stderr || holder.stdout);
    const stale = inspectAutomationStateLease(statePath);
    const crashedRecovery = spawnSync(process.execPath, [
      recoveryCrashHolder,
      statePath,
      stale.owner_token,
      stale.acquired_at,
      stale.state_digest,
      canonicalDigest({ fixture: "absent-state-authority" }),
      "after-recovery-lease-replacement-before-claim-cleanup"
    ], {
      cwd: directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(crashedRecovery.status, 91, crashedRecovery.stderr || crashedRecovery.stdout);

    const claimPath = path.join(`${statePath}.lease`, "recovery-claim.json");
    assert.equal(fs.existsSync(claimPath), true);
    const replacement = inspectAutomationStateLease(statePath);
    assert.equal(replacement.operation, "recover");
    assert.equal(replacement.phase, "recovery");
    assert.equal(replacement.owner_process_alive, false);

    const recovered = recoverAutomationStateLease(statePath, {
      ownerToken: replacement.owner_token,
      acquiredAt: replacement.acquired_at,
      stateDigest: replacement.state_digest
    });
    assert.equal(recovered.status, "recovered");
    assert.equal(recovered.previous_state_digest, "absent");
    assert.equal(fs.existsSync(claimPath), false);
    assert.equal(inspectAutomationStateLease(statePath).status, "unlocked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("an orphan recovery claim that does not bind the committed recovery lease remains fail closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-claim-conflict-"));
  const statePath = path.join(directory, "crashed.json");
  try {
    const holder = spawnSync(process.execPath, [crashHolder, statePath], {
      cwd: directory,
      encoding: "utf8",
      shell: false
    });
    assert.equal(holder.status, 0, holder.stderr || holder.stdout);
    const stale = inspectAutomationStateLease(statePath);
    const crashedRecovery = spawnSync(process.execPath, [
      recoveryCrashHolder,
      statePath,
      stale.owner_token,
      stale.acquired_at,
      stale.state_digest,
      canonicalDigest({ fixture: "absent-state-authority" }),
      "after-recovery-lease-replacement-before-claim-cleanup"
    ], { cwd: directory, encoding: "utf8", shell: false });
    assert.equal(crashedRecovery.status, 91, crashedRecovery.stderr || crashedRecovery.stdout);

    const claimPath = path.join(`${statePath}.lease`, "recovery-claim.json");
    const claim = JSON.parse(fs.readFileSync(claimPath, "utf8"));
    claim.target_lease_digest = canonicalDigest({ conflicting: "lease" });
    delete claim.claim_digest;
    claim.claim_digest = canonicalDigest(claim);
    fs.writeFileSync(claimPath, `${JSON.stringify(claim, null, 2)}\n`);
    const replacement = inspectAutomationStateLease(statePath);
    assert.throws(() => recoverAutomationStateLease(statePath, {
      ownerToken: replacement.owner_token,
      acquiredAt: replacement.acquired_at,
      stateDigest: replacement.state_digest
    }), /conflicting recovery claim/);
    assert.equal(inspectAutomationStateLease(statePath).status, "locked");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
