# Migrating from 0.4 to 1.0

V1 keeps the existing route and audit contracts and adds an execution layer.

## Parent identity and catalog migration

New runs bind `$killsloprouter:kill-slop-router` as the sole parent through a
digest-bound `journey_identity`. Audit/design packets retain exact provider IDs
under `participant.visibility: internal`; `anti-slop` is a critic role, not a
mode. Owner approval and host request schemas now require the same identity for
new V1 runs.

First inspect a machine that may contain the pre-plugin local router skill:

```bash
killsloprouter plugin install --dry-run
```

If it reports `identity_conflict`, use the explicit migration. Add `--force`
only when the canonical marked plugin already exists:

```bash
killsloprouter plugin install --migrate-legacy-entry
killsloprouter plugin install --force --migrate-legacy-entry
```

An installation made with the older, unbound marker is reported as
`canonical.status: refresh-required` only when its payload/runtime/skill still
exactly match the trusted package. Refresh it explicitly with
`killsloprouter plugin install --force`; the installer preserves the old plugin
directory in its backup area before replacement. Marker version 2 validates the
entire packaged payload, copied browser runtime, exact canonical skill, package
version, namespaced entrypoint, and marker digest. It removes the former
self-asserted `source`, `installed_by`, and `installed_at` claims because a
same-user local file cannot authenticate them. `{}` or a self-consistent
marker over different bytes is `unsafe-or-incomplete`, not migration authority;
move that directory aside for forensic retention and install a reviewed commit.

The installer moves the full legacy entry to a unique directory under
`~/.codex/skills/.killsloprouter-backups/`, verifies the original/backup
digest, and writes an implicit-disabled compatibility shim. It never silently
deletes the original and does not change standalone `$antislop`. `doctor`
reports a conflict if the full duplicate remains, the shim differs byte-for-byte
from the packaged explicit-only handoff, its shaped backup/digest is changed,
or its marker is not bound to the currently installed canonical marker,
payload, runtime, and skill digests. A marker-v1 shim requires an explicit
`--migrate-legacy-entry` rebind; public shim bytes plus a fabricated backup are
not enough for readiness.
The marker contracts are
`schemas/plugin-install-marker.schema.json` and
`schemas/legacy-skill-shim-marker.schema.json`.

A pre-identity automation state can be upgraded only before adapter attempts,
accepted results/triage, approval/final evidence, or observation binding:

```bash
killsloprouter run --resume .killsloprouter/legacy-run.json \
  --migrate-identity \
  --legacy-backup ../killsloprouter-authority/legacy-run.pre-migration.json \
  --authority-digest 'sha256:<SHA-256 of that backup file>' \
  --host-config .killsloprouter/host-adapters.json --json
```

Before mutation, copy the active state byte-for-byte to a regular, single-link
file outside the state directory. Pass its path as `--legacy-backup` and its
file SHA-256 as `--authority-digest`; do not reuse the embedded `state_digest`
as external authority. Keep the backup durably after migration because every
later read and resume verifies the migration receipt against it. The migration
accepts only an allowlisted historical router digest and matching captured
state/plan/audit serialization fingerprints, rejects stripped modern states and modern-only markers,
requires canonical plan and audit sources, replans through the current router,
rebinds an evidence-free legacy audit and phase receipts in a new copy-on-write
transaction, and atomically switches only the state pointer. The old
plan/audit/receipt graph is never overwritten. A fault before state commit
leaves the active legacy graph intact and retryable. The command emits both a
digest-bound migration receipt and a new modern `resume_authority_digest`;
that authority includes the external backup path/digest, retained legacy
sidecar digests, historical capture fingerprints, and transaction directory.
Every later resume requires that new value. Evidence-bearing, unsupported, or
source-less legacy runs must start over so old child output cannot be laundered
into the new identity contract. Raw standalone legacy audit files have no
automatic migration command; start a new V1 audit or migrate their containing
automation state.

Migration also preflights the complete
`<state>.d/identity-migrations/<transaction>` path before staging. Remove a
pre-existing symlink or alias and retry with the same untouched active state
and external backup; no off-tree transaction is accepted.

## Preserved contracts

- `plan`, `scan`, `doctor`, and every `audit` subcommand remain available.
- Route receipt version 1 remains accepted by `audit init`, but the exact
  persisted plan file is now mandatory at this public boundary.
- Audit run, audit result, triage, owner approval, and final audit receipt all remain version 1.
- As a fail-closed behavioral change, every standalone audit mutation now needs
  the `audit_authority_digest` emitted by `audit init`. Pass it as
  `--authority-digest` to `audit dispatch`, `audit record`, `audit triage`,
  `audit status`, and `audit finalize`; library callers must pass
  `authorityDigest` to `dispatchAuditPackets`, `recordAuditResult`,
  `recordTriage`, and `finalizeAudit`. This is an intentional safety break for
  callers that previously mutated triage without external authority.
- Package exports for `.`, `./audit`, `./integrity`, and `./planning` remain unchanged.
- Existing audit final statuses and their meanings remain unchanged.
- The automation run schema version remains 1. Evidence-free compatible states
  remain readable. New states add optional
  `in_flight`, `lease_recoveries`, `identity_migration.authority`, and
  `resume_authority_digest` fields. Result-bearing automated attempts now also
  require a persisted `evidence_boundary`, and the attempt array has an
  explicit schema instead of accepting arbitrary objects. Strict
  consumers must update their local schema before accepting those additive
  fields. Reading does not imply that a pre-authority modern state is resumable.
- Existing planning receipts remain valid without `baseline_lineage`. Projects
  that opt in must allow the additive lineage field in route plans, automation
  states, audit runs, dispatch packets, child requests, step/final receipts,
  and owner templates. The lineage digest is mandatory only for those runs.

`doctor` reports `automation-ready` instead of `core-ready` only when the
runtime profile boundary and every visual-intent and visual-signature authority
are verified. It
reports `configuration_required` with exit code 5 for a fresh unresolved
bootstrap profile.

Dispatch packets add `minimum_strength`, `visual_intent_contract`, and
`visual_signature_contract`. Consumers that allow additive fields need no
change. Consumers that reject unknown fields should permit all three fields.
New packets additionally require `journey_identity` and `participant`, and
their packet digest covers both. New owner approvals and child requests require
the same identity. This is a deliberate fail-closed compatibility change;
strict producers must use the current schemas or the verified migration above.
Audit results now also require the exact `run_id`, `packet_digest`,
`journey_identity`, and internal `participant`; lineaged results require the
same `baseline_lineage_digest`. Existing version-1 result producers must copy
those values from the dispatched request. Public `audit dispatch`, `audit
record`, `audit status`, and `audit finalize` require the caller-retained
`audit_authority_digest` emitted by `audit init`. These are deliberate
fail-closed producer and invocation changes without a receipt-version bump.

`baseline_lineage` is an opt-in fail-closed strengthening. Do not retrofit it
onto an evidence-bearing state. Start a new run from the updated planning
receipt so the parent, candidate, packets, child observations, and owner scope
share one digest. See [Parent baseline and slice lineage](baseline-lineage.md).
External planning receipts validate against the declaration schema; copied
route/state/audit/packet/child/receipt values validate against the bound runtime
schema and must include `lineage_digest`. No-lineage runs omit lineage-only
fields. Independent V1 security hardening still adds `router_digest`,
`resume_authority_digest`, participant identity, leases, and mandatory plan
sources; consumers must treat those documented additions separately from
lineage opt-in.

The resume authority also carries the canonical parent-owned path contract.
For a normal run that is the fixed sibling `.d/` tree. For a verified legacy
migration, the rebound plan, audit, packets, migration receipt, and migrated
phase receipts must remain in the exact digest-bound transaction directory;
new phase receipts, results, evidence, and the final receipt remain under the
canonical `.d/` tree. Copying valid sidecar bytes elsewhere and re-signing the
mutable state does not authorize a path switch.

Owner approval, scanner triage, and manual results supplied to integrated
`run --resume` must be regular single-link files outside the active state file
and `.d/` tree. Move a not-yet-recorded input to caller-owned storage before
resume. Do not edit an already recorded state to relocate provenance; start a
new journey instead. Likewise, an identity-bound state that already accepted
automated output before physical `evidence_boundary` retention cannot be
safely upgraded from its own mutable ledger and must restart.

## Modern resume authority

Every new identity-bound integrated run first writes
`<state>.authorities/<run-id>.json`, then normally prints that receipt path and
its `resume_authority_digest`. Retain the receipt and exact original value
outside the state and its `.d/` directory, and pass the digest on every resume:

```bash
killsloprouter run --resume .killsloprouter/run.json \
  --authority-digest 'sha256:<value printed by the original start>' \
  --host-config .killsloprouter/host-adapters.json --json
```

After dispatch, a successful initialization also writes
`<state>.authorities/<run-id>.initialization.json` before the first child. Keep
that file with the start authority. It is the durable progress floor that stops
a re-signed state from deleting all internal bindings and replaying reviewers.
If it is orphaned by a real crash, only authorized stale-lease recovery may
adopt it; do not delete or regenerate it manually.

This is a deliberate fail-closed invocation change. An identity-bound
pre-release state created before the durable version-5 start authority receipt
can be inspected, but it cannot be safely resumed or locally upgraded. That
includes states with no authority field and plan-derived version-1/version-2
authority copies without the deterministic external receipt. Calculating or
backfilling a replacement from that same mutable state would not establish
external authority. Start a new journey from the verified router, profile,
planning receipt, and artifacts.

The explicit `--migrate-identity` command above is the only exception. It still
requires a byte-identical external pre-mutation backup and its caller-retained
file digest, accepts only a positively supported historical source and exact
captured state/plan/audit fingerprints, and emits a migration receipt binding
that durable backup, the retained old sidecars, the current replan, the
copy-on-write transaction, and the newly issued resume authority.
A forged modern state cannot strip its identity fields or relabel itself
`legacy-migrated` to bypass the authority requirement.

The version-5 start authority binds the original router/profile/request,
artifact digests, parent identity, complete path contract, and initial canonical
plan-authority digest before the first state exists. That digest includes the
selected planning receipt and optional parent/slice lineage. Resume requires an
exact replan match before recreating a missing `plan.json`, then treats the
deterministic plan, planning/lineage evidence, and completed final/approval
receipts as mandatory phase/audit integrity anchors. A missing, relocated,
re-signed, or contradictory anchor exits with integrity code 4 before child
execution. Pre-release modern states carrying version-3 or version-4 authority,
or lacking the separate caller-retained initialization commitment, must restart;
backfilling the missing plan authority from mutable state is not a migration.

## New contracts

- `killsloprouter run`
- automation run version 1
- automation phase receipt version 1
- automation initialization authority receipt version 1 and resume authority
  version 5
- host adapter manifest version 1
- host adapter response version 1
- bootstrap receipt version 1 and `killsloprouter bootstrap`
- package exports `./automation`, `./bootstrap`, and `./execution`
- package export `./state-lease`, atomic state lease version 1, and state lease
  recovery receipt version 3. The export is now a public facade: it omits the
  internal stale-claim and recovery-completion primitives, while high-level
  authorized recovery remains in `./automation`.
- package exports `./identity` and `./skill-catalog`
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

Concurrent mutation is now a deliberate fail-closed behavior change. A second
`start`, `resume`, or `--migrate-identity` for the same state exits `5` before
child spawn. Do not delete `<state>.lease` manually. After a real crash, use
`lease status` and `lease recover` with the exact owner token, acquisition
timestamp, and state digest; an in-flight packet then requires explicit retry.
Recovering a modern state additionally requires the original start's
caller-retained `resume_authority_digest`; the public lease tuple alone is not
mutation authority. Recovering a pre-identity state instead requires its
current external legacy backup and digest. If recovery updates that state,
capture a new backup before migration.

New runs also bind physical identity for routed router/profile/artifact sources,
the external planning receipt and gate evidence, parent/candidate lineage
artifacts, audit plan/profile/visual/artifact sources, Playwright
runtime/scenario/baseline authority, Codex runtime authority, adapter
entrypoints, and integrated owner approval. A same-byte file or directory
replacement is tamper, not a compatible update. Pre-release modern states or
strict local schema copies that omit these physical sources must restart with
the current build; do not backfill an inode claim from an already mutable path.
Verified evidence-free historical states remain limited to the explicit backup-
bound migration described below.

After upgrading a host configured by a pre-seal preview, regenerate both
runtime contracts before `doctor`, `--dry-run`, or resume:

```bash
killsloprouter host configure-codex \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --runtime /absolute/path/to/codex \
  --runtime-root /absolute/path/to/codex-runtime \
  --model <approved-model> \
  --agent-providers <approved-provider-ids> \
  --allow-external --json

killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios <reviewed-scenario-ids> \
  --channel chrome --json
```

Each command creates a backup and a new receipt. Review both before deleting
anything. It also regenerates the required `entrypoint_graph_digest` for the
official adapter. Do not hand-add physical or graph digests to the old manifest.

Custom process adapters that import local files now need a reviewed graph
authority in addition to the existing entrypoint digest:

```bash
killsloprouter digest --target ./adapters/reviewer.mjs
killsloprouter digest --target ./adapters/reviewer.mjs --module-graph
```

Copy the second digest into `entrypoint_graph_digest`. Use explicit `.mjs`,
`.js`, `.cjs`, or `.json` local specifiers. A self-contained adapter needs no
manifest change. An adapter with package imports or computed local dependency
paths cannot be migrated by asserting a digest; make its dependency boundary
explicit or keep it `manual_pending` until a reviewed private runtime seal is
available.

If a custom ESM adapter previously used `createRequire(import.meta.url)` for a
local CJS or JSON helper, replace it with a static/literal dynamic ESM import,
or convert the entrypoint to `.cjs` and retain literal local `require()` calls.
V1 rejects custom `createRequire()` rather than letting it reopen mutable source
outside the descriptor-fed module seal. This is an intentional security
compatibility break; the official Playwright adapter remains the sole
private-runtime exception.

Code that imported `claimStaleStateLease` directly must migrate to
`recoverAutomationStateLease` from `killsloprouter/automation` and supply the
documented modern resume authority or verified legacy backup. This is a
deliberate fail-closed package-surface change. Lease controllers returned by
`acquireStateLease` remain usable by their issuing process, but a controller
reconstructed from the public status tuple is rejected. A recovery failure
after exclusive claim no longer clears the lease; inspect the new recovery
lease after the failed process exits and repeat authorized recovery with that
exact tuple.

Modern recovery receipts created before version 3 cannot authorize a V1 resume;
restart that pre-release run. Version 3 records `initialization_reconciliation`
as either `null` or the prior state digest, deterministic reconciled anchor IDs
and steps, the bound initialization authority, and its non-circular graph digest.
It carries the first stale lease and recovery start time through repeated recovery
claims so an orphan receipt is reused byte-for-byte. Normal
resume does not consult recovery history to adopt orphan files. If it reports an
unbound plan, planning-verification, audit, packet, or fixed initialization
receipt, inspect the stale lease and use authorized recovery; do not delete or
reattach the files manually. Positively captured version-1 receipts inside a
verified historical legacy migration remain provenance only and do not grant
modern initialization recovery.

State, router, and profile paths that traverse a project-controlled symlink
ancestor are no longer accepted. Move the real file into the project or pass
its canonical physical path; do not replace the alias with an implicit shim.
Normal operating-system aliases are canonicalized at the trusted boundary, so
existing macOS temporary paths continue to address the same state and lease.

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
viewport dimensions, allowed origins, browser channel, locale, runtime content,
color schemes, and interaction limits. It deliberately excludes machine-local
inode/owner/timestamp identity; that value remains mandatory in the host
manifest and is checked before sealing and child spawn. An older manually
authored profile that routes the official Playwright target must be reconfigured
before it can execute; a generic browser route remains governed by its existing
contract.

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

Standalone `audit finalize` keeps its prior `--require-owner` policy switch,
but now also requires the original `audit_authority_digest`. Integrated `run`
is stricter: if the route includes approval, the automation run is not complete
until an exact owner approval is supplied.

## Recommended rollout

1. Run the existing tests on Node 20 or 22.
2. Add and review the surface, visual-intent, and visual-signature contracts, then run
   `killsloprouter run --dry-run` with the current profile and artifacts.
3. Create manual host declarations for every selected provider.
4. Replace one manual declaration at a time with a digest-locked adapter.
5. Exercise scanner findings, browser evidence failure, conflict, retry, and owner approval in CI.
6. Switch the release job from standalone commands to the resumable state file.
