# Adapter Contract

An adapter connects one external skill, scanner, browser harness, or local review
gate to KillSlopRouter. An unavailable routing provider blocks planning unless a
capability-complete fallback exists. A planned provider without executable host
authority remains `manual_pending`.

V1 separates the routing declaration in the project profile from executable
authority in a host adapter manifest. See `adapter-authoring.md` for the JSON
child protocol and `threat-model-and-permissions.md` for its permission limits.

Planning and execution are distinct. Profile status `routable` means a host can
dispatch the provider through the named executor; it is never evidence that the
provider completed a review.

## Capability Substitution

Each required stage has a capability contract and minimum strength. When a
primary provider is unavailable or below that strength, the router may select
one or more fallback providers only when:

- their combined capabilities cover every required capability;
- each selected provider meets the minimum strength;
- an independent critic is present when the stage requires one;
- the selected critic is not the artifact creator; and
- the profile gives an explicit availability and executor boundary.

The plan records primary failures, candidates, substitutions, covered
capabilities, and missing capabilities. Any missing capability blocks the stage.

## Required Identity

```json
{
  "tool_id": "kill-ai-slop",
  "kind": "scanner",
  "version": "git:96d1ca5",
  "stage": "static-discovery",
  "mode": "read-only-json"
}
```

Use an exact commit, package version, or local contract revision. Do not use star
count, repository popularity, or `latest` as provenance.

## Required Result

The built-in scanner first emits an adapter receipt:

```json
{
  "tool_id": "kill-ai-slop",
  "status": "pass_with_findings",
  "artifact": "relative/path/to/file",
  "artifact_digest": "sha256:...",
  "started_at": "RFC3339 timestamp",
  "finished_at": "RFC3339 timestamp",
  "findings": [
    {
      "id": "stable-or-local-id",
      "severity": "review",
      "category": "visual-tell",
      "location": "file:line",
      "claim": "What the adapter detected",
      "evidence": "Raw or linked evidence",
      "disposition": "open"
    }
  ]
}
```

Allowed result status values:

- `pass`
- `pass_with_findings`
- `blocked_unavailable`
- `blocked_execution_error`
- `skipped_by_route`

An advisory adapter cannot emit the final artifact verdict. Final disposition is
owned by project adjudication and approval stages.
Likewise, a scanner `pass` with zero findings is not design approval; required
visual-intent/signature, craft, browser, locale/domain/privacy, adjudication, and owner
packets remain independent.

For audit ingestion, non-scanner providers use
`../schemas/audit-result.schema.json`. `audit init` writes a provider-specific
template with the packet ID, exact artifact digest map, assigned capabilities,
and evidence requirements. Results must preserve the exact run ID, packet
digest, journey identity, internal participant metadata, and optional lineage
digest from that packet. `audit record` rejects cross-run or cross-parent
replay, a different provider, creator self-review, incomplete capability
coverage, stale artifact hashes, or missing browser proof. Public dispatch,
record, status, and finalization calls also require the caller-retained
`audit_authority_digest` emitted by `audit init`.

Visual routes include `packet.visual_intent_contract` and
`packet.visual_signature_contract`. The strength-4 `visual-intent-review`
provider must independently check direction plus palette, typography, density,
shape, elevation, imagery, motion, and forbidden transformations. It must use
the verified contracts rather than infer a house style or main color from
anti-slop rules, frequency, or the semantic surface name.

Scanner receipts may be ingested directly when the audit has one root artifact.
The standalone `scan --adapter kill-ai-slop` receipt intentionally has no
parent journey yet. `audit record` accepts that exact legacy-compatible scanner
shape only when its real artifact path and digest match the audit's sole root,
then records it as `standalone-compatibility-bound-at-ingest` under the current
KillSlopRouter journey and participant. If any packet-binding field is present,
the full run ID, packet digest, journey identity, participant, and applicable
baseline-lineage digest are mandatory; a partial binding never falls back to
standalone compatibility.
For several independent artifacts, aggregate their scans into one standard
audit result or initialize one run per root. Every scanner candidate must then
be resolved through `../schemas/triage.schema.json`.

## Finding Severity

- `blocker`: truth, privacy, authority, accessibility, dead control, missing
  required state, overflow, or fake-runtime failure.
- `major`: materially harms the primary task or hierarchy.
- `candidate`: requires semantic or rendered triage in the audit ledger.
- `minor`: bounded polish issue.

Do not convert every scanner hit into a blocker. Preserve the raw category and
record the reason when dismissing or accepting it.

## Execution Safety

- Default scanners to read-only output.
- Require explicit approval for repository writes, PR comments, PR closes,
  publishing, deployment, credentials, or production access.
- Keep browser screenshots and interaction traces separate from static findings.
- Bind every result and evidence file to the dispatch packet's artifact digests.
- Redact PII and secrets before sending artifacts to external services.
- Never claim an adapter ran when only its instructions were read.
- Never execute `command`, `args`, `shell`, or entrypoint fields from a project profile.
- Require an explicit host allowlist plus exact entrypoint and, when local
  modules are imported, module-graph digests before starting a child.
- Pin every local module's bytes and physical identity, revalidate the complete
  graph at the final child boundary, and execute it through the descriptor-fed
  sealed loader rather than reopening imports from mutable paths.
- Keep returned evidence inside the per-attempt output directory.
- Use `manual_pending` when a planned provider has no compatible host adapter.
