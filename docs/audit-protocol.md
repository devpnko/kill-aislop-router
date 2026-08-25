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
8. `audit finalize` re-hashes every source and emits the final receipt.
9. The owner approves or rejects the exact `approval_scope_digest`; approval is
   never inferred from critic success.

The integrated `run` command persists this lifecycle as nine separately hashed
phase receipts. It executes non-adjudication critics first, stops for scanner
triage, then executes adjudication and finalization. See `automation-run.md`.

## Result Contract

Each dispatch packet includes a valid result template. The provider must keep
these values unchanged:

- `packet_id`
- `provider_id`
- `artifact_digests`
- the assigned capability set

Every visual packet also includes the exact `visual_intent_contract` and
`visual_signature_contract`. An independent strength-4 reviewer must check
character, energy, depth, editorial boundary, palette, typography, density,
shape, elevation, imagery, motion, and forbidden transformations. A clean
scanner result does not satisfy that packet.

The reviewer supplies a stable actor identity, verdict, findings, evidence,
and timestamps. A stage that needs multiple fallback providers passes only
when the union of recorded results covers the stage contract.

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
