import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { RouterError } from "../router.mjs";

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function walkFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if ([".git", "node_modules"].includes(entry.name)) continue;
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walkFiles(absolute));
    if (entry.isFile()) files.push(absolute);
  }
  return files;
}

function hashArtifact(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return `sha256:${hashFile(target)}`;
  const hash = crypto.createHash("sha256");
  for (const file of walkFiles(target).sort()) {
    hash.update(path.relative(target, file));
    hash.update("\0");
    hash.update(hashFile(file));
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function prepareScanTarget(target) {
  const stat = fs.statSync(target);
  if (stat.isDirectory()) return { scanTarget: target, cleanup: () => {} };
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-scan-"));
  fs.copyFileSync(target, path.join(temp, path.basename(target)));
  return {
    scanTarget: temp,
    cleanup: () => fs.rmSync(temp, { recursive: true, force: true })
  };
}

export function runKillAiSlop({ adapterRoot, target, version = null }) {
  const absoluteRoot = path.resolve(adapterRoot);
  const absoluteTarget = path.resolve(target);
  const scanner = [
    path.join(absoluteRoot, "skill", "scripts", "scan.mjs"),
    path.join(absoluteRoot, "scripts", "scan.mjs")
  ].find((candidate) => fs.existsSync(candidate));
  if (!scanner) {
    throw new RouterError(`kill-ai-slop scanner not found under: ${absoluteRoot}`, 4);
  }
  if (!fs.existsSync(absoluteTarget)) {
    throw new RouterError(`scan target not found: ${absoluteTarget}`, 4);
  }

  const startedAt = new Date().toISOString();
  const artifactDigest = hashArtifact(absoluteTarget);
  const prepared = prepareScanTarget(absoluteTarget);
  let result;
  try {
    result = spawnSync(process.execPath, [scanner, prepared.scanTarget, "--json"], {
      encoding: "utf8",
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
