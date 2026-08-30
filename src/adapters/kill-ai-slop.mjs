import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RouterError } from "../router.mjs";
import {
  DEFAULT_HASH_IGNORES,
  hashArtifact,
  readFilePinned,
  snapshotArtifact,
  verifySnapshot
} from "../integrity.mjs";
import {
  createSealedEntrypointAuthority,
  sealedEntrypointGraphDigest,
  spawnSealedNodeEntrypoint
} from "../sealed-entrypoint.mjs";

function copyPinnedTree(source, destination, ignores) {
  const stat = fs.lstatSync(source);
  if (stat.isSymbolicLink()) {
    throw new RouterError(`scan target contains a symlink: ${source}`, 4);
  }
  if (stat.isDirectory()) {
    fs.mkdirSync(destination, { recursive: false, mode: 0o700 });
    for (const entry of fs.readdirSync(source, { withFileTypes: true })
      .filter((item) => !ignores.has(item.name))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      copyPinnedTree(path.join(source, entry.name), path.join(destination, entry.name), ignores);
    }
    return;
  }
  if (!stat.isFile()) throw new RouterError(`scan target contains an unsupported entry: ${source}`, 4);
  const pinned = readFilePinned(source, {
    label: `kill-ai-slop scan source ${source}`,
    requireCallerOwned: false
  });
  fs.writeFileSync(destination, pinned.source, { mode: 0o400, flag: "wx" });
}

function prepareScanTarget(target, expectedSnapshot) {
  const verification = verifySnapshot(expectedSnapshot);
  if (!verification.ok) {
    throw new RouterError(`scan target changed before sealing: ${verification.reason}`, 4);
  }
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-scan-"));
  const stat = fs.lstatSync(target);
  const sealedArtifact = stat.isDirectory() ? temp : path.join(temp, path.basename(target));
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target, { withFileTypes: true })
      .filter((item) => !DEFAULT_HASH_IGNORES.has(item.name))
      .sort((left, right) => left.name.localeCompare(right.name))) {
      copyPinnedTree(
        path.join(target, entry.name),
        path.join(temp, entry.name),
        DEFAULT_HASH_IGNORES
      );
    }
  } else {
    copyPinnedTree(target, sealedArtifact, DEFAULT_HASH_IGNORES);
  }
  const confirmed = verifySnapshot(expectedSnapshot);
  if (!confirmed.ok) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new RouterError(`scan target changed while it was being sealed: ${confirmed.reason}`, 4);
  }
  const sealedDigest = hashArtifact(sealedArtifact);
  if (sealedDigest !== expectedSnapshot.digest) {
    fs.rmSync(temp, { recursive: true, force: true });
    throw new RouterError("sealed scan target digest conflicts with its audit authority", 4);
  }
  return {
    scanTarget: temp,
    cleanup: () => fs.rmSync(temp, { recursive: true, force: true })
  };
}

export function findKillAiSlopScanner(adapterRoot) {
  const absoluteRoot = path.resolve(adapterRoot);
  return [
    path.join(absoluteRoot, "skill", "scripts", "scan.mjs"),
    path.join(absoluteRoot, "scripts", "scan.mjs")
  ].find((candidate) => fs.existsSync(candidate));
}

export function runKillAiSlop({
  adapterRoot,
  target,
  version = null,
  scannerPath = null,
  environment = null,
  entrypointAuthority = null,
  expectedArtifactSnapshot = null
}) {
  const absoluteRoot = path.resolve(adapterRoot);
  const absoluteTarget = path.resolve(target);
  const scanner = scannerPath ? path.resolve(scannerPath) : findKillAiSlopScanner(absoluteRoot);
  if (!scanner) {
    throw new RouterError(`kill-ai-slop scanner not found under: ${absoluteRoot}`, 4);
  }
  if (!fs.existsSync(scanner)) {
    throw new RouterError(`kill-ai-slop scanner is not a file: ${scanner}`, 4);
  }
  const scannerStat = fs.lstatSync(scanner);
  if (!scannerStat.isFile() || scannerStat.isSymbolicLink()) {
    throw new RouterError(`kill-ai-slop scanner must be a regular non-symlink file: ${scanner}`, 4);
  }
  if (!fs.existsSync(absoluteTarget)) {
    throw new RouterError(`scan target not found: ${absoluteTarget}`, 4);
  }

  const startedAt = new Date().toISOString();
  const artifactSnapshot = expectedArtifactSnapshot || snapshotArtifact(absoluteTarget, {
    root: path.dirname(absoluteTarget)
  });
  if (path.resolve(artifactSnapshot.resolved_path || "") !== absoluteTarget) {
    throw new RouterError("scan target does not match its audit artifact authority", 4);
  }
  const artifactDigest = artifactSnapshot.digest;
  const prepared = prepareScanTarget(absoluteTarget, artifactSnapshot);
  const sealedEntrypoint = entrypointAuthority || createSealedEntrypointAuthority(
    scanner,
    hashArtifact(scanner),
    {
      label: "kill-ai-slop scanner entrypoint",
      expectedGraphDigest: sealedEntrypointGraphDigest(scanner)
    }
  );
  let result;
  try {
    result = spawnSealedNodeEntrypoint(sealedEntrypoint, [prepared.scanTarget, "--json"], {
      encoding: "utf8",
      env: environment || process.env,
      shell: false,
      maxBuffer: 32 * 1024 * 1024
    });
  } finally {
    prepared.cleanup();
  }

  const finishedAt = new Date().toISOString();
  if (result.error || result.status !== 0) {
    return {
      adapter_receipt_version: 1,
      tool_id: "kill-ai-slop",
      version,
      stage: "static-discovery",
      mode: "read-only-json",
      status: "blocked_execution_error",
      artifact: absoluteTarget,
      artifact_digest: artifactDigest,
      started_at: startedAt,
      finished_at: finishedAt,
      error: result.error?.message || result.stderr || `exit ${result.status}`,
      findings: []
    };
  }

  let raw;
  try {
    raw = JSON.parse(result.stdout);
  } catch (error) {
    throw new RouterError(`kill-ai-slop emitted invalid JSON: ${error.message}`, 4);
  }

  if (!Array.isArray(raw.findings)) {
    throw new RouterError("kill-ai-slop JSON requires a findings array", 4);
  }
  const findings = raw.findings.flatMap((group) =>
    group.hits.map((hit, index) => ({
      id: `${group.id}-${index + 1}`,
      source_rule_id: group.id,
      severity: "review",
      category: group.group,
      location: `${hit.file}:${hit.line}`,
      claim: group.name,
      evidence: hit.text,
      suggested_fix: group.fix,
      disposition: "open"
    }))
  );

  return {
    adapter_receipt_version: 1,
    tool_id: "kill-ai-slop",
    version,
    stage: "static-discovery",
    mode: "read-only-json",
    status: findings.length ? "pass_with_findings" : "pass",
    artifact: absoluteTarget,
    artifact_digest: artifactDigest,
    started_at: startedAt,
    finished_at: finishedAt,
    summary: {
      files_scanned: raw.filesScanned,
      groups: raw.groups,
      hits: raw.hits
    },
    findings
  };
}
