---
name: kill-slop-router
description: Bootstrap, continue, and run the safest eligible stage of a project-aware, fail-closed anti-AI-slop journey with independent reviewers, browser evidence, resumable receipts, owner approval, and gated design-system extraction. Use when the user says KillSlopRouter, killsloprouter, "킬슬롭", "이 프로젝트 정리해", anti-slop routing, AI slop audit or removal, asks to apply the process to a new repository, or wants evidence-backed creator, critic, browser, privacy, domain, and approval gates.
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
5. For a UI artifact, use the official Playwright adapter only when the project's reviewed server URL is already running or the user explicitly starts it. Run `browser attest` for the exact artifacts and make the project serve that JSON at `/.well-known/killsloprouter-artifact.json`, then run `browser configure`. Never infer or execute a dev-server command.
6. Run `doctor`, then an integrated `run --dry-run`. Do not edit the artifact while the route is blocked.
7. Start `run` with state below the project's `.killsloprouter/` directory. Use the actual creator provider and session actor ID.
8. Resume the same state until it is complete or an exact external action is required.

Use the command forms in `<plugin-root>/docs/automation-run.md`. Never overwrite an
existing bootstrap configuration; inspect and migrate it deliberately.

## Default journey

When the user gives only a short request such as `KillSlopRouter로 ./src 전체 여정
진행해`, treat it as `continue`: inspect the repository and advance the safest
currently eligible stage without asking the user to restate CLI flags.

1. Reuse a matching active automation state below `.killsloprouter/`; resume it
   instead of starting a duplicate run. Ask only when multiple active states make
   the intended artifact ambiguous.
2. Read external planning evidence. If product intent, artifact scope, or the
   required planning receipt is absent, stop with the exact missing evidence. Do
   not synthesize PRD, UAC, IA, data authority, or owner decisions.
3. For a requested improvement, plan before changes and hand the exact artifact
   to the single selected creator. If that creator is unavailable through an
   authorized integration, emit the handoff and remain `manual_pending`.
4. Audit the changed artifact with separate critics, scanner triage, conflict
   adjudication, locale/domain/privacy checks, browser evidence, and owner scope.
5. Continue to `systemize` only when the planning bridge verifies G6T and exact
   G7 approval for the unchanged artifact. Audit the extracted candidate design
   system independently; never promote it merely because extraction completed.

Infer project ID, locale, surface, changed dimensions, and artifact paths from
repository evidence when unambiguous. Report the inferred values before execution.
Never infer an owner decision, adapter permission, reviewer identity, or evidence.

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
- Treat missing Playwright baselines as an approval stop: review candidate screenshots, copy only owner-approved pixels, rerun `browser configure` to lock the baseline digest, then retry `browser-evidence`.
- Do not describe ARIA snapshots or axe output as a real screen-reader session. Require separate assistive-technology evidence when project risk demands it.
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
