# Changelog

## Unreleased

- Added an atomic exclusive lease per automation state across start, resume,
  identity migration, and child execution so a concurrent caller fails before
  spawning a second reviewer or overwriting the ledger.
- Added two-phase current/pending state-digest binding, sealed in-flight child
  intents, explicit token + timestamp + state-digest stale recovery, recovery
  receipts, PID-plus-process-start liveness, and `abandoned_after_crash` retry
  gating. PID state alone never clears or permanently blocks a lease, legacy
  recovery receipts are verified before identity migration, and unresolved
  `state-write`/pending transitions cannot use the normal release path.
- Added a digest-bound KillSlopRouter `journey_identity` across automation and
  design state, audit manifests, packets, step/final receipts, owner decisions,
  and child requests; child providers now retain provenance as internal roles.
- Made resume fail closed on parent identity conflicts and packet identity
  tamper, including when one state layer is independently re-signed.
- Added explicit verified migration for evidence-free legacy states plus
  installer/doctor duplicate-entry detection and a backup-bound,
  implicit-disabled compatibility shim. Standalone `$antislop` remains
  explicitly compatible outside an active Router journey.
- Added presentation regressions for Korean correction, context-compacted
  resume, permitted internal-critic wording, child-name leakage, duplicate
  catalog entries, and standalone antislop invocation.

- Kept Codex review uniqueness checks fail-closed at the adapter boundary while
  removing unsupported structured-output schema keywords, and made
  non-adjudication packets require an explicit empty `resolutions` array in both
  the prompt contract and a packet-scoped structured-output schema.
- Made KillSlopRouter the single top-level workflow for routed audits and
  constrained `anti-slop` to the digest-locked `functional-human-review`
  `skill-json-v1` child, with standalone/agent bindings left `manual_pending`.
- Added explicit-only Codex metadata guidance for standalone antislop so it
  does not start a duplicate parent workflow while remaining available through
  `$antislop` and the Router's locked child binding.
- Added an existing-UI closed loop that binds runtime redesign to a finalized
  pre-change audit executed by the official Playwright child adapter.
- Added explicit critical scenario inventories, scenario × viewport screenshot
  enforcement, non-screenshot scenario proof, and digest-bound observation
  provenance across plan, audit, automation state, and resume.
- Bound official scenario bytes, viewport dimensions, allowed origins, browser
  channel, locale, runtime, color schemes, and interaction limits into a
  profile verification digest so an apparently identical post-change scenario
  cannot be weakened.
- Made `browser configure --required-scenarios` populate the reviewed profile
  inventory, rejected misleading `plan --dry-run` and `doctor --host-config`
  usage, and made doctor state that execution readiness was not evaluated.
- Added an opt-in first-party Codex audit-review host with a reviewed CLI
  configurator, fresh ephemeral agent/skill sessions, fixed read-only runtime
  arguments, structured output, and digest locks for the adapter, output
  schema, executable, complete runtime root, and skill roots.
- Kept missing runtime, skill, or authentication as `manual_pending`, while
  treating changed locked bytes, forbidden runtime capabilities, invalid JSONL,
  timeout, and output overflow as blockers.
- Preserved dedicated scanner, Playwright, design exploration, locale/domain/
  privacy routing, conflict adjudication, and owner approval boundaries.

## 1.0.0 - 2026-08-18

- Added owner-gated design exploration with three project-specific theses ×
  three redesign depths, an owner shortlist of three, and three color
  strategies per shortlisted direction.
- Added separate Playwright evidence packets for every direction and color
  candidate, independent strength-4 comparisons, computed semantic-role
  contrast, resumable scope digests, and compiled visual intent/signature
  receipts.
- Bound self-contained candidate prototypes, structured locale/license-aware
  font reports, exact implementation token specs, and fail-closed matrix
  diversity checks.
- Removed the missing-direction fallback to a generic taste creator; visual
  work now requires verified authority or the fail-closed exploration.
- Added a validated Codex plugin manifest with the bundled KillSlopRouter skill.
- Added a safe personal-marketplace installer and cross-project invocation prompt.
- Added a packed-CLI `plugin install` entrypoint for one-command GitHub installation.
- Added a short default journey that resumes matching state and advances only eligible stages.
- Added fail-closed project bootstrap with manual-only adapters and a digest-bound receipt.
- Added required, digest-bound surface contracts that resolve artifact roots before creator selection and block ambiguous, mismatched, mixed-surface, or tampered routing.
- Added per-surface visual-intent contracts that separate product semantics from aesthetics and make editorial treatment evidence-gated instead of a default.
- Added a digest-bound visual-intent authority/evidence chain and an independent strength-4 intent-preservation review stage.
- Made unresolved intent, unapproved editorial treatment, authority tamper, and scanner-zero-as-approval fail closed without changing receipt version 1.
- Added per-surface visual-signature contracts for exact palette roles and tokens, typography, density, shape, elevation, imagery, motion, style keywords, and forbidden transformations.
- Added full per-aspect evidence coverage, signature/intent compatibility checks, child-packet propagation, and signature authority tamper detection without changing existing receipt versions.
- Added the resumable `run` lifecycle with per-phase receipts and hashes.
- Added allowlisted, digest-locked host adapters for scanners, agents, skills, and browser evidence.
- Added explicit `manual_pending`, retry, dry-run, JSON, and state output behavior.
- Fixed integrated dry-run exit semantics so any non-executable planned adapter
  returns `6` while preserving the version-1 `dry_run` JSON status.
- Added clean-consumer tarball installation checks and child timeout, malformed
  JSON, oversized output, evidence escape, state tamper, and crash-resume E2E.
- Added distinct ERP/operator, B2C/consumer, and ko-KR high-risk dogfood routes
  to prevent cross-surface palette, density, typography, and privacy collapse.
- Preserved route and audit receipt version 1 compatibility.
- Added child-process E2E coverage for success and required fail-closed gates.
- Added the official Playwright browser adapter with served-artifact attestation,
  responsive/state/keyboard/overflow/zoom/axe/ARIA/console/network evidence,
  traces, and digest-locked visual baselines.
- Added `browser attest` and `browser configure` commands, exact pinned
  `playwright-core`/`axe-core` runtimes, and real-browser resume/retry E2E coverage.
- Strengthened browser `overflow` evidence with flex/grid overlap and required-text
  clipping detection plus typed `no-overlap`, `no-clipping`, `count`, and
  `computed-style` project assertions.
- Added adapter authoring, permission, threat-model, migration, and release documentation.
- Raised the supported Node.js floor to 20 and verified Node 20/22 CI.

## 0.4.0 - 2026-08-17

- Added capability-complete fallback routing, audit evidence integrity, planning receipt verification, and owner-scoped approval.
