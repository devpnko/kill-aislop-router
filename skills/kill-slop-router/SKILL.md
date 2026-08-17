---
name: kill-slop-router
description: Route UI, frontend, copy, and pull-request artifacts through a project-aware anti-AI-slop pipeline. Use when the user says KillSlopRouter, killsloprouter, anti-slop routing, AI slop audit or removal, asks how to combine Taste Skill, Hallmark, anti-slop, kill-ai-slop, no-ai-slop, or wants evidence-backed creator, critic, browser, and approval gates.
---

# KillSlopRouter

Use the `killsloprouter` CLI as the deterministic route authority.

## Rules

- Select one creator per artifact.
- Run overlapping tools as separate critics with different questions.
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
4. Use `killsloprouter scan` for supported read-only adapters.
5. Execute remaining receipt stages separately and preserve raw findings.
6. Resolve conflicts against project semantics and browser evidence.
7. Return the route, exact tool versions, findings, evidence, blockers, and approval owner.

Do not load every design skill into one generation prompt. KillSlopRouter is an
orchestrator, not a generator, linter, browser, or local design authority.
