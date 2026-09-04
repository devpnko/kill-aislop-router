# KillSlopRouter

KillSlopRouter selects independent anti-slop reviewers, executes explicitly
authorized host adapters, and records the evidence needed to approve an exact
artifact version. It keeps route planning, tool execution, scanner triage,
conflict adjudication, and owner approval separate.

Use `KillSlopRouter`, not standalone `antislop`, as the top-level command for a
Router audit. The Router dispatches the installed antislop rules only as the
digest-locked `anti-slop` child critic for `functional-human-review`. Direct
antislop output is not a KillSlopRouter run and cannot be reported as `ran`.
Every V1 journey carries a digest-bound `journey_identity` naming
`killsloprouter:kill-slop-router` as the parent. Provider IDs such as
`anti-slop`, creators, scanners, and browser reviewers remain visible only as
internal participant provenance; they never become the active mode.

Version 1.0.0 is release-ready source. This repository does not publish an npm
package or create a GitHub Release as part of the V1 work.

## What V1 does

- Selects one creator per artifact and rejects creator self-review or approval.
- Resolves the product surface from a digest-bound project/artifact contract before creator selection.
- Resolves a separate, evidence-bound visual-intent contract; a surface name never acts as a style preset.
- Binds the exact per-surface visual signature: palette roles and tokens, typography, density, shape, elevation, imagery, motion, style keywords, and forbidden transformations.
- Allows editorial treatment only when the visual-intent authority explicitly marks it `bounded` or `required`.
- Preserves minimum reviewer strength and capability-union requirements.
- Executes only provider IDs allowed by an explicit host adapter manifest.
- Never executes `command`, `args`, `shell`, or an entrypoint from a project profile.
- Runs JSON agent, skill, browser, and `kill-ai-slop` adapters across a real child-process boundary.
- Can opt into a first-party, digest-locked Codex reviewer host for fresh read-only agent and skill audit sessions.
- Requires `anti-slop` to use a packet-bound `skill-json-v1` child; an agent or standalone binding remains `manual_pending`.
- Leaves missing, manual, weak, or partial adapters as `manual_pending`. A `routable` plan is not execution evidence.
- Requires explicit scanner triage, conflict adjudication, browser proof, and owner approval where the route requires them.
- Treats scanner zero hits as discovery output, never as design approval.
- Re-hashes plans, artifacts, results, evidence, triage, approval, step receipts, and automation state.
- Resumes interrupted runs and retries a failed packet, provider, or stage without discarding completed evidence.
- Ships an official Playwright adapter for real responsive, interaction, accessibility-proxy, trace, and pixel-baseline evidence.
- Requires a reviewed critical-state inventory and scenario × viewport proof for scoped UI runs.
- Binds runtime redesign to a finalized pre-change audit executed by the official Playwright child adapter.
- Resolves missing direction through a resumable 3-thesis × 3-depth exploration, owner shortlist, 3-strategy color matrix, and exact owner-approved receipts.

## Requirements

- Node.js 20 or 22
- npm
- Google Chrome or Microsoft Edge for local Playwright runs, or an explicitly installed Playwright Chromium build
- Project-specific adapters, or the optional official Codex review host, for reviews you want the host to execute
- `codex-cli` 0.144.0 or newer only when using the optional official Codex host

`playwright-core` and `axe-core` are exact runtime pins. Installing the package
does not implicitly download a browser.

## Quickstart

From a clean checkout:

```bash
npm ci --ignore-scripts
npm test
npm run test:e2e
npm run check
npm run pack:check
```

The browser E2E uses the local Chrome channel by default. On a machine without
Chrome, install the pinned Chromium build explicitly and select it:

```bash
npx playwright-core install chromium
KSR_PLAYWRIGHT_CHANNEL=bundled npm run test:e2e
```

`npm test` is the bounded contract/security suite. `npm run test:e2e` owns the
isolated real child-process, Codex-host, design, and Playwright inventory;
`npm run check` adds static contracts and the example doctor verification. CI
runs all three layers on Node 20 and Node 22.

## Codex plugin

Install the local Codex plugin once, then invoke the same bundled CLI from
any project. The shortest install from the default branch is one command:

```bash
npx --yes github:devpnko/kill-aislop-router plugin install
```

For unattended installation, append an exact reviewed 40-character commit to
the package spec:

```bash
npx --yes github:devpnko/kill-aislop-router#<40-character-commit> plugin install
```

Preview installation first when this machine may already have the legacy local
`~/.codex/skills/kill-slop-router` entry:

```bash
npx --yes github:devpnko/kill-aislop-router#<40-character-commit> plugin install --dry-run
```

An `identity_conflict` is a deliberate stop. Migrate it explicitly with the
same reviewed package spec; add `--force` only when refreshing an already
marked plugin installation:

```bash
npx --yes github:devpnko/kill-aislop-router#<40-character-commit> plugin install --migrate-legacy-entry
npx --yes github:devpnko/kill-aislop-router#<40-character-commit> plugin install --force --migrate-legacy-entry
```

The current deterministic install marker binds the complete packaged payload, copied
Playwright/axe runtime, canonical skill bytes, package version, and namespaced
entrypoint. It deliberately carries no locally self-asserted installer,
source-path, or timestamp provenance. A pre-integrity marker is reported as `refresh-required` only when the installed payload/runtime/skill still exactly match the trusted package and is
accepted only for an explicit, backup-producing `--force` refresh. An empty,
self-authored, or payload-mismatched marker is not a refresh authority; move
that unverified directory aside and reinstall.

The migration moves the complete legacy entry to
`~/.codex/skills/.killsloprouter-backups/`, verifies its digest, and writes only
an explicit, implicit-disabled handoff shim at the old path. That shim is valid
only while it matches the actually installed canonical marker, payload,
runtime, and skill digests. It does not remove
or modify standalone `$antislop`.

Start a new Codex thread in the target repository and say:

```text
KillSlopRouter로 이 프로젝트의 ./src 전체 여정을 진행해.
```

Do not append `antislop을 실행해` to that request. The plugin routes antislop
internally after it has locked project direction, reviewer identity, and the
exact audit packet.

If antislop is also installed as a personal Codex skill, disable only its
implicit top-level trigger while keeping explicit `$antislop` use available:

```yaml
# ~/.codex/skills/antislop/agents/openai.yaml
policy:
  allow_implicit_invocation: false
```

This metadata does not weaken the Router child. `host configure-codex` reads
the selected skill root directly and locks its complete digest.

The explicit invocation is available when implicit skill discovery is disabled:

```text
Use $killsloprouter:kill-slop-router to bootstrap this project and run a fail-closed audit of ./src.
```

The plugin determines the route from project evidence, but it does not guess an
ambiguous product surface, visual direction, main color, or house style. It
locks unambiguous repository contracts or stops for an explicit project or
owner decision. Bootstrap creates a manual-only starter configuration with an
unresolved visual intent and visual signature; `doctor` stays non-zero until
both are backed by digest-locked authority receipts.
The plugin then runs `--dry-run` and uses the integrated resumable ledger. A
short `전체 여정` request resumes a matching run, advances only the currently
eligible stage, and stops for missing planning or owner evidence. It does not
ship an MCP server or gain remote authority. See
[Codex plugin](docs/codex-plugin.md).

The bootstrap command is also available directly:

```bash
killsloprouter bootstrap \
  --root . \
  --project-id my-product \
  --locale ko-KR \
  --surface operator-product-ui \
  --json
```

It refuses to overwrite existing configuration and creates a manual-only host
manifest. `--surface` is required at bootstrap: an ERP, admin console, or staff
workflow is normally `operator-product-ui`; a customer-facing product is
`consumer-product-ui`. This is a semantic contract, not a request to make one
surface look like another. Real adapters still require explicit allowlisting
and digest locking.

For an opt-in Codex installation, the official host configurator can replace
selected manual audit reviewers without accepting a project command:

```bash
killsloprouter host configure-codex \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --runtime "$HOME/.codex/packages/standalone/current/bin/codex" \
  --runtime-root "$HOME/.codex/packages/standalone/current" \
  --model gpt-5.4 \
  --agent-providers project-contract,visual-intent-review,locale-copy-review,domain-authority-review,privacy-authority-review \
  --skill-provider "anti-slop=$HOME/.killsloprouter/providers/anti-slop" \
  --allow-external \
  --json
```

The command locks the bundled bridge, complete selected runtime root, model,
output schema, and each selected skill root. It uses a new ephemeral,
read-only Codex thread per packet. Missing runtime, skill, or authentication
stays `manual_pending`; changed locked bytes block as tamper. It never replaces
the scanner, Playwright, design creation, or owner approval and stores no model
credential. Review the external-data and OS isolation boundary before granting
`--allow-external`. See [Official Codex review host](docs/codex-review-host.md).

Before `doctor`, replace the generated unresolved `visual_intents` and
`visual_signatures` entries with contracts derived from project, brand,
design-system, approved-reference, or owner evidence. Bind each authority
receipt and evidence file by SHA-256. In particular, `marketing-editorial` does
not permit a paper/editorial treatment by itself, and a frequently occurring or
logo color is not automatically the UI primary. See
[Visual intent contract](docs/visual-intent-contract.md),
[Visual signature contract](docs/visual-signature-contract.md), and the working
fixtures in `examples/planning-evidence/`.

When those contracts are genuinely undecided, use design exploration instead
of selecting a generic creator or guessing a style:

If service planning is already authoritative but the team needs better design
inputs first, run the optional reference-intelligence stage. It studies
popular released-product patterns without turning popularity into visual
authority:

```bash
cp examples/reference-brief.example.json .killsloprouter/reference-brief.json

killsloprouter reference run \
  --brief .killsloprouter/reference-brief.json \
  --root "$PWD" \
  --dry-run \
  --json
```

The brief binds service-planning, owner activation, UI Bowl query scope,
reference-use rights, coverage, and three independent provider roles.
KillSlopRouter ranks popularity strongly only inside the same product-fit band,
stops for a real owner to select one anchor plus supporting products, and emits
a pixel-free `discovery-evidence-only` grammar pack. It neither grants visual
intent/signature authority nor changes the exact-three 3×3 design route. UI
Bowl access defaults to manual export; no scraper or MCP is silently enabled.
See [Reference intelligence](docs/reference-intelligence.md).

```bash
cp examples/design-brief.example.json .killsloprouter/design-brief.json

killsloprouter design run \
  --brief .killsloprouter/design-brief.json \
  --baseline . \
  --host-config .killsloprouter/host-adapters.json \
  --dry-run \
  --json

killsloprouter design run \
  --brief .killsloprouter/design-brief.json \
  --baseline . \
  --host-config .killsloprouter/host-adapters.json \
  --out .killsloprouter/design-direction.json \
  --json
```

Edit the example first: its product evidence and theses are illustrative, not a
style preset. The workflow compares three project-specific theses at `refine`,
`evolve`, and `reimagine` depth, requires separate Playwright evidence for all
nine candidates, stops for an owner shortlist of three, then evaluates three
declared color strategies for each shortlisted direction. It never treats
`editorial`, neutral gray, or one main color as a default. See
[Project-aware design exploration](docs/design-exploration.md).

The bundled official Playwright adapter can inspect digest-bound,
self-contained static HTML candidate prototypes as well as the final served
application. Candidate HTML marks its demonstrated locales and states
explicitly; unbound local and network resources are blocked. Exploration
captures do not bypass the final audit's served-artifact attestation or
approved pixel baseline. Design receipts authorize direction, not domain,
privacy, runtime, release approval, or a reusable design system; those remain
hard gates in the integrated run. Implement the selected evidence with one
explicit project creator. A build/redesign route still requires a separately
approved design system or an explicit project surface creator.

Its browser gate detects viewport escape, flex/grid child overlap, and required
text clipping. Digest-locked scenarios can add `no-overlap`, `no-clipping`,
exact `count`, and `computed-style` assertions for project-specific rules such
as one shared time label or an approved sponsor-slot treatment.

For a UI artifact, the official browser setup is three explicit operations:

```bash
killsloprouter browser attest \
  --root "$PWD" \
  --artifact ./src \
  --out .killsloprouter/browser-attestation.json \
  --json

# Start the project using its own reviewed command, and expose the generated
# JSON at /.well-known/killsloprouter-artifact.json.

killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios account-overview,account-tabs,settings-permissions \
  --channel chrome \
  --json
```

KillSlopRouter never starts a profile-supplied development-server command.
The first visual run intentionally blocks when approved baselines are absent.
Review the candidate screenshots, copy only approved pixels into
`.killsloprouter/playwright-baselines/`, rerun `browser configure` to lock the
new baseline digest, and resume with `--retry browser-evidence`. See
[Official Playwright browser evidence](docs/playwright-browser.md).

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

The example host manifest is deliberately manual. The dry run exits `6` and
reports every provider as `manual_pending`; it never fabricates a completed
review. Replace those declarations with real, digest-locked adapters before an
executing run.

## Existing UI closed loop

When the artifact already has a UI, collect a real pre-change observation
before editing it:

```bash
node bin/killsloprouter.mjs run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task audit \
  --direction none \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --out .killsloprouter/pre-change-ui.json \
  --json
```

That audit must reach result ingestion, scanner triage, conflict adjudication,
and finalization. It may correctly end blocked because it found the defects to
fix. A manual browser result or generic child process cannot satisfy this
observation contract.

After the routed creator implements the bounded fixes, run the post-change
audit against the same critical scenario inventory:

```bash
node bin/killsloprouter.mjs run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task redesign \
  --direction approved \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --creator-id codex:session-123 \
  --observation-run .killsloprouter/pre-change-ui.json \
  --out .killsloprouter/post-change-ui.json \
  --json
```

The exact routed profile, observation run, before/after artifact digests,
official Playwright result, scenario bytes, viewport/browser verification
contract, and scenario inventory are hash-bound into the post-change plan and
audit. Changing the surface, visual authority, browser route, or verification
contract between the two runs starts a new observation instead of weakening
the comparison.
See [Existing UI anti-slop closed loop](docs/existing-ui-closed-loop.md).

## Integrated run receipts

The profile resolves `--artifact ./src` to a locked surface before route or
creator selection. An optional `--surface` may assert the expected value; a
mismatch blocks instead of overriding the project contract.

`run` connects these gates:

```text
plan -> planning receipt verification -> audit init -> dispatch
     -> adapter execution -> result ingest -> scanner triage
     -> conflict adjudication -> finalize -> owner approval
```

Every phase writes a versioned receipt with a SHA-256 digest next to the state
file. For `--out .killsloprouter/post-change-ui.json`, the plan, audit ledger,
packets, results, evidence, phase receipts, and final audit receipt live under
`.killsloprouter/post-change-ui.d/`.

The state, audit, every packet, phase receipt, owner approval, final receipt,
and child request repeat the same `journey_identity.identity_digest`. Each
packet also records a digest-bound `participant` with the exact `provider_id`,
role, `visibility: internal`, and parent orchestrator. Resume rejects a changed
identity even if an attacker recomputes only the state digest.

A modern start first writes a durable caller-visible authority receipt at
`<state>.authorities/<run-id>.json`, before it writes the first state. The
receipt binds the original journey, router/profile sources, route request,
artifact digests, scope, the initial canonical plan-authority digest, and the
complete parent-owned path contract. That plan-authority digest covers the
selected route, planning receipt, and optional parent/slice lineage before the
first state write. The receipt contains the `resume_authority_digest` printed by
a normal start. Retain both the receipt
and that exact value outside the mutable state and its `.d/` directory (for
example in the invoking CI job's protected output or an owner-held run log).
Every later integrated resume must present the original value with
`--authority-digest`; copying a new value from a modified state is not
verification. If the process crashes before normal output, recover the value
from the durable authority receipt rather than deriving it from state.

The canonical plan file, audit, and dispatch outputs are created after this
start authority. The version-5 resume authority already binds the initial plan
authority, including the planning receipt and optional lineage; phase and audit
receipts additionally bind the later persisted graph. After dispatch and before
the first child boundary, the Router writes a second caller-retained receipt at
`<state>.authorities/<run-id>.initialization.json`. It binds the immutable plan,
packet directory, mutable audit path, and all four initialization step receipts,
then is cross-bound into state. Keep both authority receipts. Removing state
bindings and every internal sidecar cannot turn a previously initialized run
back into a fresh run while this commitment remains.

A crash between initial
state creation and dispatch can therefore be recovered with the original
authority and resumed idempotently only when replanning produces the exact same
authority digest. Verified orphan plan/audit/packet sidecars are rebuilt into
one canonical initialization only inside the explicitly authorized stale-lease
recovery. Recovery receipt version 3 binds the root stale lease, exact prior
state digest, deterministic reconciled anchor IDs and steps, and the external
initialization graph digest. The graph digest is deliberately non-circular: the
state binds the recovery receipt, while the receipt binds the already durable
initialization authority rather than claiming its own final state digest. Valid
orphan anchors and a deterministic recovery receipt are adopted byte-for-byte;
they are never regenerated with a new timestamp. Normal
resume never treats an old recovery receipt as permission: any canonical
initialization sidecar or fixed step receipt that is not bound by the current
state is ledger rollback and exits before child spawn. Completed initialization
steps keep attempt 1.

That authority also fixes the complete parent-owned path contract. Normal
plan, audit, packet, automated result/evidence, phase-receipt, and final-receipt
outputs must remain under the sibling `<state>.d/` tree. A verified legacy
migration may use only its digest-bound transaction subtree. Approval, triage,
and manual-result sources are caller-owned read-only evidence, never parent
write targets. The Router requires a single-link file owned by the invoking
user, rejects group/world write permission, and parses it through one pinned
read-only descriptor while checking the file identity before and after read.
The parsed decision and its audit source snapshot come from those same bytes;
result, triage, and approval integrity later reparses the digest-bound source
and reconstructs the normalized authority instead of trusting two independent
path reads.

Every state-changing `run --out`, `run --resume`, and identity migration first
acquires an atomic lease beside the exact state path. The lease stays held
through child execution and is released only after the next checkpoint is
sealed. A concurrent caller exits `5` before it can start another reviewer.
Inspect a lease without changing it:

```bash
node bin/killsloprouter.mjs lease status \
  --state .killsloprouter/post-change-ui.json --json
```

After an orchestrator crash, wait until `recover_after`, then repeat the exact
owner token, acquisition timestamp, and current state digest reported by
`lease status`:

```bash
node bin/killsloprouter.mjs lease recover \
  --state .killsloprouter/post-change-ui.json \
  --owner-token '<exact local token>' \
  --acquired-at '<exact timestamp>' \
  --state-digest 'sha256:<exact digest>' \
  --authority-digest 'sha256:<original start resume authority>' \
  --json
```

Modern recovery requires both the stale-lease tuple and the original
caller-retained `resume_authority_digest`; it verifies them before claiming or
rewriting the lease. Recovery refuses a live owner and never clears a lease
from PID state alone. The public `killsloprouter/state-lease` surface does not
export the internal stale-claim primitive, and lease controllers cannot be
reconstructed from `lease status` JSON. If recovery fails after its exclusive
claim, the recovery lease remains held until a later authorized recovery
commits both the receipt and state checkpoint.
If a child was in flight, the receipt records `abandoned_after_crash`; its
outcome remains unknown and replay requires an explicit `--retry` selector.
Keep the owner token local rather than posting it in a public issue or PR log.
For a pre-identity state, add its current byte-identical `--legacy-backup` and
`--authority-digest` to `lease recover`. If recovery updates that state, make a
new external backup before identity migration.

If a scanner returns candidates, supply a triage file and resume:

```bash
export KSR_RESUME_AUTHORITY='sha256:<value printed by the original run>'
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/post-change-ui.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config .killsloprouter/host-adapters.json \
  --triage reports/static-triage.json \
  --json
```

If a provider is manual, complete its dispatch packet and ingest the resulting
`audit-result.schema.json` file before continuing:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/post-change-ui.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config .killsloprouter/host-adapters.json \
  --result reports/manual-functional-review.json \
  --json
```

`--result` is repeatable. Manual results pass through the same identity,
capability, artifact-digest, and browser-evidence checks as child results.

If an adapter failed, retry only that packet, provider, or stage:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/post-change-ui.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config .killsloprouter/host-adapters.json \
  --retry browser-evidence \
  --json
```

When critics pass, use the generated approval template as a starting point,
record a real owner decision in a separate file, then resume:

```bash
node bin/killsloprouter.mjs run \
  --resume .killsloprouter/post-change-ui.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config .killsloprouter/host-adapters.json \
  --approval reports/owner-approval.json \
  --json
```

Exit codes are stable for automation:

- `0`: complete, or a valid dry-run report
- `2`: invalid CLI or contract input
- `3`: no eligible route, ambiguous/mixed surface, or surface mismatch
- `4`: a tracked profile, artifact, result, or evidence boundary changed
- `5`: blocked, rejected, tampered, or execution failure
- `6`: exact manual input is still pending

`doctor` keeps the compatibility status `automation-ready` after project
authority is valid, but also reports execution readiness as not evaluated,
`completion_eligible: false`, and the next required command. It does not accept
`--host-config`; only integrated `run --dry-run` checks planned adapters.
Doctor also reports `skill_catalog`; a competing full legacy router entry, a
tampered compatibility shim, or an unverified canonical plugin payload makes
the status `configuration_required`.

## Host adapter safety

The project profile describes routing availability and capabilities. It is not
an executable configuration file. Executable adapters live in a separate host
manifest that must be passed with `--host-config`.

The host manifest must:

- allowlist each provider ID;
- choose one built-in adapter type;
- declare strength, capabilities, and permission scopes;
- bind every Node entrypoint or scanner to an exact SHA-256 digest;
- bind every explicitly imported local adapter module into one module-graph
  digest, with a maximum of 256 modules, 512 KiB per module, and 8 MiB total;
- seal each allowlisted Node module's bytes and physical identity through the
  final child-start boundary; same-byte path replacement does not select new
  code and imports execute through the sealed graph rather than mutable paths.

JSON child adapters run through the current Node executable with `shell:false`,
no profile-supplied arguments, and a reduced environment. Evidence returned by
a child must stay inside its granted output directory.

The optional official Codex bridge is the only bundled nested-runtime
exception. It is installed through `host configure-codex`, binds the exact
Codex executable and complete runtime root by digest, and uses a fixed
read-only argument set. It cannot be enabled from a profile or arbitrary
adapter settings.

Generate an entrypoint digest with:

```bash
node bin/killsloprouter.mjs digest --target ./adapters/reviewer.mjs
node bin/killsloprouter.mjs digest --target ./adapters/reviewer.mjs --module-graph
```

The graph digest is mandatory when a custom adapter imports local files.
Self-contained adapters remain compatible without it. Official Codex and
Playwright configuration commands generate both authorities automatically.
Custom CommonJS adapters may use literal local `require()`; custom ESM adapters
must use static or literal dynamic `import()`, including for `.cjs` and `.json`
helpers. `createRequire()` is deliberately excluded because it bypasses the
descriptor-fed seal; see the adapter migration note.
The standalone `scan --adapter kill-ai-slop` compatibility path likewise
captures and seals the scanner's complete current local module graph; callers do
not need a second CLI option. Integrated host manifests still require an
externally recorded graph digest so a changed scanner cannot self-authorize.
Its legacy-compatible receipt can still be passed to `audit record` for a
single matching root artifact. The Router verifies the real path and digest,
then records that provenance under the active KillSlopRouter parent identity;
partially supplied packet/identity fields fail closed instead of entering this
compatibility path.

See [Adapter authoring](docs/adapter-authoring.md) and
[Threat model and permissions](docs/threat-model-and-permissions.md).

## Project profile and route planning

Place the routing profile at `.killsloprouter/profile.json`, or pass it with
`--profile`. The CLI searches upward for the default profile. Validate it
against `schemas/project-profile.schema.json`.

Every profile must contain a `surface_contract`. A single-surface project binds
`.` to one surface. A repository with separate products uses more-specific
artifact roots, and each run must stay within one resolved surface. The most
specific binding wins; CLI input cannot override it. See
[Surface contract](docs/surface-contract.md).

Every visual route also needs one approved `visual_intents` entry for the
resolved surface. The authority receipt locks mode, editorial boundary, energy,
depth, and the project-specific qualities to preserve or avoid. Legacy profiles
remain structurally readable, but visual tasks fail closed until this additive
contract is configured. See [Visual intent contract](docs/visual-intent-contract.md).

The same route needs one approved `visual_signatures` entry. Its separate
receipt locks exact color roles and tokens, typography, density, shape,
elevation, imagery, motion, style keywords, and forbidden transformations, with
evidence coverage for every aspect. Missing or contradictory evidence remains
unresolved; the router never selects a neutral, editorial, flat, or other
default style. `doctor` prints the primary color, first type family, density,
and elevation summary for each surface, while JSON output retains the full
contract. See [Visual signature contract](docs/visual-signature-contract.md).

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
- Surface identity is resolved from the project/artifact contract before creator
  selection; ambiguous, mismatched, or mixed-surface runs block.
- Visual intent is resolved independently from surface identity; unresolved,
  changed, or mismatched authority blocks all visual routes.
- The exact visual signature is resolved independently from intent; guessed
  palettes, uncovered aspects, token substitution, or evidence tamper block.
- Editorial treatment is forbidden unless the verified contract explicitly
  allows a bounded scope or requires editorial mode.
- Fallbacks must meet minimum strength and cover the complete capability union.
- Scanner findings are candidates until individually classified; zero hits do
  not satisfy visual-intent, visual-signature, craft, browser, or owner gates.
- Reviewer conflicts require a recorded adjudication; scores are not averaged.
- Required locale, domain, privacy, browser, and owner stages cannot be skipped.
- Missing visual direction cannot fall through to a universal taste creator; it needs approved authority or owner-gated design exploration.
- Every direction and color candidate in design exploration needs independent Playwright evidence before comparison.
- Color harmony metadata does not replace computed semantic-role contrast or owner selection.
- Browser packets need viewport screenshots and non-screenshot proof for every required check.
- The official browser adapter requires served-artifact attestation, binds the
  adapter module graph, runtime packages, scenarios, and baseline directory by
  content plus physical identity, and launches from sealed code and a private
  package seal rather than reopening configured paths.
- Official Codex reviewers likewise execute a private, content-verified clone
  of the configured runtime root; same-byte source replacement is tamper, not
  an authorized upgrade. Manifest validation reuses a digest-bound readiness
  probe and does not clone the complete runtime once per provider; the clone is
  still mandatory at actual child execution.
- Owner approval is bound to the exact run and approval-scope digest. Declaring
  lineage makes G7 mandatory; its evidence must bind the exact candidate
  artifact set and full candidate, limit authority to the candidate slice, and
  explicitly deny parent promotion.
- A newer feature mockup can remain a digest-bound slice of an immutable parent baseline; version order never promotes it to parent. Canonical-path, symlink, recursive filesystem-identity, and last-pre-spawn checks prevent alias and TOCTOU substitution.
- A modern resume requires the original caller-retained authority digest before
  it trusts router/profile paths selected by mutable state.
- Initial state/lease and router/profile authority paths reject
  project-controlled symlink ancestors before the first parent-owned state
  write; canonical platform aliases still resolve to one physical run.
- Declarative router JSON remains usable from root-owned or hard-linked global
  and content-addressed installs across start, resume, stale recovery, and
  verified legacy migration. Exact content and physical identity stay pinned;
  profiles, approvals, manual evidence, and custom executables receive no such
  ownership/link exception.
- Standalone audit dispatch, ingestion, triage, status, and finalization require
  the caller-retained audit authority emitted at initialization; result provenance
  binds the exact run, packet, parent journey, participant, and optional
  parent/slice lineage.
- Child evidence must remain physically inside its unchanged output root;
  symlink components, hard-linked regular files, and special files are rejected.
- Every result-bearing automated attempt retains its physical child output
  grant. Resume binds the audit source to the latest recorded result and
  rechecks every evidence snapshot through that exact grant.
- Integrated owner approval, scanner triage, and manual results must be
  single-link regular files outside the automation state file and `.d/` tree.
- Changed artifacts or evidence block finalization.

Service planning stays external. `systemize` still requires verified G6T and
exact G7 evidence. See [Service planning bridge](docs/service-planning-bridge.md),
[Systemization protocol](docs/systemization-protocol.md), and
[Parent baseline and slice lineage](docs/baseline-lineage.md).

## Compatibility

Route receipt version 1, audit run version 1, audit result version 1, triage
version 1, and audit receipt version 1 remain supported. V1 adds bootstrap
receipt version 1, automation run version 1, and host adapter version 1.
The additive design workflow uses design exploration run version 1, design
result version 1, shortlist version 1, and owner decision version 1.
The optional reference workflow adds reference brief, packet, result, run,
owner-selection, and pack version 1. Its pack is discovery evidence only and
does not alter existing route, design, audit, or receipt versions.
The additive official Codex host uses setup receipt version 1 and extends host
adapter response version 1 with an explicit `manual_pending` envelope; existing
result envelopes remain valid.
State lease recovery receipt version 3 is a deliberate fail-closed change for
modern runs: it binds initialization reconciliation to the root stale lease,
recovered state, deterministic canonical anchor IDs, and the non-circular
initialization graph digest. Pre-release modern states retaining version-1 or
version-2 recovery receipts must restart; verified historical legacy migration
may retain version-1 receipts only as captured provenance.
Profiles must add the fail-closed `surface_contract`. Visual tasks also require
approved `visual_intents` and `visual_signatures` contracts; profiles without
them remain readable for non-visual compatibility but visual plans block.
Dispatch packets gained additive contract fields; receipt versions did not
change. Scoped UI runs now require a critical scenario inventory, and runtime
redesign runs require a pre-change observation state. See
[V1 migration notes](docs/migration-v1.md).

New V1 runs require `journey_identity` in state, audit, packets, phase receipts,
owner decisions, and child requests. A pre-identity automation state may be
migrated only before it contains adapter attempts, accepted results, approval,
final evidence, or an observation binding:

```bash
killsloprouter run --resume .killsloprouter/legacy-run.json \
  --migrate-identity \
  --legacy-backup ../killsloprouter-authority/legacy-run.pre-migration.json \
  --authority-digest 'sha256:<SHA-256 of that backup file>' \
  --host-config .killsloprouter/host-adapters.json \
  --json
```

The backup must be a byte-identical copy of the active pre-mutation state,
stored outside the mutable state directory. Its file digest—not a value read
back from the active state—is the migration authority. Keep that backup after
migration because every later read and resume revalidates the migration receipt
against it. Migration accepts only a positively supported historical router
digest and matching captured state/plan/audit fingerprints with a canonical
plan and evidence-free audit, replans it through the current digest-bound
router, stages a copy-on-write audit/packet/receipt transaction, and atomically
switches only the state pointer. It emits a new `resume_authority_digest` that
also binds the external backup, retained old sidecars, capture fingerprints,
and transaction directory for every later resume.
Evidence-bearing or source-less legacy runs must start a new V1 journey; the
migration refuses to relabel old child evidence. Modern identity-bound
pre-release states created before the durable version-5 start authority and
external initialization commitment remain readable but must also restart. This
includes states with no `resume_authority_digest`, plan-derived
version-1/version-2 authority copies, and version-3/version-4 authorities that
lack `<state>.authorities/<run-id>.initialization.json`; deriving or backfilling authority
from the mutable state would not establish an independent trust anchor.

Migration preflights the canonical `identity-migrations` transaction path
before staging, so a pre-existing symlink root cannot receive off-tree
sidecars. Identity-bound states that accepted automated results before attempt
`evidence_boundary` retention must restart as well; that physical child grant
cannot be reconstructed safely from a mutable old ledger.

## Documentation

- [Automation lifecycle](docs/automation-run.md)
- [Existing UI anti-slop closed loop](docs/existing-ui-closed-loop.md)
- [Surface contract](docs/surface-contract.md)
- [Visual intent contract](docs/visual-intent-contract.md)
- [Visual signature contract](docs/visual-signature-contract.md)
- [Parent baseline and slice lineage](docs/baseline-lineage.md)
- [Project-aware design exploration](docs/design-exploration.md)
- [Reference intelligence](docs/reference-intelligence.md)
- [Codex plugin](docs/codex-plugin.md)
- [Sidefy parent-identity UAT](docs/sidefy-parent-identity-uat.md)
- [Official Codex review host](docs/codex-review-host.md)
- [Adapter authoring](docs/adapter-authoring.md)
- [Official Playwright browser evidence](docs/playwright-browser.md)
- [Audit protocol](docs/audit-protocol.md)
- [Capability matrix](docs/capability-matrix.md)
- [Threat model and permissions](docs/threat-model-and-permissions.md)
- [V1 migration notes](docs/migration-v1.md)
- [Release checklist](docs/release-checklist.md)

Reviewer tools are referenced rather than bundled. The two browser runtime
packages are exact dependencies and are copied into the Codex plugin; their
versions, integrity values, and licenses are recorded in
`registry/tool-lock.json` and `THIRD_PARTY.md`.
