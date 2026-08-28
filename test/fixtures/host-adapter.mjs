import fs from "node:fs";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;

const request = JSON.parse(input);
const { packet, settings = {} } = request;

if (request.journey_identity?.identity_digest !== packet.journey_identity?.identity_digest) {
  throw new Error("fixture child received conflicting KillSlopRouter journey identities");
}
if (request.participant?.provider_id !== packet.provider?.id ||
  request.participant?.visibility !== "internal" ||
  request.participant?.orchestrator_id !== "kill-slop-router") {
  throw new Error("fixture child received an invalid internal participant binding");
}

if (settings.write_started_marker) {
  fs.writeFileSync(path.join(request.output_directory, "started.marker"), `${process.pid}\n`);
}

if (settings.write_pid_marker) {
  fs.writeFileSync(path.join(request.output_directory, `started.${process.pid}.marker`), `${process.pid}\n`);
}

if (settings.delay_ms) {
  await new Promise((resolve) => setTimeout(resolve, settings.delay_ms));
}

if ((settings.fail_attempts || []).includes(request.attempt)) {
  process.stderr.write(`fixture failure on attempt ${request.attempt}\n`);
  process.exit(17);
}

if (settings.invalid_json) {
  process.stdout.write("{not-json");
  process.exit(0);
}

if (settings.oversized_stdout_bytes) {
  const chunk = Buffer.alloc(1024 * 1024, "x");
  let remaining = settings.oversized_stdout_bytes;
  while (remaining > 0) {
    const bytes = Math.min(remaining, chunk.length);
    fs.writeSync(1, chunk, 0, bytes);
    remaining -= bytes;
  }
  process.exit(0);
}

const startedAt = new Date().toISOString();
const evidence = [];

if (packet.stage_id === "browser-evidence" && !settings.browser_missing_evidence) {
  const scenarios = packet.evidence_contract?.required_scenarios || [];
  for (const scenario of scenarios.length ? scenarios : [null]) {
    for (const viewport of packet.evidence_contract?.required_viewports || []) {
      const name = `${scenario ? `${scenario}-` : ""}${viewport}.png`;
      fs.writeFileSync(path.join(request.output_directory, name),
        `fixture screenshot ${scenario || "unspecified"} ${viewport}\n`);
      evidence.push({
        path: name,
        kind: "screenshot",
        covers: packet.assigned_capabilities,
        viewports: [viewport],
        checks: [],
        scenarios: scenario ? [scenario] : []
      });
    }
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
    checks: packet.evidence_contract?.required_checks || [],
    scenarios: packet.evidence_contract?.required_scenarios || []
  });
  if (settings.evidence_escape) {
    const escaped = path.join(request.output_directory, "..", "escaped-evidence.txt");
    fs.writeFileSync(escaped, "fixture attempted to escape its evidence grant\n");
    evidence.push({
      path: "../escaped-evidence.txt",
      kind: "test-report",
      covers: packet.assigned_capabilities,
      viewports: packet.evidence_contract?.required_viewports || [],
      checks: packet.evidence_contract?.required_checks || [],
      scenarios: packet.evidence_contract?.required_scenarios || []
    });
  }
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
    observed_journey_identity_digest: request.journey_identity.identity_digest,
    observed_participant: request.participant,
    observed_visual_signature_digest: packet.visual_signature_contract?.contract_digest || null,
    observed_primary_color: packet.visual_signature_contract?.palette?.primary?.[0]?.value || null
  }
}));
