import fs from "node:fs";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
const { packet, settings = {} } = request;

if ((settings.fail_attempts || []).includes(request.attempt)) {
  process.stderr.write(`fixture failure on attempt ${request.attempt}\n`);
  process.exit(17);
}

const startedAt = new Date().toISOString();
const evidence = [];

if (packet.stage_id === "browser-evidence" && !settings.browser_missing_evidence) {
  for (const viewport of packet.evidence_contract?.required_viewports || []) {
    const name = `${viewport}.png`;
    fs.writeFileSync(path.join(request.output_directory, name), `fixture screenshot ${viewport}\n`);
    evidence.push({
      path: name,
      kind: "screenshot",
      covers: packet.assigned_capabilities,
      viewports: [viewport],
      checks: []
    });
  }
  fs.writeFileSync(path.join(request.output_directory, "browser-report.json"), JSON.stringify({
    passed: true,
    child_pid: process.pid
  }));
  evidence.push({
    path: "browser-report.json",
    kind: "test-report",
    covers: packet.assigned_capabilities,
    viewports: packet.evidence_contract?.required_viewports || [],
    checks: packet.evidence_contract?.required_checks || []
  });
}

function packetFor(stageId) {
  return request.packets.find((candidate) => candidate.stage_id === stageId);
}

const findings = [];
if (settings.emit_conflict && packet.stage_id === "functional-human-review") {
  const other = packetFor("rendered-craft-review");
  findings.push({
    id: "functional-conflict",
    severity: "minor",
    category: "workflow-density",
    claim: "Keep the compact workflow",
    evidence: "Fixture functional evidence",
    disposition: "informational",
    rationale: "The workflow needs same-screen comparison.",
    conflicts_with: other ? [`${other.packet_id}/craft-conflict`] : []
  });
}
if (settings.emit_conflict && packet.stage_id === "rendered-craft-review") {
  const other = packetFor("functional-human-review");
  findings.push({
    id: "craft-conflict",
    severity: "minor",
    category: "visual-restraint",
    claim: "Split the compact workflow",
    evidence: "Fixture rendered evidence",
    disposition: "informational",
    rationale: "The rendered grouping is crowded.",
    conflicts_with: other ? [`${other.packet_id}/functional-conflict`] : []
  });
}

const resolutions = [];
if (packet.stage_id === "adjudication" && settings.resolve_conflicts !== false) {
  const known = new Set();
  for (const result of request.prior_results) {
    for (const finding of result.findings) known.add(`${result.packet_id}/${finding.id}`);
  }
  const pairs = [];
  for (const result of request.prior_results) {
    for (const finding of result.findings) {
      const own = `${result.packet_id}/${finding.id}`;
      for (const other of finding.conflicts_with || []) {
        if (!known.has(other)) continue;
        const pair = [own, other].sort();
        if (!pairs.some((candidate) => candidate[0] === pair[0] && candidate[1] === pair[1])) {
          pairs.push(pair);
        }
      }
    }
  }
  for (const pair of pairs) {
    resolutions.push({
      finding_refs: pair,
      decision: "Fixture adjudication keeps the task-safe composition",
      basis: "project-contract-and-browser-evidence",
      rationale: "The fixture browser and task evidence resolve this conflict."
    });
  }
}

const reviewerActorId = settings.reviewer_actor_id === "__creator__"
  ? request.creator.actor_id
  : settings.reviewer_actor_id || `fixture-reviewer:${packet.provider.id}:${process.pid}`;

const result = {
  audit_result_version: 1,
  packet_id: packet.packet_id,
  provider_id: packet.provider.id,
  reviewer: {
    actor_id: reviewerActorId,
    kind: packet.provider.kind || "agent"
  },
  verdict: findings.length ? "pass_with_findings" : "pass",
  capabilities_checked: packet.assigned_capabilities,
  artifact_digests: packet.artifact_digests,
  findings,
  evidence,
  resolutions,
  started_at: startedAt,
  finished_at: new Date().toISOString()
};

process.stdout.write(JSON.stringify({
  host_adapter_response_version: 1,
  result,
  metadata: {
    child_pid: process.pid,
    transport: "node-json-stdio-fixture",
    observed_visual_signature_digest: packet.visual_signature_contract?.contract_digest || null,
    observed_primary_color: packet.visual_signature_contract?.palette?.primary?.[0]?.value || null
  }
}));
