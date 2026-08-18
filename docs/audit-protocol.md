# Audit Protocol

The audit protocol separates route selection, critic execution, semantic
triage, and owner approval. A route plan is not execution evidence.

## Lifecycle

1. `plan` selects the creator and capability-complete providers.
2. `audit init` snapshots the plan and artifacts and emits one packet per
   selected provider.
3. The host runs each provider independently and writes an
   `audit-result.schema.json` result.
4. `audit record` validates provider identity, reviewer independence,
   capabilities, artifact digests, timestamps, and required browser evidence.
5. `audit triage` gives every scanner candidate an explicit disposition.
6. The adjudication provider records conflict resolutions against project or
   browser evidence. Scores are never averaged.
7. `audit finalize` re-hashes every source and emits the final receipt.
8. The owner approves or rejects the exact `approval_scope_digest`; approval is
   never inferred from critic success.

## Result Contract

Each dispatch packet includes a valid result template. The provider must keep
these values unchanged:

- `packet_id`
- `provider_id`
- `artifact_digests`
- the assigned capability set

The reviewer supplies a stable actor identity, verdict, findings, evidence,
and timestamps. A stage that needs multiple fallback providers passes only
when the union of recorded results covers the stage contract.

Browser evidence items declare which capabilities, viewports, and checks they
cover. The example profile requires mobile and desktop evidence plus keyboard,
state, overflow, contrast, 200 percent zoom, visual-regression, and
screen-reader checks. Each required viewport needs its own screenshot, and a
non-screenshot report must cover every required check.

## Finding Disposition

Valid dispositions are:

- `open`: not decided; blocks finalization.
- `fixed`: resolved in the reviewed artifact; requires evidence.
- `false-positive`: the detector does not apply; requires rationale.
- `informational`: useful but not a defect; requires rationale.
- `accepted-risk`: bounded non-hard debt accepted for owner review.
- `deferred`: unresolved work; blocks finalization.

Truth, privacy, authority, required-state, keyboard, contrast, clipping, dead
control, and fake-runtime findings are hard blockers. They cannot be cleared as
accepted risk.

## Integrity Boundary

The run stores SHA-256 snapshots of artifacts, route plans, critic result
files, screenshots, test reports, triage files, and owner approval. Any change
after recording blocks the receipt.

Symlink artifacts are rejected because hashing only a link path would not bind
the receipt to changing target content. Pass the resolved file or directory.

This detects stale or accidentally modified evidence. It is not a signature or
identity service. Use immutable CI storage and signed approvals when the threat
model includes a writer replacing both evidence and ledger data.

## Scope Boundary

Every run declares one scope:

- `mockup`: no runtime parity claim.
- `runtime`: runtime artifacts were reviewed.
- `source`: no rendered parity claim.
- `document`: document-only review.

The final receipt repeats the boundary. Providers may not broaden it.
Routes for `runtime-handoff` reject every scope except `runtime`.
