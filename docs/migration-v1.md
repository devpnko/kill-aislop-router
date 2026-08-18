# Migrating from 0.4 to 1.0

V1 keeps the existing route and audit contracts and adds an execution layer.

## Preserved contracts

- `plan`, `scan`, `doctor`, and every `audit` subcommand remain available.
- Route receipt version 1 remains accepted by `audit init`.
- Audit run, audit result, triage, owner approval, and final audit receipt all remain version 1.
- Package exports for `.`, `./audit`, `./integrity`, and `./planning` remain unchanged.
- Existing audit final statuses and their meanings remain unchanged.

`doctor` now reports `automation-ready` instead of `core-ready`, and validates
the runtime profile boundary before reporting it.

Dispatch packets add `minimum_strength`. Consumers that allow additive fields
need no change. Consumers that reject unknown fields should permit this field.

## New contracts

- `killsloprouter run`
- automation run version 1
- automation phase receipt version 1
- host adapter manifest version 1
- host adapter response version 1
- bootstrap receipt version 1 and `killsloprouter bootstrap`
- package exports `./automation`, `./bootstrap`, and `./execution`

`bootstrap` is additive and refuses to replace an existing project profile,
host manifest, or bootstrap receipt. It starts with manual-only adapters and an
unapproved design-system state; it does not upgrade legacy authority claims.

## Required changes

### Node version

V1 supports Node.js 20 and 22. Upgrade environments that still run Node 18.

### Move executable configuration out of profiles

Project profiles are not execution manifests. V1 rejects `command`, `cmd`,
`args`, `shell`, `entrypoint`, and `executable` inside adapter declarations.
Those fields were already outside the profile JSON schema, but earlier code did
not reject every unknown field at runtime.

Create a separate host manifest and pass it explicitly:

```bash
killsloprouter run ... --host-config .killsloprouter/host-adapters.json
```

Keep profile `executor` and `target` values only as routing metadata. The V1
host never executes them.

### Handle `manual_pending`

A planned or `routable` provider is not assumed to have run. Automation clients
must handle exit code 6 and inspect the `pending` list. Add an allowlisted host
adapter or complete the dispatch result template, then resume the same state
with `--result FILE`.

### Owner approval in integrated runs

Standalone `audit finalize` keeps its prior `--require-owner` behavior for
compatibility. Integrated `run` is stricter: if the route includes approval,
the automation run is not complete until an exact owner approval is supplied.

## Recommended rollout

1. Run the existing tests on Node 20 or 22.
2. Run `killsloprouter run --dry-run` with the current profile and artifacts.
3. Create manual host declarations for every selected provider.
4. Replace one manual declaration at a time with a digest-locked adapter.
5. Exercise scanner findings, browser evidence failure, conflict, retry, and owner approval in CI.
6. Switch the release job from standalone commands to the resumable state file.
