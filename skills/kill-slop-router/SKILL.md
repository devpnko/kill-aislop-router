---
name: kill-slop-router
description: Bootstrap and run project-aware, fail-closed anti-AI-slop audits with independent reviewers, browser evidence, resumable receipts, and owner approval. Use when the user says KillSlopRouter, killsloprouter, anti-slop routing, AI slop audit or removal, asks to apply the process to a new repository, or wants evidence-backed creator, critic, browser, privacy, domain, and approval gates.
---

# KillSlopRouter

Use the plugin's bundled `bin/killsloprouter.mjs` CLI as the deterministic route
authority. Resolve the plugin root two directories above this skill directory.
Do not substitute an ad-hoc prompt workflow for the CLI ledger.

## Start in a project

1. Locate the project root and read its product, design, locale, privacy, and authority contracts.
2. If `.killsloprouter/profile.json` is absent, determine a stable project ID and explicit locale. Ask only when either cannot be established from the repository.
3. Run:

   ```text
   node <plugin-root>/bin/killsloprouter.mjs bootstrap \
     --root <project-root> --project-id <id> --locale <locale> --json
   ```

4. Treat the generated host manifest as manual-only. Bind real project contracts in the profile. Replace a manual adapter only when its entrypoint, digest, permissions, strength, and complete capabilities are known.
5. Run `doctor`, then an integrated `run --dry-run`. Do not edit the artifact while the route is blocked.
6. Start `run` with state below the project's `.killsloprouter/` directory. Use the actual creator provider and session actor ID.
7. Resume the same state until it is complete or an exact external action is required.

Use the command forms in `<plugin-root>/docs/automation-run.md`. Never overwrite an
existing bootstrap configuration; inspect and migrate it deliberately.

## Rules

- Select one creator per artifact.
- Run overlapping tools as separate critics with different questions.
- Replace unavailable or weak tools only with capability-complete fallbacks of
  equal or greater minimum strength.
- Combine multiple fallback providers when necessary; block the stage if their
  capability union is incomplete.
- Never let the creator self-approve.
- Treat scanner hits as candidates, not verdicts.
- Let hard product, truth, accessibility, privacy, and authority failures block approval.
- Require browser evidence for visual and interaction approval.
- Apply project locale and domain review after English-first tools.
- Report missing adapters as `manual_pending` or blocked according to the CLI state. Never pretend a tool ran.
- Treat service planning as an external authority. Read its gate receipt; do
  not recreate PRD, UAC, IA, ERD, or owner approval inside this router.
- Run `systemize` only after G6T and exact G7 approval evidence pass.

## Run contract

1. Classify surface, task, direction, changed dimensions, scope, and risk from evidence.
2. Verify any external planning receipt and its exact evidence digests.
3. Require every stage to be `ready_primary` or `ready_with_fallback` before execution.
4. Execute only adapters accepted by the explicit host manifest.
5. On `manual_pending`, use the emitted packet and a genuinely separate reviewer. If this session created the artifact, it must not author or approve that review result.
6. Ingest manual results with `run --resume ... --result`; they remain `manual_recorded`, never `ran`.
7. Classify every scanner candidate before adjudication. Resolve referenced critic conflicts without score averaging.
8. Require browser screenshots plus non-screenshot check evidence when the packet requests them.
9. Ask the real owner for the generated approval scope. Never manufacture approval.
10. Report final status, state digest, receipt digest, blockers, pending work, and the exact files used.

Exit `6` means the pipeline is correctly waiting for manual input. Exit `5` means a
hard blocker, tamper, rejection, or execution failure. Neither is success.

For a configured V1 host, `killsloprouter run` performs steps 3 through 10 as a
resumable fail-closed state machine. Pass the executable authority separately
with `--host-config`; never place commands in the project profile. A missing or
partial host adapter must remain `manual_pending`.

For a design-system extraction, route `--task systemize`. Preserve the approved
artifact's semantics, distinguish shared primitives from surface-specific
patterns, and produce tokens, component contracts, states, responsive profiles,
migration mappings, and drift controls. The extracted system is a candidate
until its own audit and owner approval complete.

Do not load every design skill into one generation prompt. KillSlopRouter is an
orchestrator, not a generator, linter, browser, or local design authority.
