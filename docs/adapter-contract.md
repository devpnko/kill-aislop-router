# Adapter Contract

An adapter connects one external skill, scanner, browser harness, or local review
gate to KillSlopRouter. The router may plan an unavailable adapter, but execution
must report it as blocked.

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

## Finding Severity

- `blocker`: truth, privacy, authority, accessibility, dead control, missing
  required state, overflow, or fake-runtime failure.
- `major`: materially harms the primary task or hierarchy.
- `review`: requires semantic or rendered triage.
- `minor`: bounded polish issue.

Do not convert every scanner hit into a blocker. Preserve the raw category and
record the reason when dismissing or accepting it.

## Execution Safety

- Default scanners to read-only output.
- Require explicit approval for repository writes, PR comments, PR closes,
  publishing, deployment, credentials, or production access.
- Keep browser screenshots and interaction traces separate from static findings.
- Redact PII and secrets before sending artifacts to external services.
- Never claim an adapter ran when only its instructions were read.
