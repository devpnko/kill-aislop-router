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

Version `0.3.0` includes two separate layers:

1. The route planner selects one creator and capability-complete independent
   critics. Missing, weak, partial, or self-review fallbacks block the route.
2. The audit ledger issues critic packets, records structured results, hashes
   artifacts and evidence, requires scanner triage, resolves reviewer conflict,
   and emits a deterministic final receipt.

External tools are referenced, not bundled. KillSlopRouter does not execute
arbitrary commands from a project profile or treat `routable` as `ran`.

## Try It Locally

```bash
npm test

node bin/killsloprouter.mjs plan \
  --surface consumer-product-ui \
  --task redesign \
  --direction missing \
  --changes source,copy,style,layout,interaction \
  --format json \
  --out route.json
```

Run the first read-only adapter against a file or directory:

```bash
node bin/killsloprouter.mjs scan \
  --adapter kill-ai-slop \
  --adapter-root /path/to/kill-ai-slop \
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

## Evidence-Backed Audit

Initialize a run from a successful route plan. `--scope` is mandatory so a
mockup review cannot be presented as runtime parity.

```bash
node bin/killsloprouter.mjs audit init \
  --plan route.json \
  --artifact ./src \
  --scope mockup \
  --creator-id codex:session-123 \
  --out .killsloprouter/run.json
```

Initialization writes one dispatch packet per selected provider next to the
run file. Each packet contains the exact artifact digests, assigned
capabilities, review question, evidence contract, and a result template.

Record each completed pass separately:

```bash
node bin/killsloprouter.mjs audit record \
  --run .killsloprouter/run.json \
  --result reports/hallmark.json
```

The built-in read-only scanner receipt can be recorded directly. Scanner hits
remain release-blocking candidates until every hit has an explicit triage
decision and rationale:

```bash
node bin/killsloprouter.mjs audit triage \
  --run .killsloprouter/run.json \
  --triage reports/static-triage.json
```

Finalize after all required packets are present:

```bash
node bin/killsloprouter.mjs audit finalize \
  --run .killsloprouter/run.json \
  --approval reports/owner-approval.json \
  --require-owner \
  --out reports/audit-receipt.json
```

Final statuses are `incomplete`, `blocked`, `critic_pass`,
`critic_pass_owner_review_pending`, `approved`, or `rejected`. Finalize exits
non-zero for incomplete, blocked, and rejected runs. `--require-owner` also
makes pending owner review fail CI.

The receipt detects:

- missing selected critics or capability coverage;
- creator self-review or self-approval;
- untriaged scanner candidates and unresolved hard blockers;
- reviewer conflicts without a domain-authority resolution;
- missing viewport, keyboard, state, overflow, contrast, zoom, visual-regression,
  or screen-reader evidence required by the project profile;
- changed artifacts, reports, screenshots, tests, triage, or approval files.

See `docs/audit-protocol.md` and the JSON schemas in `schemas/`.

## Capability Fallbacks

Fallbacks are selected by review capability, minimum strength, and reviewer
independence rather than by tool name alone. A single replacement may cover a
stage, or several replacements may combine their capabilities. The router
accepts the substitution only when the union covers the entire stage contract.

```json
{
  "fallback_adapters": {
    "anti-slop": [
      {
        "id": "workflow-state-critic",
        "kind": "agent",
        "status": "routable",
        "executor": "fresh-agent-review",
        "strength": 3,
        "capabilities": ["task-fit", "state-completeness", "responsive-review"],
        "independent_from_creator": true
      },
      {
        "id": "accessibility-interaction-critic",
        "kind": "browser",
        "status": "routable",
        "executor": "browser-review",
        "strength": 3,
        "capabilities": ["accessibility-review", "interaction-review"],
        "independent_from_creator": true
      }
    ]
  }
}
```

`routable` means the orchestrator knows how to dispatch the provider. It does
not mean the review ran. Final receipts still need separate execution evidence.
A provider below the minimum strength, a partial capability set, or the creator
itself cannot satisfy an independent critic stage.

## Safety

- One creator per artifact.
- The creator cannot self-approve.
- Unavailable or weak tools must be replaced by capability-complete fallbacks.
- Partial fallback coverage blocks the route instead of silently degrading it.
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

1. Host adapters for MCP and agent runners with explicit permission scopes.
2. Cryptographically signed owner approvals and audit receipts.
3. Human-readable HTML coverage reports built from the JSON receipt.

See `docs/capability-matrix.md` for overlap decisions and
`docs/adapter-contract.md` for integration requirements.
