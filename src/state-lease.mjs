import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { canonicalDigest, writeJsonAtomic } from "./integrity.mjs";
import { RouterError } from "./router.mjs";

export const ABSENT_STATE_DIGEST = "absent";
export const STATE_LEASE_VERSION = 1;

const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const CHILD_RECOVERY_GRACE_MS = 1_000;
const LEASE_RECORD = "lease.json";
const RECOVERY_CLAIM = "recovery-claim.json";

function nowIso(now = null) {
  return (now ? new Date(now) : new Date()).toISOString();
}

function leaseBody(record) {
  const { lease_digest: _digest, ...body } = record;
  return body;
}

function claimBody(record) {
  const { claim_digest: _digest, ...body } = record;
  return body;
}

function requireValue(condition, message, exitCode = 5) {
  if (!condition) throw new RouterError(message, exitCode);
}

function validStateDigest(value) {
  return value === ABSENT_STATE_DIGEST || DIGEST_PATTERN.test(value || "");
}

function stateBody(state) {
  const { state_digest: _digest, ...body } = state;
  return body;
}

function observedStateDigest(statePath) {
  const absolute = path.resolve(statePath);
  if (!fs.existsSync(absolute)) return ABSENT_STATE_DIGEST;
  const stat = fs.lstatSync(absolute);
  requireValue(stat.isFile() && !stat.isSymbolicLink(),
    `automation state must be a regular non-symlink file: ${absolute}`, 4);
  let state;
  try {
    state = JSON.parse(fs.readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new RouterError(`cannot inspect automation state at ${absolute}: ${error.message}`, 4);
  }
  requireValue(DIGEST_PATTERN.test(state?.state_digest || ""),
    "automation state requires a canonical state_digest before lease acquisition", 4);
  requireValue(canonicalDigest(stateBody(state)) === state.state_digest,
    "automation state digest mismatch before lease acquisition", 4);
  return state.state_digest;
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code !== "ESRCH";
  }
}

function commandIdentity(command, args, method, pid) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: {
      ...process.env,
      LANG: "C",
      LANGUAGE: "C",
      LC_ALL: "C",
      TZ: "UTC"
    },
    shell: false,
    timeout: 2_000,
    windowsHide: true
  });
  if (result.error || result.status !== 0 || !result.stdout?.trim()) return null;
  return {
    process_identity_version: 1,
    method,
    marker: canonicalDigest({ pid, output: result.stdout.trim() })
  };
}

export function processStartIdentity(pid, { forcePosixPs = false } = {}) {
  if (!processAlive(pid)) return null;
  if (!forcePosixPs && process.platform === "linux") {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = stat.lastIndexOf(")");
      const fields = close >= 0 ? stat.slice(close + 2).trim().split(/\s+/) : [];
      const startTicks = fields[19];
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      if (startTicks && bootId) {
        return {
          process_identity_version: 1,
          method: "linux-proc-starttime",
          marker: canonicalDigest({ boot_id: bootId, pid, start_ticks: startTicks })
        };
      }
    } catch {
      // Fall through to a fixed ps query when procfs is unavailable.
    }
  }
  if (!forcePosixPs && process.platform === "win32") {
    const script = [
      `$p = Get-CimInstance Win32_Process -Filter 'ProcessId = ${pid}'`,
      "if ($null -ne $p) { [Console]::Out.Write($p.CreationDate.ToUniversalTime().ToString('o')) }"
    ].join("; ");
    const systemRoot = process.env.SystemRoot || process.env.WINDIR;
    const commands = systemRoot && path.isAbsolute(systemRoot)
      ? [path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe")]
      : [];
    for (const command of commands) {
      const identity = commandIdentity(command, [
        "-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script
      ], "windows-cim-creation-time", pid);
      if (identity) return identity;
    }
    return null;
  }
  for (const command of ["/bin/ps", "/usr/bin/ps"]) {
    const identity = commandIdentity(command, ["-o", "lstart=", "-p", String(pid)],
      "posix-ps-start-time", pid);
    if (identity) return identity;
  }
  return null;
}

function sameProcessIdentity(left, right) {
  return Boolean(left && right &&
    left.process_identity_version === right.process_identity_version &&
    left.method === right.method &&
    left.marker === right.marker);
}

function observeOwnerProcess(pid, expectedIdentity) {
  const pidInUse = processAlive(pid);
  const actualIdentity = pidInUse ? processStartIdentity(pid) : null;
  return {
    pid_in_use: pidInUse,
    identity_available: Boolean(actualIdentity),
    identity_matches: sameProcessIdentity(actualIdentity, expectedIdentity),
    actual_identity: actualIdentity
  };
}

export function stateLeaseDirectory(statePath) {
  return `${path.resolve(statePath)}.lease`;
}

function recordPath(statePath) {
  return path.join(stateLeaseDirectory(statePath), LEASE_RECORD);
}

function readLeaseRecord(statePath) {
  const directory = stateLeaseDirectory(statePath);
  requireValue(fs.existsSync(directory), `automation state lease is not present: ${directory}`, 5);
  const directoryStat = fs.lstatSync(directory);
  requireValue(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(),
    `automation state lease path must be a real directory: ${directory}`, 4);
  const target = path.join(directory, LEASE_RECORD);
  requireValue(fs.existsSync(target), `automation state lease record is missing: ${target}`, 4);
  const recordStat = fs.lstatSync(target);
  requireValue(recordStat.isFile() && !recordStat.isSymbolicLink(),
    `automation state lease record must be a regular non-symlink file: ${target}`, 4);
  let record;
  try {
    record = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new RouterError(`cannot read automation state lease at ${target}: ${error.message}`, 4);
  }
  requireValue(record?.state_lease_version === STATE_LEASE_VERSION,
    `unsupported automation state lease version: ${record?.state_lease_version || "missing"}`, 4);
  requireValue(path.resolve(record.state_path || "") === path.resolve(statePath),
    "automation state lease path binding mismatch", 4);
  requireValue(typeof record.owner_token === "string" && record.owner_token.length >= 16,
    "automation state lease owner token is invalid", 4);
  requireValue(Number.isInteger(record.owner_pid) && record.owner_pid >= 1,
    "automation state lease owner pid is invalid", 4);
  requireValue(record.owner_process_identity?.process_identity_version === 1 &&
    typeof record.owner_process_identity.method === "string" &&
    record.owner_process_identity.method.length > 0 &&
    DIGEST_PATTERN.test(record.owner_process_identity.marker || ""),
  "automation state lease owner process identity is invalid", 4);
  requireValue(!Number.isNaN(Date.parse(record.acquired_at || "")) &&
    !Number.isNaN(Date.parse(record.updated_at || "")) &&
    !Number.isNaN(Date.parse(record.recover_after || "")),
  "automation state lease timestamps are invalid", 4);
  requireValue(validStateDigest(record.state_digest),
    "automation state lease state digest is invalid", 4);
  requireValue(record.pending_state_digest === null || DIGEST_PATTERN.test(record.pending_state_digest || ""),
    "automation state lease pending digest is invalid", 4);
  requireValue(DIGEST_PATTERN.test(record.lease_digest || "") &&
    canonicalDigest(leaseBody(record)) === record.lease_digest,
  "automation state lease digest mismatch", 4);
  return record;
}

function writeLeaseRecord(statePath, record) {
  const next = {
    ...record,
    updated_at: nowIso(),
    lease_digest: null
  };
  next.lease_digest = canonicalDigest(leaseBody(next));
  writeJsonAtomic(recordPath(statePath), next);
  return next;
}

function activeLeaseError(statePath, operation) {
  return new RouterError(
    `active automation state lease blocks ${operation}: ${stateLeaseDirectory(statePath)}; ` +
    `inspect it with killsloprouter lease status --state ${path.resolve(statePath)}`,
    5
  );
}

function controllerFor(record) {
  return {
    state_path: record.state_path,
    owner_token: record.owner_token,
    owner_pid: record.owner_pid
  };
}

function ownedRecord(controller) {
  const record = readLeaseRecord(controller.state_path);
  requireValue(record.owner_token === controller.owner_token &&
    record.owner_pid === controller.owner_pid,
  "automation state lease ownership changed", 4);
  return record;
}

export function acquireStateLease({ statePath, operation }) {
  const absolute = path.resolve(statePath);
  requireValue(typeof operation === "string" && operation.length > 0,
    "automation state lease operation is required", 2);
  const acquiredAt = nowIso();
  const ownerProcessIdentity = processStartIdentity(process.pid);
  requireValue(ownerProcessIdentity,
    "cannot establish an OS process-start identity for the automation state lease", 5);
  const record = {
    state_lease_version: STATE_LEASE_VERSION,
    state_path: absolute,
    operation,
    owner_token: crypto.randomUUID(),
    owner_pid: process.pid,
    owner_process_identity: ownerProcessIdentity,
    acquired_at: acquiredAt,
    updated_at: acquiredAt,
    state_digest: observedStateDigest(absolute),
    pending_state_digest: null,
    phase: "acquired",
    active_packet: null,
    recover_after: acquiredAt,
    recovered_from: null,
    lease_digest: null
  };
  record.lease_digest = canonicalDigest(leaseBody(record));

  const directory = stateLeaseDirectory(absolute);
  const staging = `${directory}.pending.${process.pid}.${crypto.randomUUID()}`;
  try {
    fs.mkdirSync(path.dirname(directory), { recursive: true });
    fs.mkdirSync(staging, { mode: 0o700 });
    writeJsonAtomic(path.join(staging, LEASE_RECORD), record);
    fs.renameSync(staging, directory);
  } catch (error) {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY", "EPERM"].includes(error?.code) && fs.existsSync(directory)) {
      throw activeLeaseError(absolute, operation);
    }
    throw error;
  }
  return controllerFor(record);
}

export function prepareStateLeaseWrite(controller, nextStateDigest) {
  requireValue(DIGEST_PATTERN.test(nextStateDigest || ""),
    "next automation state digest is invalid", 4);
  const record = ownedRecord(controller);
  const observed = observedStateDigest(controller.state_path);
  requireValue(observed === record.state_digest || observed === record.pending_state_digest,
    "automation state changed outside its active lease", 4);
  return writeLeaseRecord(controller.state_path, {
    ...record,
    pending_state_digest: nextStateDigest,
    phase: record.phase === "child-execution" ? record.phase : "state-write"
  });
}

export function commitStateLeaseWrite(controller, state, { inFlight = false } = {}) {
  const record = ownedRecord(controller);
  const observed = observedStateDigest(controller.state_path);
  requireValue(observed === state.state_digest && record.pending_state_digest === state.state_digest,
    "automation state lease could not commit the written state digest", 4);
  return writeLeaseRecord(controller.state_path, {
    ...record,
    state_digest: state.state_digest,
    pending_state_digest: null,
    phase: inFlight ? "child-intent" : "checkpoint",
    active_packet: inFlight ? record.active_packet : null,
    recover_after: inFlight ? record.recover_after : nowIso()
  });
}

export function markStateLeaseChildExecution(controller, {
  packetId,
  providerId,
  attempt,
  timeoutMs
}) {
  requireValue(typeof packetId === "string" && packetId.length > 0,
    "child lease checkpoint requires packet id", 4);
  requireValue(Number.isInteger(attempt) && attempt >= 1,
    "child lease checkpoint requires an attempt number", 4);
  requireValue(Number.isInteger(timeoutMs) && timeoutMs >= 100,
    "child lease checkpoint requires the adapter timeout", 4);
  const record = ownedRecord(controller);
  const markedAt = nowIso();
  return writeLeaseRecord(controller.state_path, {
    ...record,
    phase: "child-execution",
    active_packet: {
      packet_id: packetId,
      provider_id: providerId,
      attempt,
      marked_at: markedAt
    },
    recover_after: new Date(Date.parse(markedAt) + timeoutMs + CHILD_RECOVERY_GRACE_MS).toISOString()
  });
}

export function releaseStateLease(controller) {
  const record = ownedRecord(controller);
  requireValue(!["state-write", "child-intent", "child-execution"].includes(record.phase) &&
    record.pending_state_digest === null,
  "automation state lease remains held because a state write or child outcome is unresolved", 5);
  fs.rmSync(stateLeaseDirectory(controller.state_path), { recursive: true, force: false });
}

export function inspectStateLease(statePath) {
  const absolute = path.resolve(statePath);
  const directory = stateLeaseDirectory(absolute);
  if (!fs.existsSync(directory)) {
    return {
      state_lease_status_version: 1,
      status: "unlocked",
      state_path: absolute,
      state_digest: observedStateDigest(absolute),
      lease_directory: directory
    };
  }
  const lease = readLeaseRecord(absolute);
  const actualStateDigest = observedStateDigest(absolute);
  const owner = observeOwnerProcess(lease.owner_pid, lease.owner_process_identity);
  return {
    state_lease_status_version: 1,
    status: "locked",
    state_path: absolute,
    state_digest: actualStateDigest,
    lease_directory: directory,
    owner_token: lease.owner_token,
    owner_pid: lease.owner_pid,
    owner_pid_in_use: owner.pid_in_use,
    owner_process_alive: owner.identity_matches,
    owner_process_identity_matches: owner.pid_in_use
      ? (owner.identity_available ? owner.identity_matches : null)
      : false,
    owner_process_identity_method: lease.owner_process_identity.method,
    acquired_at: lease.acquired_at,
    updated_at: lease.updated_at,
    operation: lease.operation,
    phase: lease.phase,
    active_packet: lease.active_packet,
    recover_after: lease.recover_after,
    lease_digest: lease.lease_digest,
    bound_state_digests: [lease.state_digest, lease.pending_state_digest].filter(Boolean)
  };
}

function readRecoveryClaim(statePath) {
  const target = path.join(stateLeaseDirectory(statePath), RECOVERY_CLAIM);
  if (!fs.existsSync(target)) return null;
  const stat = fs.lstatSync(target);
  requireValue(stat.isFile() && !stat.isSymbolicLink(),
    "automation state lease recovery claim must be a regular file", 4);
  let claim;
  try {
    claim = JSON.parse(fs.readFileSync(target, "utf8"));
  } catch (error) {
    throw new RouterError(`cannot read automation state lease recovery claim: ${error.message}`, 4);
  }
  requireValue(claim?.state_lease_recovery_claim_version === 1 &&
    DIGEST_PATTERN.test(claim.target_lease_digest || "") &&
    typeof claim.claimant_token === "string" && claim.claimant_token.length >= 16 &&
    Number.isInteger(claim.claimant_pid) && claim.claimant_pid >= 1 &&
    claim.claimant_process_identity?.process_identity_version === 1 &&
    typeof claim.claimant_process_identity.method === "string" &&
    claim.claimant_process_identity.method.length > 0 &&
    DIGEST_PATTERN.test(claim.claimant_process_identity.marker || "") &&
    !Number.isNaN(Date.parse(claim.claimed_at || "")) &&
    DIGEST_PATTERN.test(claim.claim_digest || "") &&
    canonicalDigest(claimBody(claim)) === claim.claim_digest,
  "automation state lease recovery claim digest mismatch", 4);
  return claim;
}

function writeRecoveryClaim(statePath, claim) {
  const target = path.join(stateLeaseDirectory(statePath), RECOVERY_CLAIM);
  const fd = fs.openSync(target, "wx", 0o600);
  try {
    fs.writeFileSync(fd, `${JSON.stringify(claim, null, 2)}\n`);
  } finally {
    fs.closeSync(fd);
  }
  return target;
}

export function claimStaleStateLease({
  statePath,
  ownerToken,
  acquiredAt,
  stateDigest
}) {
  const absolute = path.resolve(statePath);
  requireValue(typeof ownerToken === "string" && ownerToken.length > 0,
    "lease recovery requires --owner-token", 2);
  requireValue(typeof acquiredAt === "string" && acquiredAt.length > 0,
    "lease recovery requires --acquired-at", 2);
  requireValue(validStateDigest(stateDigest),
    "lease recovery requires the exact --state-digest", 2);
  let record = readLeaseRecord(absolute);
  requireValue(record.owner_token === ownerToken,
    "lease recovery owner token does not match", 5);
  requireValue(record.acquired_at === acquiredAt,
    "lease recovery acquired timestamp does not match", 5);
  const observed = observedStateDigest(absolute);
  requireValue(observed === stateDigest,
    "lease recovery state digest does not match the current state", 5);
  requireValue([record.state_digest, record.pending_state_digest].includes(stateDigest),
    "lease recovery state digest is outside the lease-bound state transition", 5);
  const owner = observeOwnerProcess(record.owner_pid, record.owner_process_identity);
  requireValue(!owner.pid_in_use || owner.identity_available,
    "lease recovery cannot distinguish the recorded owner from a reused PID; process identity lookup failed closed",
    5);
  requireValue(!owner.identity_matches,
    "lease recovery refused because the exact recorded owner process is still active; PID alone is not treated as identity",
    5);
  requireValue(Date.now() >= Date.parse(record.recover_after),
    `lease recovery is not yet safe; retry after ${record.recover_after}`, 5);

  const claimPath = path.join(stateLeaseDirectory(absolute), RECOVERY_CLAIM);
  const existingClaim = readRecoveryClaim(absolute);
  if (existingClaim) {
    requireValue(existingClaim.target_lease_digest === record.lease_digest,
      "automation state lease has a conflicting recovery claim", 5);
    const claimant = observeOwnerProcess(
      existingClaim.claimant_pid,
      existingClaim.claimant_process_identity
    );
    requireValue(!claimant.pid_in_use || claimant.identity_available,
      "automation state lease recovery claimant identity cannot be verified", 5);
    requireValue(!claimant.identity_matches,
      "automation state lease recovery is already active", 5);
    fs.rmSync(claimPath);
  }

  const claimedAt = nowIso();
  const claimantProcessIdentity = processStartIdentity(process.pid);
  requireValue(claimantProcessIdentity,
    "cannot establish an OS process-start identity for lease recovery", 5);
  const claim = {
    state_lease_recovery_claim_version: 1,
    target_lease_digest: record.lease_digest,
    claimant_token: crypto.randomUUID(),
    claimant_pid: process.pid,
    claimant_process_identity: claimantProcessIdentity,
    claimed_at: claimedAt,
    claim_digest: null
  };
  claim.claim_digest = canonicalDigest(claimBody(claim));
  try {
    writeRecoveryClaim(absolute, claim);
  } catch (error) {
    if (error?.code === "EEXIST") throw new RouterError("automation state lease recovery is already active", 5);
    throw error;
  }

  try {
    const current = readLeaseRecord(absolute);
    requireValue(current.lease_digest === record.lease_digest,
      "automation state lease changed while recovery was being claimed", 5);
    record = current;
    const replacement = {
      state_lease_version: STATE_LEASE_VERSION,
      state_path: absolute,
      operation: "recover",
      owner_token: claim.claimant_token,
      owner_pid: process.pid,
      owner_process_identity: claimantProcessIdentity,
      acquired_at: claimedAt,
      updated_at: claimedAt,
      state_digest: observed,
      pending_state_digest: null,
      phase: "recovery",
      active_packet: null,
      recover_after: claimedAt,
      recovered_from: {
        lease_digest: record.lease_digest,
        owner_token_digest: canonicalDigest({ owner_token: record.owner_token }),
        owner_pid: record.owner_pid,
        owner_process_identity: record.owner_process_identity,
        acquired_at: record.acquired_at,
        operation: record.operation,
        phase: record.phase,
        state_digest: observed,
        active_packet: record.active_packet,
        recover_after: record.recover_after
      },
      lease_digest: null
    };
    replacement.lease_digest = canonicalDigest(leaseBody(replacement));
    writeJsonAtomic(recordPath(absolute), replacement);
    fs.rmSync(claimPath);
    return { controller: controllerFor(replacement), previous: record };
  } catch (error) {
    if (fs.existsSync(claimPath)) fs.rmSync(claimPath);
    throw error;
  }
}
