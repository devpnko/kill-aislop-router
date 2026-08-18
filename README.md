# KillSlopRouter

KillSlopRouter selects independent anti-slop reviewers, executes explicitly
authorized host adapters, and records the evidence needed to approve an exact
artifact version. It keeps route planning, tool execution, scanner triage,
conflict adjudication, and owner approval separate.

Version 1.0.0 is release-ready source. This repository does not publish an npm
package or create a GitHub Release as part of the V1 work.

## What V1 does

- Selects one creator per artifact and rejects creator self-review or approval.
- Preserves minimum reviewer strength and capability-union requirements.
- Executes only provider IDs allowed by an explicit host adapter manifest.
- Never executes `command`, `args`, `shell`, or an entrypoint from a project profile.
- Runs JSON agent, skill, browser, and `kill-ai-slop` adapters across a real child-process boundary.
- Leaves missing, manual, weak, or partial adapters as `manual_pending`. A `routable` plan is not execution evidence.
- Requires explicit scanner triage, conflict adjudication, browser proof, and owner approval where the route requires them.
- Re-hashes plans, artifacts, results, evidence, triage, approval, step receipts, and automation state.
- Resumes interrupted runs and retries a failed packet, provider, or stage without discarding completed evidence.

## Requirements

- Node.js 20 or 22
- npm
- Project-specific adapters for any review you want the host to execute

There are no runtime package dependencies.

## Quickstart

From a clean checkout:

```bash
npm install --ignore-scripts
npm test
npm run check
npm run pack:check
```

Inspect the example route and host readiness without executing an adapter:

```bash
node bin/killsloprouter.mjs run \
  --dry-run \
  --profile examples/project-profile.example.json \
  --host-config examples/host-adapter.example.json \
  --surface operator-product-ui \
  --task redesign \
  --direction approved \
  --changes source,copy,layout,interaction \
  --artifact examples/planning-evidence/mockup.html \
  --scope mockup \
  --creator-id local-preview \
  --json
```

The example host manifest is deliberately manual. The dry run succeeds and
reports every provider as `manual_pending`; it never fabricates a completed
review. Replace those declarations with real, digest-locked adapters before an
executing run.

## Integrated run

```bash
node bin/killsloprouter.mjs run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --surface operator-product-ui \
  --task redesign \
  --direction approved \
  --changes source,copy,layout,interaction \
  --artifact ./src \
  --scope runtime \
  --creator-id codex:session-123 \
  --out .killsloprouter/v1-run.json \
  --json
```

`run` connects these gates:

```text
plan -> planning receipt verification -> audit init -> dispatch
     -> adapter execution -> result ingest -> scanner triage
     -> conflict adjudication -> finalize -> owner approval
```

Every phase writes a versioned receipt with a SHA-256 digest next to the state
file. For `--out .killsloprouter/v1-run.json`, the plan, audit ledger, packets,
results, evidence, phase receipts, and final audit receipt live under
`.killsloprouter/v1-run.d/`.

If a scanner returns candidates, supply a triage file and resume:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/v1-run.json \
  --host-config .killsloprouter/host-adapters.json \
  --triage reports/static-triage.json \
  --json
```

If a provider is manual, complete its dispatch packet and ingest the resulting
`audit-result.schema.json` file before continuing:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/v1-run.json \
  --host-config .killsloprouter/host-adapters.json \
  --result reports/manual-functional-review.json \
  --json
```

`--result` is repeatable. Manual results pass through the same identity,
capability, artifact-digest, and browser-evidence checks as child results.

If an adapter failed, retry only that packet, provider, or stage:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/v1-run.json \
  --host-config .killsloprouter/host-adapters.json \
  --retry browser-evidence \
  --json
```

When critics pass, use the generated approval template as a starting point,
record a real owner decision in a separate file, then resume:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/v1-run.json \
  --host-config .killsloprouter/host-adapters.json \
  --approval reports/owner-approval.json \
  --json
```

Exit codes are stable for automation:

- `0`: complete, or a valid dry-run report
- `2`: invalid CLI or contract input
- `5`: blocked, rejected, tampered, or execution failure
- `6`: exact manual input is still pending

## Host adapter safety

The project profile describes routing availability and capabilities. It is not
an executable configuration file. Executable adapters live in a separate host
manifest that must be passed with `--host-config`.

The host manifest must:

- allowlist each provider ID;
- choose one built-in adapter type;
- declare strength, capabilities, and permission scopes;
- bind every Node entrypoint or scanner to an exact SHA-256 digest.

JSON child adapters run through the current Node executable with `shell:false`,
no profile-supplied arguments, and a reduced environment. Evidence returned by
a child must stay inside its granted output directory.

Generate an entrypoint digest with:

```bash
node bin/killsloprouter.mjs digest --target ./adapters/reviewer.mjs
```

See [Adapter authoring](docs/adapter-authoring.md) and
[Threat model and permissions](docs/threat-model-and-permissions.md).

## Project profile and route planning

Place the routing profile at `.killsloprouter/profile.json`, or pass it with
`--profile`. The CLI searches upward for the default profile. Validate it
against `schemas/project-profile.schema.json`.

Surfaces:

- `operator-product-ui`
- `consumer-product-ui`
- `marketing-editorial`

Tasks:

- `build`
- `redesign`
- `systemize`
- `runtime-handoff`
- `audit`
- `copy`
- `pr-hygiene`

Standalone `plan`, `scan`, and `audit` commands remain available for existing
integrations. The integrated `run` command uses the same route and audit receipt
contracts instead of replacing them.

## Hard gates

- A creator cannot review or approve its own artifact.
- Fallbacks must meet minimum strength and cover the complete capability union.
- Scanner findings are candidates until individually classified.
- Reviewer conflicts require a recorded adjudication; scores are not averaged.
- Required locale, domain, privacy, browser, and owner stages cannot be skipped.
- Browser packets need viewport screenshots and non-screenshot proof for every required check.
- Owner approval is bound to the exact run and approval-scope digest.
- Changed artifacts or evidence block finalization.

Service planning stays external. `systemize` still requires verified G6T and
exact G7 evidence. See [Service planning bridge](docs/service-planning-bridge.md)
and [Systemization protocol](docs/systemization-protocol.md).

## Compatibility

Route receipt version 1, audit run version 1, audit result version 1, triage
version 1, and audit receipt version 1 remain supported. V1 adds automation run
version 1 and host adapter version 1. See [V1 migration notes](docs/migration-v1.md).

## Documentation

- [Automation lifecycle](docs/automation-run.md)
- [Adapter authoring](docs/adapter-authoring.md)
- [Audit protocol](docs/audit-protocol.md)
- [Capability matrix](docs/capability-matrix.md)
- [Threat model and permissions](docs/threat-model-and-permissions.md)
- [V1 migration notes](docs/migration-v1.md)
- [Release checklist](docs/release-checklist.md)

External tools are referenced, not bundled. Their reviewed revisions and
licenses are recorded in `registry/tool-lock.json` and `THIRD_PARTY.md`.
