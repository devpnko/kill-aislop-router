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

For audit ingestion, non-scanner providers use
`../schemas/audit-result.schema.json`. `audit init` writes a provider-specific
template with the packet ID, exact artifact digest map, assigned capabilities,
and evidence requirements. `audit record` rejects a different provider,
creator self-review, incomplete capability coverage, stale artifact hashes, or
missing browser proof.

Scanner receipts may be ingested directly when the audit has one root artifact.
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
- Require an explicit host allowlist and an exact entrypoint digest before starting a child.
- Keep returned evidence inside the per-attempt output directory.
- Use `manual_pending` when a planned provider has no compatible host adapter.
