---
name: kill-slop-router
description: Route UI, frontend, copy, and pull-request artifacts through a project-aware anti-AI-slop pipeline. Use when the user says KillSlopRouter, killsloprouter, anti-slop routing, AI slop audit or removal, asks how to combine Taste Skill, Hallmark, anti-slop, kill-ai-slop, no-ai-slop, or wants evidence-backed creator, critic, browser, and approval gates.
---

# KillSlopRouter

Use the `killsloprouter` CLI as the deterministic route authority.

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
- Report missing adapters as blocked. Never pretend a tool ran.

## Workflow

1. Read `.killsloprouter/profile.json` and the local product and design contracts.
2. Classify surface, task, direction, changes, and risk.
3. Run `killsloprouter plan` before editing.
4. Confirm every required stage is `ready_primary` or `ready_with_fallback`.
5. Start `killsloprouter audit init` with an explicit artifact scope and creator identity.
6. Dispatch every generated packet separately; use `killsloprouter scan` for supported read-only adapters.
7. Record each result with `audit record`; never convert `routable` into completed evidence.
8. Record scanner dispositions with `audit triage` and resolve critic conflicts in the adjudication result.
9. Run `audit finalize`; report its exact status, hashes, blockers, and approval owner.

Do not load every design skill into one generation prompt. KillSlopRouter is an
orchestrator, not a generator, linter, browser, or local design authority.
