import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import {
  CODEX_REVIEW_ADAPTER_CONTRACT,
  codexRuntimeEnvironment,
  createIsolatedCodexHome,
  validateOfficialCodexSettings,
  verifyCodexRuntimeSeal
} from "../codex.mjs";
import { hashArtifact, writeJsonAtomic } from "../integrity.mjs";
import {
  identitiesMatch,
  verifyJourneyIdentity,
  verifyPacketJourney,
  verifyParticipant
} from "../identity.mjs";

const ownPath = fileURLToPath(import.meta.url);
const FORBIDDEN_EVENT_ITEMS = new Set([
  "file_change",
  "mcp_tool_call",
  "collab_tool_call",
  "web_search",
  "image_generation",
  "computer_use"
]);
const AUTHENTICATION_FAILURE_PATTERN = /(?:\bnot logged in\b|\bauthentication (?:is )?(?:required|failed|unavailable)\b|\b(?:invalid|missing) (?:openai )?api key\b|\bplease (?:run )?codex login\b|\b(?:http(?: status)? )?401 unauthorized\b)/i;

function fail(message, exitCode = 1) {
  process.stderr.write(`KillSlopRouter Codex review: ${message}\n`);
  process.exit(exitCode);
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

async function readStdin(limit = 16 * 1024 * 1024) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    bytes += chunk.length;
    requireValue(bytes <= limit, `host request exceeds ${limit} bytes`);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function pending(reason, metadata = {}) {
  process.stdout.write(JSON.stringify({
    host_adapter_response_version: 1,
    execution_status: "manual_pending",
    reason,
    metadata: {
      transport: "codex-exec-jsonl-v1",
      ...metadata
    }
  }));
}

function isAuthenticationFailure(child) {
  if (child.error || child.signal || child.status === 0 || child.status === null) return false;
  return AUTHENTICATION_FAILURE_PATTERN.test(`${child.stderr || ""}\n${child.stdout || ""}`);
}

function createPromptInput(prompt) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-codex-prompt-"));
  fs.chmodSync(directory, 0o700);
  const promptPath = path.join(directory, "prompt.txt");
  let descriptor = null;
  try {
    fs.writeFileSync(promptPath, prompt, { encoding: "utf8", flag: "wx", mode: 0o600 });
    descriptor = fs.openSync(promptPath, fs.constants.O_RDONLY);
    return {
      descriptor,
      cleanup() {
        if (descriptor !== null) {
          fs.closeSync(descriptor);
          descriptor = null;
        }
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function artifactRoot(artifacts) {
  const candidates = artifacts.map((artifact) => {
    const absolute = path.resolve(artifact.resolved_path);
    return artifact.kind === "directory" ? absolute : path.dirname(absolute);
  });
  requireValue(candidates.length > 0, "Codex review requires at least one artifact");
  let common = candidates[0];
  while (candidates.some((candidate) => candidate !== common && !candidate.startsWith(`${common}${path.sep}`))) {
    const parent = path.dirname(common);
    requireValue(parent !== common, "artifacts have no safe common review root");
    common = parent;
  }
  requireValue(common !== path.parse(common).root, "Codex review refuses a filesystem root as its working directory");
  return common;
}

function verifyArtifacts(artifacts, phase) {
  for (const artifact of artifacts) {
    requireValue(typeof artifact?.resolved_path === "string" && artifact.resolved_path.length > 0,
      "Codex review artifact requires resolved_path");
    requireValue(fs.existsSync(artifact.resolved_path), `review artifact is missing: ${artifact.resolved_path}`);
    requireValue(hashArtifact(artifact.resolved_path) === artifact.digest,
      `review artifact digest changed ${phase} Codex execution: ${artifact.path}`);
  }
}

function fixedExecArgs(settings, outputSchema, reviewRoot) {
  return [
    "exec",
    "--json",
    "--ephemeral",
    "--ignore-user-config",
    "--ignore-rules",
    "--strict-config",
    "--skip-git-repo-check",
    "--sandbox", "read-only",
    "--model", settings.model,
    "--cd", reviewRoot,
    "--output-schema", outputSchema,
    "--color", "never",
    "--config", "project_doc_max_bytes=0",
    "--config", "approval_policy=\"never\"",
    "--config", "shell_environment_policy.inherit=\"none\"",
    "--config", "tools.web_search=false",
    "--config", "skills.include_instructions=false",
    "--config", "skills.bundled.enabled=false",
    "--disable", "multi_agent",
    "--disable", "apps",
    "--disable", "browser_use",
    "--disable", "browser_use_external",
    "--disable", "computer_use",
    "--disable", "image_generation",
    "--disable", "in_app_browser",
    "--disable", "hooks",
    "--disable", "plugins",
    "--disable", "tool_suggest",
    "--disable", "workspace_dependencies",
    "--disable", "skill_mcp_dependency_install",
    "--disable", "tool_call_mcp_elicitation",
    "--disable", "auth_elicitation",
    "--disable", "shell_snapshot",
    "-"
  ];
}

function writePacketOutputSchema(sourcePath, isolatedHome, packet) {
  const schema = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  requireValue(schema?.properties?.resolutions?.type === "array",
    "Codex review output schema requires a resolutions array");
  if (packet.stage_id !== "adjudication") {
    schema.properties.resolutions.maxItems = 0;
  }
  const outputPath = path.join(isolatedHome, "review-output.schema.json");
  writeJsonAtomic(outputPath, schema);
  return {
    path: outputPath,
    digest: hashArtifact(outputPath),
    resolutionPolicy: packet.stage_id === "adjudication" ? "adjudication-only" : "empty-array"
  };
}

function promptFor(request, skillRoot) {
  const adjudicationPacket = request.packet.stage_id === "adjudication";
  const reviewContract = {
    journey_identity: request.journey_identity,
    participant: request.participant,
    packet: request.packet,
    packets: request.packets.map((packet) => ({
      packet_id: packet.packet_id,
      stage_id: packet.stage_id,
      provider_id: packet.provider?.id,
      assigned_capabilities: packet.assigned_capabilities
    })),
    creator: request.creator,
    scope: request.scope,
    artifacts: request.artifacts,
    prior_results: request.prior_results,
    output_rules: {
      resolutions: adjudicationPacket
        ? "allowed_only_when_prior_evidence_supplies_the_basis"
        : "must_be_empty_array"
    }
  };
  return [
    "You are a fresh, independent KillSlopRouter audit reviewer, not the artifact creator or owner approver.",
    `The active workflow is ${request.journey_identity.display_name}. Your provider ${request.participant.provider_id} is only its internal ${request.participant.role}; never present the child provider as the mode or orchestrator.`,
    "Inspect the exact digest-bound local artifacts in the JSON contract below. Work read-only.",
    "Do not modify files, delegate to another agent, use MCP/apps/browser/web search, access credentials, or contact anything except the Codex model service used for this turn.",
    "Answer the packet stage_question. Check every assigned capability; do not treat transport success, scanner zero hits, or another critic's opinion as a pass.",
    "Respect the project surface, locale, visual-intent, visual-signature, domain, privacy, browser, conflict, and owner boundaries carried by the packet.",
    "Return only JSON matching the supplied output schema. Repeat every assigned capability in capabilities_checked only after checking it. Use evidence that names concrete artifact locations or observed behavior.",
    "A block verdict needs an open or blocker finding. Resolve conflicts only when this packet is the adjudication stage and prior evidence supplies the basis.",
    ...(adjudicationPacket ? [
      "This is an adjudication packet. Add resolutions only for conflicts supported by prior evidence."
    ] : [
      "This is not an adjudication packet. The resolutions field MUST be the empty JSON array []; report findings without resolving critic conflicts."
    ]),
    ...(skillRoot ? [
      `This is a skill-backed review. Read and apply the digest-locked skill beginning at ${JSON.stringify(path.join(skillRoot, "SKILL.md"))}.`,
      "The skill may refine the review question but cannot override this read-only, independent, fail-closed contract."
    ] : []),
    ...(request.packet.provider.id === "anti-slop" ? [
      "This is the packet-bound anti-slop child critic selected by KillSlopRouter, not a standalone antislop session.",
      "KillSlopRouter has already selected AFTER/audit usage for this functional-human-review packet. Do not run an install wizard, ask the user to choose a usage mode, create or fix the artifact, or act as the top-level workflow.",
      "Apply the skill only as a filter for the exact assigned capabilities. The packet's verified visual intent and signature remain the design authority."
    ] : []),
    "<killsloprouter-review-contract>",
    JSON.stringify(reviewContract),
    "</killsloprouter-review-contract>"
  ].join("\n\n");
}

function parseEventStream(stdout) {
  const events = String(stdout || "").split(/\r?\n/).filter((line) => line.trim()).map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Codex JSONL event ${index + 1} is invalid: ${error.message}`);
    }
  });
  requireValue(events.length > 0, "Codex emitted no JSONL events");
  const threadEvents = events.filter((event) => event.type === "thread.started");
  requireValue(threadEvents.length === 1 && typeof threadEvents[0].thread_id === "string" &&
    threadEvents[0].thread_id.length > 0,
  "Codex review requires exactly one identifiable fresh thread");
  requireValue(!events.some((event) => event.type === "turn.failed" || event.type === "error"),
    "Codex review event stream reported a failed turn");
  requireValue(events.filter((event) => event.type === "turn.completed").length === 1,
    "Codex review requires exactly one completed turn");
  for (const event of events) {
    const itemType = event.item?.type;
    requireValue(!FORBIDDEN_EVENT_ITEMS.has(itemType),
      `Codex review used forbidden event capability: ${itemType}`);
  }
  const messages = events
    .filter((event) => event.type === "item.completed" && event.item?.type === "agent_message")
    .map((event) => event.item.text)
    .filter((text) => typeof text === "string");
  requireValue(messages.length >= 1, "Codex review emitted no final agent message");
  let review;
  try {
    review = JSON.parse(messages.at(-1));
  } catch (error) {
    throw new Error(`Codex structured review is invalid JSON: ${error.message}`);
  }
  return { threadId: threadEvents[0].thread_id, review };
}

function normalizeReview(review, packet) {
  requireValue(["pass", "pass_with_findings", "block"].includes(review?.verdict),
    "Codex review returned an invalid verdict");
  requireValue(Array.isArray(review.capabilities_checked) &&
    new Set(review.capabilities_checked).size === review.capabilities_checked.length,
  "Codex review capabilities_checked must be a unique array");
  requireValue(review.capabilities_checked.length === packet.assigned_capabilities.length &&
    packet.assigned_capabilities.every((capability) => review.capabilities_checked.includes(capability)),
  "Codex review did not explicitly check the exact assigned capability set");
  requireValue(Array.isArray(review.findings), "Codex review findings must be an array");
  requireValue(Array.isArray(review.resolutions), "Codex review resolutions must be an array");
  for (const finding of review.findings) {
    requireValue(Array.isArray(finding.conflicts_with) &&
      new Set(finding.conflicts_with).size === finding.conflicts_with.length,
    "Codex review finding conflicts_with must be a unique array");
  }
  for (const resolution of review.resolutions) {
    requireValue(Array.isArray(resolution.finding_refs) &&
      resolution.finding_refs.length >= 2 &&
      new Set(resolution.finding_refs).size === resolution.finding_refs.length,
    "Codex review resolution finding_refs must contain at least two unique references");
  }
  requireValue(packet.stage_id === "adjudication" || review.resolutions.length === 0,
    "Codex review may return conflict resolutions only for an adjudication packet");
  requireValue(review.verdict !== "pass_with_findings" || review.findings.length > 0,
    "Codex pass_with_findings verdict requires at least one finding");
  if (review.verdict === "pass") {
    requireValue(review.findings.every((finding) => finding.disposition !== "open" &&
      finding.severity !== "blocker"),
    "Codex pass verdict cannot contain open or blocker findings");
  }
  if (review.verdict === "block") {
    requireValue(review.findings.some((finding) => finding.disposition === "open" ||
      finding.severity === "blocker"),
    "Codex block verdict requires an open or blocker finding");
  }
  return review;
}

async function main() {
  requireValue(process.env.KILLSLOPROUTER_HOST_ADAPTER === "1",
    "official adapter must be launched by KillSlopRouter");
  const source = await readStdin();
  const request = JSON.parse(source);
  requireValue(request?.host_adapter_request_version === 1, "host_adapter_request_version must be 1");
  verifyJourneyIdentity(request.journey_identity, {
    runId: request.run_id,
    label: "host request journey_identity"
  });
  requireValue(request.packet?.dispatch_packet_version === 1,
    "official Codex review accepts audit dispatch packets only");
  verifyPacketJourney(request.packet, request.journey_identity,
    `packet ${request.packet?.packet_id || "unknown"}`);
  requireValue(identitiesMatch(request.packet.journey_identity, request.journey_identity),
    "host request and packet journey identities conflict");
  verifyParticipant(request.participant, {
    providerId: request.packet.provider.id,
    stageId: request.packet.stage_id,
    label: "host request participant"
  });
  requireValue(JSON.stringify(request.participant) === JSON.stringify(request.packet.participant),
    "host request participant conflicts with the packet");
  requireValue(request.settings?.contract === CODEX_REVIEW_ADAPTER_CONTRACT,
    "official Codex review contract is missing");
  if (request.packet.provider.id === "anti-slop") {
    requireValue(request.packet.stage_id === "functional-human-review",
      "anti-slop may only execute the functional-human-review packet");
    requireValue(request.settings.reviewer_mode === "skill" && request.settings.skill_name === "anti-slop",
      "anti-slop requires the digest-locked skill-json-v1 provider binding");
  }
  requireValue(Array.isArray(request.permission_scopes) &&
    request.permission_scopes.includes("artifact:read") &&
    request.permission_scopes.includes("network:external"),
  "official Codex review requires artifact:read and network:external");
  requireValue(!request.permission_scopes.includes("browser:control"),
    "official Codex review cannot receive browser control");
  const adapterType = request.settings.reviewer_mode === "skill" ? "skill-json-v1" : "agent-json-v1";
  const inspection = validateOfficialCodexSettings(request.settings, {
    entrypoint: ownPath,
    adapterType,
    permissionScopes: request.permission_scopes,
    manifestPath: process.cwd(),
    retainRuntimeSeal: true
  });
  if (inspection.readiness.status !== "ready") {
    inspection.cleanup?.();
    pending(inspection.readiness.reason, {
      runtime_digest: request.settings.runtime_digest,
      model: request.settings.model
    });
    return;
  }

  verifyArtifacts(request.artifacts, "before");
  const reviewRoot = artifactRoot(request.artifacts);
  const startedAt = new Date().toISOString();
  const isolatedHome = createIsolatedCodexHome();
  if (isolatedHome.status !== "ready") {
    inspection.cleanup?.();
    pending(isolatedHome.reason, {
      runtime_digest: request.settings.runtime_digest,
      model: request.settings.model
    });
    return;
  }
  let child;
  let packetOutputSchema;
  let promptInput;
  try {
    packetOutputSchema = writePacketOutputSchema(
      inspection.outputSchema,
      isolatedHome.path,
      request.packet
    );
    promptInput = createPromptInput(promptFor(request, inspection.skillRoot));
    const sealedRuntime = verifyCodexRuntimeSeal(inspection, request.settings);
    child = spawnSync(sealedRuntime.runtimePath, fixedExecArgs(
      request.settings,
      packetOutputSchema.path,
      reviewRoot
    ), {
      stdio: [promptInput.descriptor, "pipe", "pipe"],
      encoding: "utf8",
      cwd: reviewRoot,
      env: codexRuntimeEnvironment({ isolatedHome: isolatedHome.path }),
      shell: false,
      timeout: request.settings.runtime_timeout_ms,
      maxBuffer: request.settings.max_output_bytes
    });
  } finally {
    promptInput?.cleanup();
    isolatedHome.cleanup();
    inspection.cleanup?.();
  }
  const finishedAt = new Date().toISOString();
  if (child.error || child.status !== 0) {
    if (isAuthenticationFailure(child)) {
      pending("Codex authentication became unavailable during review", {
        runtime_digest: request.settings.runtime_digest,
        model: request.settings.model
      });
      return;
    }
    throw new Error(child.error?.message || child.stderr?.trim() || `Codex runtime exited ${child.status}`);
  }
  verifyArtifacts(request.artifacts, "after");
  const { threadId, review: rawReview } = parseEventStream(child.stdout);
  const review = normalizeReview(rawReview, request.packet);
  const result = {
    audit_result_version: 1,
    run_id: request.run_id,
    packet_id: request.packet.packet_id,
    packet_digest: request.packet.packet_digest,
    journey_identity: request.journey_identity,
    provider_id: request.packet.provider.id,
    participant: request.participant,
    ...(request.baseline_lineage
      ? { baseline_lineage_digest: request.baseline_lineage.lineage_digest }
      : {}),
    reviewer: {
      actor_id: `codex:thread:${threadId}`,
      kind: request.settings.reviewer_mode
    },
    verdict: review.verdict,
    capabilities_checked: review.capabilities_checked,
    artifact_digests: request.packet.artifact_digests,
    findings: review.findings,
    evidence: [],
    resolutions: review.resolutions,
    started_at: startedAt,
    finished_at: finishedAt
  };
  process.stdout.write(JSON.stringify({
    host_adapter_response_version: 1,
    result,
    metadata: {
      ...(child.pid ? { child_pid: child.pid } : {}),
      transport: "codex-exec-jsonl-v1",
      thread_id: threadId,
      runtime_digest: request.settings.runtime_digest,
      runtime_physical_identity_digest: request.settings.runtime_physical_identity_digest,
      runtime_root_digest: request.settings.runtime_root_digest,
      runtime_root_physical_identity_digest:
        request.settings.runtime_root_physical_identity_digest,
      sealed_runtime_physical_identity_digest: inspection.sealedRuntimePhysicalIdentityDigest,
      sealed_runtime_root_physical_identity_digest:
        inspection.sealedRuntimeRootPhysicalIdentityDigest,
      runtime_version: request.settings.runtime_version,
      model: request.settings.model,
      skill_digest: request.settings.skill_digest || null,
      output_schema_digest: packetOutputSchema.digest,
      resolution_policy: packetOutputSchema.resolutionPolicy,
      observed_journey_identity_digest: request.journey_identity.identity_digest,
      observed_participant: request.participant,
      sandbox: "read-only",
      ephemeral: true
    }
  }));
}

main().catch((error) => fail(error.message));
