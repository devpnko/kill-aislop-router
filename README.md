# KillSlopRouter

KillSlopRouter decides which anti-AI-slop tool should create, inspect, or prove
an artifact. It prevents overlapping design skills from becoming one mixed
prompt and records the selected route as a machine-readable receipt.

It is an orchestrator, not another style guide or scanner.

## Why

The available tools overlap, but they do not answer the same question:

- Taste Skill can establish a consumer or marketing visual direction.
- Hallmark can study references and inspect rendered craft.
- anti-slop can check product usefulness, mobile behavior, accessibility, and states.
- kill-ai-slop can locate source-level candidates.
- no-ai-slop and stop-slop can review visible prose at different strictness levels.
- PeakOSS anti-slop can inspect pull-request hygiene.

Running all of them as co-creators usually averages away their strengths.
KillSlopRouter selects one creator, routes independent critics, and requires
browser and project evidence before approval.

## Current Status

Version `0.1.0` provides the deterministic routing core, project profiles,
tool-version lock, Agent Skill, JSON receipts, and an allowlisted read-only
`kill-ai-slop` scanner adapter. Other external tools are not bundled or
executed automatically. A receipt reports planned or unavailable adapters
instead of pretending they ran.

## Try It Locally

```bash
npm test

node bin/killsloprouter.mjs plan \
  --surface consumer-product-ui \
  --task redesign \
  --direction missing \
  --changes source,copy,style,layout,interaction
```

Run the first read-only adapter against a file or directory:

```bash
node bin/killsloprouter.mjs scan \
  --adapter kill-ai-slop \
  --target /path/to/project-or-file \
  --format json
```

Declare the adapter `root` and exact `version` in the project profile, or pass
them explicitly with `--adapter-root` and `--version`.

Use a project profile:

```bash
node bin/killsloprouter.mjs plan \
  --profile examples/project-profile.example.json \
  --surface operator-product-ui \
  --task redesign \
  --direction approved \
  --changes source,copy,layout,interaction \
  --format json
```

When installed from npm in the future, the same commands become:

```bash
npx killsloprouter plan --surface consumer-product-ui --task audit
```

## Classification

Surfaces:

- `operator-product-ui`
- `consumer-product-ui`
- `marketing-editorial`

Tasks:

- `build`
- `redesign`
- `runtime-handoff`
- `audit`
- `copy`
- `pr-hygiene`

Directions:

- `approved`: use the approved project design system
- `missing`: choose a matching exploratory creator
- `reference`: use reference-study and system-lock work
- `none`: no creator decision is needed

## Project Profile

Place a profile at `.killsloprouter/profile.json`. The CLI searches upward from
the working directory automatically.

The profile maps generic gates such as `project-contract`,
`domain-authority-review`, and `browser-evidence` to local project contracts.
Validate its shape against `schemas/project-profile.schema.json`.

## Safety

- One creator per artifact.
- The creator cannot self-approve.
- Scanner hits are candidates, not failures.
- Hard blockers beat aesthetic scores.
- Reviewer scores are not averaged.
- Browser evidence is required for visual approval.
- Project contracts settle style conflicts.
- External repositories and AGPL actions are not bundled.
- No arbitrary adapter command is executed from a profile.

## Agent Skill

The thin Agent Skill lives at `skills/kill-slop-router/`. Install that directory
into the skill location used by Codex, Claude Code, or another compatible agent.
The CLI remains the deterministic route authority.

## Roadmap

1. Browser evidence adapter and screenshot receipt.
2. Human or agent critic adapters with exact provenance.
3. HTML report and CI check mode.
4. Signed route and audit receipts.

See `docs/capability-matrix.md` for overlap decisions and
`docs/adapter-contract.md` for integration requirements.
