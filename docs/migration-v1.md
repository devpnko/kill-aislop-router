# Migrating from 0.4 to 1.0

V1 keeps the existing route and audit contracts and adds an execution layer.

## Preserved contracts

- `plan`, `scan`, `doctor`, and every `audit` subcommand remain available.
- Route receipt version 1 remains accepted by `audit init`.
- Audit run, audit result, triage, owner approval, and final audit receipt all remain version 1.
- Package exports for `.`, `./audit`, `./integrity`, and `./planning` remain unchanged.
- Existing audit final statuses and their meanings remain unchanged.

`doctor` reports `automation-ready` instead of `core-ready` only when the
runtime profile boundary and every visual-intent and visual-signature authority
are verified. It
reports `configuration_required` with exit code 5 for a fresh unresolved
bootstrap profile.

Dispatch packets add `minimum_strength`, `visual_intent_contract`, and
`visual_signature_contract`. Consumers that allow additive fields need no
change. Consumers that reject unknown fields should permit all three fields.

## New contracts

- `killsloprouter run`
- automation run version 1
- automation phase receipt version 1
- host adapter manifest version 1
- host adapter response version 1
- bootstrap receipt version 1 and `killsloprouter bootstrap`
- package exports `./automation`, `./bootstrap`, and `./execution`
- package export `./playwright`, official Playwright adapter contract version 1,
  browser attestation version 1, scenario version 1, and setup receipt version 1
- package export `./design`, `killsloprouter design` commands, design brief and
  result version 1, resumable design exploration run version 1, shortlist
  version 1, and owner design decision version 1
- package export `./codex`, `killsloprouter host configure-codex`, official
  Codex review contract version 1, structured review output schema, and Codex
  host setup receipt version 1

The host adapter response version remains `1`. It now accepts an additive,
mutually exclusive `{ execution_status: "manual_pending", reason }` envelope
for the official Codex bridge. Existing `{ result }` responses are unchanged.
Consumers with a local strict copy of the schema should update it; consumers
that only emit existing result envelopes require no change.

The official Codex bridge is opt-in and does not migrate manual declarations
automatically. Configuration requires explicit external-network authority and
backs up the host manifest. It never changes scanner, browser, design creator,
or owner providers. See [Official Codex review host](codex-review-host.md).

### Route antislop only through the skill child

`anti-slop` is now a Router-scoped, skill-only provider. Existing host manifest
version 1 files remain readable, but an `agent-json-v1` declaration for that
provider is no longer executable and resolves to `manual_pending`. Bind the
reviewed antislop root through the existing command instead:

```bash
killsloprouter host configure-codex \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --runtime /absolute/codex/runtime \
  --runtime-root /absolute/codex/runtime-root \
  --model gpt-5.4 \
  --skill-provider anti-slop=/absolute/.killsloprouter/providers/anti-slop \
  --allow-external \
  --json
```

The provider may satisfy only `functional-human-review`. Its child prompt
selects AFTER/audit mode and suppresses standalone installation, usage-mode,
creation, and fix behavior. Direct antislop output can still be ingested using
the existing manual-result contract, but it remains `manual_recorded` and is
not execution evidence. Receipt and host manifest versions do not change.

`bootstrap` is additive and refuses to replace an existing project profile,
host manifest, or bootstrap receipt. It starts with manual-only adapters and an
unapproved design-system state; it does not upgrade legacy authority claims.

Bootstrap now requests `mobile`, `tablet`, and `desktop` evidence and names
Playwright as the preferred browser. Existing profiles and generic
`browser-json-v1` adapters remain valid; no existing browser adapter is silently
replaced. Run `killsloprouter browser configure` to opt into the official
digest-locked adapter. It creates backups of the profile and host manifest.

Bootstrap now writes `evidence.required_scenarios: []` as an explicit unresolved
critical-state inventory. Existing profiles without the field remain readable,
but any scoped UI route that requires browser evidence blocks until the
inventory is non-empty. Add reviewed IDs to the profile or pass
`browser configure --required-scenarios ID,ID`. Each selected scenario must be
present in the digest-locked scenario file and have at least one state
assertion.

Official `browser configure` also adds `evidence.scenario_digest` and
`evidence.browser_contract_digest`. The latter binds the scenario bytes,
viewport dimensions, allowed origins, browser channel, locale, runtime, color
schemes, and interaction limits. An older manually authored profile that routes
the official Playwright target must be reconfigured before it can execute; a
generic browser route remains governed by its existing contract.

Audit-result evidence items add the optional `scenarios` array. Existing
non-browser results are unchanged. Browser results for profiles with a required
inventory must add scenario coverage to their non-screenshot report and to
every scenario × required viewport screenshot. The Playwright setup receipt
adds `browser.required_scenarios` and `browser.verification_contract_digest`;
consumers that strictly copy the version-1 schema must allow these additive
fields. They remain optional in the version-1 compatibility schema, while new
setup receipts always emit them.

Bootstrap also writes one conservative, unresolved `visual_intents` entry and
one unresolved `visual_signatures` entry per surface. The intent preserves
existing character and energy and forbids editorial treatment. The signature
contains no guessed palette or style values and keeps `preserve` sentinels
until authority evidence resolves it. This prevents bootstrap itself from
selecting a generic house style.

New bootstrap receipts add `visual_signature_resolved: false` and
`style_defaults_allowed: false` to `safety`. They are additive: the version-1
schema still accepts earlier receipts that do not contain those two fields.

The official adapter adds a served-artifact attestation gate and an approved
pixel baseline. A missing baseline is a deliberate first-run block. This is an
additive strengthening of browser evidence, not a receipt-version break.

### Existing runtime redesign requires pre-change observation

A new runtime `task redesign` run requires `--observation-run` pointing to a
finalized pre-change runtime `task audit` state with the exact same routed
profile digest, artifact paths, and required scenario inventory. The profile
digest locks the project, surface, visual authorities, and official browser
route across the pair. The baseline audit must have completed execution,
result ingestion, scanner triage, and conflict adjudication, and its browser
packet must have run through the bundled official Playwright child transport.
A blocking defect receipt is eligible; an incomplete/manual browser packet is
not.

Automation run version 1 adds the optional `baseline_observation` object,
including its routed `profile_digest`, and the request adds
`observation_run_path`. Mockup redesign and non-redesign tasks remain
unchanged. Resume re-hashes the complete observation state and receipt chain.
This is a fail-closed behavioral strengthening for runtime redesign, not a
receipt-version bump.

`plan --dry-run` is now rejected with exit code `2`; it never inspected a host
or executed an adapter. Use integrated `run --dry-run`. `doctor` retains its
compatibility status values but reports `completion_eligible: false` and
execution readiness as not evaluated, and rejects `--host-config` rather than
silently ignoring it.

The `overflow` check now includes unintended direct flex/grid child overlap and
required-text clipping. Existing scenario version 1 files remain valid and may
add `no-overlap`, `no-clipping`, and `computed-style` assertions; existing
`count` assertions can bind repetition limits. Projects with intentional
overlays or truncation should add the documented reviewable data marker before
upgrading. A newly blocked artifact indicates a previously unmeasured layout
failure, not a receipt-format incompatibility.

### Missing direction no longer selects a generic taste creator

The prior `consumer-product-ui` and `marketing-editorial` route cases selected
`taste-skill` when `direction: missing`. V1 now leaves the creator unresolved
and reports that approved direction authority or `killsloprouter design run` is
required. This is an intentional fail-closed behavior change: generic taste is
not project authority, and repeatedly selecting it caused unrelated products
to converge on one familiar aesthetic.

Clients that intentionally depended on the old fallback must either provide a
verified visual-intent and visual-signature contract and route with
`direction: approved`, use a digest-bound approved reference, or complete the
owner-gated design exploration. Existing route and audit receipt versions do
not change.

## Required changes

### Bind project surfaces before routing

Every project profile now requires a fail-closed `surface_contract`. This is a
profile security migration: route, audit, and approval receipt version numbers
remain unchanged, but a legacy profile without this contract is rejected.

For a single ERP, admin, or staff product, add:

```json
{
  "surface_contract": {
    "surface_contract_version": 1,
    "primary": "operator-product-ui",
    "allowed": ["operator-product-ui"],
    "artifact_bindings": [
      { "root": ".", "surface": "operator-product-ui" }
    ]
  }
}
```

New bootstrap calls must also pass the explicit surface:

```bash
killsloprouter bootstrap \
  --root . \
  --project-id my-erp \
  --locale ko-KR \
  --surface operator-product-ui \
  --json
```

For a multi-product repository, bind each product root. A `.` operator binding
may be the fallback while a more-specific `apps/customer` binding selects
`consumer-product-ui`. The router uses the most-specific matching root, rejects
unbound or symlinked paths, and refuses one run containing artifacts from more
than one surface. `--surface` is now only an optional consistency assertion; it
cannot override the artifact contract. Start a new run after an intentional
contract change because resume verifies the original profile digest.

### Bind visual intent separately from the surface

Existing `profile_version: 1` files remain structurally readable when
`visual_intents` is absent so copy-only and PR-hygiene integrations do not
break. However, `build`, `redesign`, `systemize`, `runtime-handoff`, and `audit`
now fail closed until the resolved surface has an approved contract and
verified authority receipt.

Add one entry for every allowed surface. Do not infer an editorial visual style
from `marketing-editorial`; the surface is semantic only. For a product-native
operator interface:

```json
{
  "visual_intents": {
    "operator-product-ui": {
      "visual_intent_version": 1,
      "status": "approved",
      "mode": "product-native",
      "editorial_treatment": "forbidden",
      "editorial_scope": [],
      "energy": "balanced",
      "depth": "layered",
      "preserve": ["task density", "brand contrast", "visual energy"],
      "avoid": ["paper-like neutralization", "universal flatness"],
      "authority_receipt": "planning/visual-intent.json",
      "authority_digest": "sha256:replace-with-exact-digest"
    }
  }
}
```

The authority receipt repeats the exact intent and binds its product, brand,
reference, or owner evidence. See
`visual-intent-contract.md` and
`../schemas/visual-intent-receipt.schema.json`.

Visual routes add a required independent `visual-intent-review` stage at
strength 4. Add that provider to routing declarations and host manifests with
the complete capability set documented in `capability-matrix.md`. Until then,
the stage remains `manual_pending`; it is never treated as executed.

### Bind the concrete visual signature

Existing `profile_version: 1` files also remain structurally readable when
`visual_signatures` is absent. Copy-only and PR-hygiene routes remain
compatible, while `build`, `redesign`, `systemize`, `runtime-handoff`, and
`audit` fail closed until the routed surface has a verified signature.

Add one signature entry per allowed surface and bind a separate
[visual-signature receipt](../schemas/visual-signature-receipt.schema.json). The receipt must repeat the
exact palette roles and tokens, typography, density, shape, elevation, imagery,
motion, style keywords, and forbidden transformations. Its `coverage` must map
all nine aspects to declared digest-locked evidence. Do not infer the UI primary
from a logo, source frequency, or a different product surface.

The existing strength-4 `visual-intent-review` provider now requires these
additional capabilities:

```text
palette-fidelity, typography-fidelity, density-fidelity, shape-fidelity,
elevation-fidelity, imagery-fidelity, motion-fidelity,
transformation-boundary
```

Host adapters declaring only the earlier intent capabilities become
`manual_pending` because their capability union is incomplete. This is an
intentional fail-closed strengthening, not evidence that the adapter ran. See
[Visual signature contract](visual-signature-contract.md).

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

This applies to integrated `run --dry-run` as well: its version-1 JSON status
remains `dry_run`, but any non-executable planned adapter makes the process exit
`6`. A fully ready dry-run exits `0`, and a blocked dry-run exits `5`.

### Owner approval in integrated runs

Standalone `audit finalize` keeps its prior `--require-owner` behavior for
compatibility. Integrated `run` is stricter: if the route includes approval,
the automation run is not complete until an exact owner approval is supplied.

## Recommended rollout

1. Run the existing tests on Node 20 or 22.
2. Add and review the surface, visual-intent, and visual-signature contracts, then run
   `killsloprouter run --dry-run` with the current profile and artifacts.
3. Create manual host declarations for every selected provider.
4. Replace one manual declaration at a time with a digest-locked adapter.
5. Exercise scanner findings, browser evidence failure, conflict, retry, and owner approval in CI.
6. Switch the release job from standalone commands to the resumable state file.
