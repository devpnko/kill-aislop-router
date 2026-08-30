# Audit Protocol

The audit protocol separates route selection, critic execution, semantic
triage, and owner approval. A route plan is not execution evidence.

## Lifecycle

1. `plan` resolves the surface, verifies its digest-bound visual intent and exact visual signature, and
   then selects the creator and capability-complete providers.
2. If configured, the service-planning bridge verifies the required gate,
   receipt digest, and evidence digests for the requested task and scope.
3. `audit init` snapshots the plan, both visual authority receipts and evidence, and
   artifacts, then emits one packet per selected provider.
4. The host runs each provider independently and writes an
   `audit-result.schema.json` result.
5. `audit record` validates provider identity, reviewer independence,
   capabilities, artifact digests, timestamps, and required browser evidence.
6. `audit triage` gives every scanner candidate an explicit disposition.
7. The adjudication provider records conflict resolutions against project or
   browser evidence. Scores are never averaged.
8. `audit finalize` re-hashes every source and emits the final receipt. The
   receipt retains the canonical route plan `resolved_path` so a resume or
   verifier can dereference and re-hash the exact planning authority.
9. The owner approves or rejects the exact `approval_scope_digest`; approval is
   never inferred from critic success.

The audit ledger, every dispatch packet, final receipt, and owner approval bind
the same `journey_identity`. The public contracts are
[`audit-run.schema.json`](../schemas/audit-run.schema.json),
[`dispatch-packet.schema.json`](../schemas/dispatch-packet.schema.json),
[`audit-receipt.schema.json`](../schemas/audit-receipt.schema.json), and
[`owner-approval.schema.json`](../schemas/owner-approval.schema.json). A packet
also keeps the exact child `provider_id` as an `internal` participant role;
that provenance never changes the active workflow name from KillSlopRouter.

`audit init` also emits an `audit_authority_digest`. Retain it outside the
mutable audit JSON and pass it to every public `audit dispatch`, `audit record`,
`audit triage`, `audit status`, and `audit finalize` call with
`--authority-digest`. The value
binds the canonical plan source, creator actor, journey identity, artifacts,
packet scope, and optional parent/slice lineage. Recomputing a replacement from
an edited run is not authority.

Standalone audit paths use the same fail-closed filesystem boundary as the
integrated runner. `audit init` validates the ledger and packet directory before
its first write; dispatch validates the output root and every generated packet;
record, triage, status, and finalize reject an audit run below a symlinked
ancestor. Result, triage, approval, and explicit `--out` receipt-file paths are
also validated as regular or safe writable paths. A rejected filesystem path
leaves the symlink target empty and the original ledger unchanged. JSON/text on
stdout remains intentionally pipeable for automation; it is not a path opened
or trusted by KillSlopRouter and does not replace the digest-bound receipt file.

The integrated `run` command persists this lifecycle as nine separately hashed
phase receipts. It executes non-adjudication critics first, stops for scanner
triage, then executes adjudication and finalization. See `automation-run.md`.

## Result Contract

Each dispatch packet includes a valid result template. The provider must keep
these values unchanged:

- `run_id`
- `packet_id`
- `packet_digest`
- `provider_id`
- `journey_identity`
- `participant`
- `baseline_lineage_digest` when the packet carries lineage
- `artifact_digests`
- the assigned capability set

Every visual packet also includes the exact `visual_intent_contract` and
`visual_signature_contract`. An independent strength-4 reviewer must check
character, energy, depth, editorial boundary, palette, typography, density,
shape, elevation, imagery, motion, and forbidden transformations. A clean
scanner result does not satisfy that packet.

The reviewer supplies a stable actor identity, verdict, findings, evidence,
and timestamps. Finalization reconstructs every normalized result from its
unchanged source file and revalidates reviewer/provider independence; a
coordinated ledger rewrite cannot turn the creator into an independent critic.
A stage that needs multiple fallback providers passes only when the union of
recorded results covers the stage contract.

Browser evidence items declare which capabilities, viewports, checks, and
scenarios they cover. The example profile requires mobile and desktop evidence
plus keyboard, state, overflow, contrast, 200 percent zoom, visual-regression,
and screen-reader checks. Each required viewport needs its own screenshot, and
a non-screenshot report must cover every required check. For a scoped UI run,
each reviewed required scenario also needs non-screenshot proof and a
screenshot at every required viewport.

A runtime redesign audit additionally carries a digest-bound
`baseline_observation` from a finalized pre-change runtime audit. Only the
official Playwright child transport can supply that observation provenance;
manual or custom browser evidence remains valid only at its declared scope.

## Finding Disposition

Valid dispositions are:

- `open`: not decided; blocks finalization.
- `fixed`: resolved in the reviewed artifact; requires evidence.
- `false-positive`: the detector does not apply; requires rationale.
- `informational`: useful but not a defect; requires rationale.
- `accepted-risk`: bounded non-hard debt accepted for owner review.
- `deferred`: unresolved work; blocks finalization.

Truth, privacy, authority, required-state, keyboard, contrast, clipping, dead
control, fake-runtime, visual-intent or visual-signature violation, brand-token
substitution, unapproved style normalization, and unapproved editorial
treatment findings are hard blockers. They cannot be cleared as accepted risk.

## Integrity Boundary

The run stores SHA-256 snapshots of artifacts, route plans, visual-intent and
visual-signature authority and evidence, critic result files, screenshots, test reports, triage
files, and owner approval. Any change after recording blocks the receipt.

When a planning bridge is enforced, `audit init` also re-hashes its external
receipt and required evidence. A changed planning receipt cannot silently
upgrade an already planned route; the caller must generate a new plan.

Symlink artifacts are rejected because hashing only a link path would not bind
the receipt to changing target content. Pass the resolved file or directory.
Child evidence must be newly created inside its granted physical output
directory. KillSlopRouter verifies the directory's real path and filesystem
identity before and after execution, rejects every symlink component,
hard-linked regular file, and special file, and rechecks physical containment
before ingestion. Lexical `../` containment alone is never accepted.

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
