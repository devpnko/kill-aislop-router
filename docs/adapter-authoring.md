# Host Adapter Authoring

Host adapters connect real scanners, agent runners, skill runners, and browser
harnesses to the audit ledger. A project profile can select a provider, but it
cannot supply executable code. The host manifest is a separate operator-owned
file passed explicitly with `--host-config`.

## Adapter types

| Adapter | Purpose | Required permissions |
|---|---|---|
| `kill-ai-slop-v1` | Built-in invocation of the locked read-only scanner protocol | `artifact:read` |
| `agent-json-v1` | Local agent reviewer over JSON stdin/stdout | `artifact:read` |
| `skill-json-v1` | Local skill reviewer over JSON stdin/stdout | `artifact:read` |
| `browser-json-v1` | Browser review with screenshots and test reports | `artifact:read`, `evidence:write`, `browser:control` |
| `manual-v1` | Explicitly leave the provider for manual completion | none |

The `agent-json-v1` and `skill-json-v1` transports are identical. Their
different names preserve provenance and make the host's intended execution
boundary reviewable.

## Official Codex reviewer bridge

Projects that already use Codex may configure the bundled read-only reviewer
bridge instead of authoring one Node entrypoint per audit reviewer. Use
`killsloprouter host configure-codex`; do not hand-author its `settings`
contract. The command locks the bundled adapter, output schema, selected Codex
executable, complete runtime root, explicit model, and complete skill root for
each `skill-json-v1` provider.

The bridge creates a fresh ephemeral thread per audit packet and derives the
reviewer actor ID from Codex JSONL provenance. It disables plugins, MCP/apps,
browser, web search, computer use, image generation, and multi-agent
delegation, and it forces a read-only, non-interactive sandbox. It requires
explicit `network:external` authority because artifact content can reach the
model service. Authentication remains in Codex's host store and is never
serialized into KillSlopRouter data.

This bridge is audit-only. It refuses scanner, browser, owner, and design
exploration packets. Runtime, skill, or authentication absence remains
`manual_pending`; a changed digest is tamper; malformed or failed execution is
blocked. See [Official Codex review host](codex-review-host.md) for setup,
privacy, and OS/container boundaries.

## Manifest contract

Validate host manifests against `schemas/host-adapter.schema.json`. A process
adapter declaration looks like this:

```json
{
  "host_adapter_version": 1,
  "allowed_providers": ["anti-slop"],
  "granted_permissions": ["artifact:read"],
  "providers": {
    "anti-slop": {
      "adapter": "skill-json-v1",
      "entrypoint": "./adapters/anti-slop-review.mjs",
      "entrypoint_digest": "sha256:replace-with-exact-digest",
      "entrypoint_graph_digest": "sha256:replace-with-module-graph-digest",
      "strength": 3,
      "capabilities": [
        "task-fit",
        "state-completeness",
        "responsive-review",
        "accessibility-review",
        "interaction-review"
      ],
      "permissions": ["artifact:read"],
      "timeout_ms": 120000
    }
  }
}
```

Calculate both authorities after every entrypoint or imported local-module
change:

```bash
killsloprouter digest --target ./adapters/anti-slop-review.mjs
killsloprouter digest --target ./adapters/anti-slop-review.mjs --module-graph
```

The first digest binds the entry module for compatibility. The module-graph
digest binds that file plus every statically declared local `import`, `export
... from`, literal dynamic `import()`, and—for CommonJS modules—literal
`require()` dependency by content, format, and canonical file URL. Comments,
strings, templates, and regular expressions are not dependency declarations.
At execution, the sealed authority also
pins each captured file's physical identity. A self-contained
entrypoint may omit `entrypoint_graph_digest`; any entrypoint with a local
dependency must declare it. Local specifiers require an explicit `.mjs`,
`.js`, `.cjs`, or `.json` extension. Bare package imports and dependencies
discovered only through computed paths fail closed; package-backed runtimes
need a separately reviewed private-seal contract such as the official
Playwright adapter.

Custom ESM adapters must use static or literal dynamic `import()` for local CJS
or JSON helpers. `createRequire()` is intentionally rejected because its
synchronous loader would reopen a mutable filesystem path outside the
descriptor-fed seal. Migrate `createRequire(import.meta.url)` plus a local
literal `require()` to `import value from "./helper.cjs"`, or make the adapter a
`.cjs` entrypoint. The official Playwright adapter is the only reviewed
exception because its separate package runtime is copied into a private seal.

The provider ID must appear in `allowed_providers`, its permission scopes must
be a subset of `granted_permissions`, its strength must meet the packet minimum,
and its capabilities must cover every capability assigned to that packet.

The entrypoint must be a caller-owned, non-writable-by-others, single-link
regular `.mjs`, `.js`, or `.cjs` file of at most 512 KiB. The Router pins its
content and physical identity while loading the manifest, rechecks both at the
last child boundary, and executes the complete explicitly declared local graph
from sealed bytes. Every imported local module has the same size, ownership,
single-link, content, and physical-identity boundary. Bare or computed package
loading needs a dedicated first-party private-runtime contract instead of being
treated as a dependency lock.

`command`, `cmd`, `shell`, `args`, `executable`, and profile entrypoints are not
accepted execution fields. Process adapters always run as:

```text
current-node-executable <sealed digest-verified entrypoint authority>
```

The host uses `shell:false` and does not append profile data to the argument
list.

The official Codex bridge is a narrowly validated nested-runtime exception:
the outer process still uses the fixed Node boundary above, and only the
bundled adapter may clone the separately content/physical-identity-locked Codex
runtime into a private directory and launch that sealed binary with its fixed
reviewed arguments. A generic process adapter cannot request a nested command
through `settings`.

## Request protocol

The adapter reads one JSON object from stdin. The machine-readable contracts
are `schemas/host-adapter-request.schema.json` and
`schemas/host-adapter-response.schema.json`. Important request fields are:

- `host_adapter_request_version`: currently `1`
- `run_id` and `attempt`
- `journey_identity`: the complete digest-verified KillSlopRouter parent identity
- `participant`: exact provider provenance, internal role, and parent binding
- `baseline_lineage`: optional verified parent/slice relationship and exact artifact sets; its digest must match the packet
- `packet`: provider identity, stage question, capability assignment, visual-intent and visual-signature contracts, evidence contract, and artifact digests
- `packets`: the complete dispatch set, useful to form conflict references
- `creator`: creator provider and actor identity
- `scope`
- `artifacts`: exact local snapshots and resolved paths
- `prior_results`: normalized results already accepted into the ledger
- `output_directory`: the only directory from which returned evidence is accepted
- `permission_scopes`
- `settings`: adapter-specific JSON data from the host manifest

For a reference-backed design review only, the request may also carry
`review_source_authority` plus `reference-evidence:read`. The authority exposes
aliases and digests; its actual `source-capture` paths appear only in that
reviewer's `artifacts`. Their `capture_set_digest` must match. A creator or
browser request containing either the authority or permission is invalid.

The adapter must perform the review described by `packet.stage_question`. It
must not emit `pass` merely because the transport succeeded.
It must not present its provider name as the active mode or orchestrator. It may
describe itself only as an internal participant of KillSlopRouter, and it must
not alter either identity object. The host rejects a request/packet mismatch or
packet digest change before execution.

### Design exploration adapters

The additive `design run` workflow uses the same stdin/stdout transport and
host allowlist. Its packets conform to
[`design-packet.schema.json`](../schemas/design-packet.schema.json), carry
`design_packet_version: 1`, and use `design_task.kind` instead of an audit
question. Results conform to
[`design-result.schema.json`](../schemas/design-result.schema.json).
Design packets use the same `journey_identity` and `participant` fields; this
applies equally to creators, comparison critics, and browser evidence.

| `design_task.kind` | Adapter type | Minimum strength | Permissions |
|---|---|---:|---|
| `direction-candidate` | `agent-json-v1` or `skill-json-v1` | 3 | `artifact:read`, `evidence:write` |
| `direction-review` | `agent-json-v1` or `skill-json-v1` | 4 | `artifact:read`, `evidence:write`; plus `reference-evidence:read` only for an explicitly reference-backed internal-critic packet |
| `color-candidate` | `agent-json-v1` or `skill-json-v1` | 3 | `artifact:read`, `evidence:write` |
| `color-review` | `agent-json-v1` or `skill-json-v1` | 4 | `artifact:read`, `evidence:write`; plus `reference-evidence:read` only for an explicitly reference-backed internal-critic packet |
| `browser-evidence` | `browser-json-v1` | 3 | `artifact:read`, `evidence:write`, `browser:control` |

A direction creator returns exactly one prototype, exactly one `font-report`,
an exact visual-intent body, an exact visual-signature body, baseline digest,
packet digest, and stable actor ID. The font report records availability,
required-locale glyph coverage, fallbacks, and license/use constraints. The
creator must implement the packet's named thesis and redesign depth while
retaining every `baseline_policy.preserve` and `baseline_policy.forbid` item.
It cannot expand the editorial boundary.
The exact font report structure is
[`design-font-report.schema.json`](../schemas/design-font-report.schema.json);
the runtime also checks it against the signature families and brief locales.

A color creator returns exactly one prototype, exactly one `token-spec`, the
source direction digest, an exact palette, and a role system. The token
specification maps every emitted semantic role to implementation tokens. The
role system includes normalized sRGB values, tone scales, OKLCH or HCT method
metadata, harmony strategy, gamut targets, and `color_only_meaning: false`.
The router recomputes contrast; adapter-provided ratio claims are ignored.
The exact implementation evidence structure is
[`design-token-spec.schema.json`](../schemas/design-token-spec.schema.json),
and the runtime compares every role value, tone scale, and gamut target with
the returned color system.

Review adapters score every dispatched candidate against the criteria carried
in the packet, provide an exact ranking, mark explicit hard blockers, and write
a review report. Direction review includes typography fit; a font report does
not by itself prove that the typography suits the product. Reviewer providers
and returned actors must be independent from all candidate creators in that
comparison.
Comparison packets carry both compatibility `result_digests` maps and complete
candidate/browser bindings with source, evidence, host-manifest, and adapter
entrypoint digests. Review the bound files; do not substitute a same-path file
or treat the short digest map as the whole evidence contract.

The browser adapter must actually use Playwright and return
`browser_engine: "playwright"`, its version, a true result for every requested
check, all locales and states tested, one screenshot per viewport, and a test
report. It must run through KSR's sealed host-adapter boundary; manually
recording a browser result is not supported. A generic screenshot process
cannot use `agent-json-v1` to satisfy this packet. Browser evidence must come
from a different actor than the candidate creator.

The bundled official adapter can perform this contract for one digest-bound,
self-contained static HTML prototype. CSS and scripts must be inline; images
and fonts must use inline data or `data:`/`blob:` URLs. Creators using it annotate locale examples with
`data-killsloprouter-locale` and real states with
`data-killsloprouter-state`. A custom browser adapter may instead serve
candidate-specific URLs, but it must retain the packet digest, subject digest,
Playwright, evidence, locale, state, network, and actor boundaries.
That custom-adapter compatibility applies to the existing no-reference
exact-three route. A reference-backed design run resolves every browser packet
to the official Playwright provider, while source-reference captures remain
available only to the independent design critic. A custom or manual browser
therefore remains `manual_pending` before spawn for a reference-backed packet.
The official static-design path does not claim `screen-reader` or
`visual-regression`; requesting either leaves that packet `manual_pending` for
a separately allowlisted capable adapter. Its automated accessibility result
is `aria-semantics`, not a renamed screen-reader test.

The complete lifecycle, matrices, color roles, and owner files are documented
in [Project-aware design exploration](design-exploration.md).

### Reference intelligence adapters

The optional `reference run` workflow uses the same JSON process boundary.
Packets conform to
[`reference-packet.schema.json`](../schemas/reference-packet.schema.json), use
`reference_task.kind`, and preserve the KillSlopRouter `journey_identity`.
Results conform to
[`reference-result.schema.json`](../schemas/reference-result.schema.json).
Every `reference_task` also carries required SHA-256 `brief_digest` and
`authority_graph_digest` fields. The latter binds the exact brief, owner
activation, rights, planning sources, manual-export manifests, export evidence,
and reasoning-registry source. These values are parent-owned immutable inputs:
an adapter must echo the packet binding through its `packet_digest`, never
derive or substitute later authority. KSR recomputes the graph and revalidates
both task digests on resume before another child may start.
For every non-manual child start, the run ledger first fixes the host manifest,
the provider's complete declaration, and the adapter entrypoint/module graph in
a digest-bound execution-authority snapshot. Reference runs also persist that
snapshot in an immutable pinned sidecar. An adapter must not ask KSR to derive
historical authority from a later manifest; an older automated attempt without
the snapshot is non-resumable and must be rerun from verified external inputs.

| `reference_task.kind` | Internal role | Minimum strength | Permissions |
|---|---|---:|---|
| `reference-discovery` | `researcher` | 3 | `artifact:read`, `evidence:write`; plus `network:external` only for authorized read-only access |
| `reference-grammar` | `researcher` | 3 | `artifact:read`, `evidence:write` |
| `reference-review` | `critic` | 4 | `artifact:read`, `evidence:write` |

Discovery must return bounded UI Bowl source URLs, source record IDs, capture
times, distinct product and screen record IDs, an enumerated frame-role
manifest, platform, use environment, business model,
session shape, locale, sampling reason/cohorts/ecosystem, screen role, evidence
strength, source-linked priority observations, reference-use rights, and every
configured popularity signal with raw/normalized values, record/snapshot
identity, explicit product-or-screen subject kind and subject record ID,
scope, category, timestamp, conflict status, and evidence. Every discovery
evidence item must bind its reference ID, screen record ID, and one or more
enumerated frame IDs; its enclosing product and screen record must remain
unchanged, it must carry the exact subject bindings it actually supports, and
observations may cite it only for a bound frame. Popularity evidence must carry
the same product-or-screen subject as the signal or conflict it supports. In
`manual-export` mode, every one of those records and every evidence file must
exactly belong to the digest-bound, schema-valid export manifest. The evidence
path must stay inside the manifest directory, and KSR revalidates its bytes,
declared content kind, digest, and physical identity. The brief fixes the
common signal scope, category, weight, formula, bounds, and direction;
providers cannot choose or widen them. Repeating a product-level signal for
several screens does not create several claims: the canonical record must
match across those screens or be declared conflicted. Grammar extraction must
cover every reference, score the fixed product-fit dimensions,
distinguish observation from inference, and connect each principle to causal
hierarchy reasoning, application conditions, tradeoff, harmful contexts, and
live-data dependency. Fit score and band are router-recomputed from the six
fixed dimensions, and popularity normalization is router-recomputed from the
declared linear bounds and metric direction. Each grammar result must cover
every target locale with `direct`, `adaptation-required`, or `unsupported`
transferability plus risks and later verification requirements. Exact pixels,
CSS values, source copy, assets, and clone
instructions are invalid creator guidance.

The critic must use a distinct provider and actor, disposition every reference,
verify source identity, sampling, locale transferability, and product fit, list
only the source-declared component families and patterns it verified, and list
exactly which source-evidence, observations, inferences, hierarchy-reasoning
IDs, and grammar IDs it verified. It must reject operational grammar derived
from weak or promotional evidence and cannot mark conflicted popularity as
verified.
It cannot shortlist or approve for the owner. Returned evidence must remain in
the granted output directory. See
[Reference intelligence](reference-intelligence.md) for ranking and owner-gate
semantics.

Manual-export capture/metadata descriptors are readable only by the internal
reference participant whose request explicitly carries them. They are not a
design-creator input. Dispatch states this with
`source_evidence_descriptors_included`,
`source_pixels_available_to_reference_participants`, and the immutable
`source_pixels_exposed_to_downstream_creator: false` boundary. A reference can
be `eligible` only when the independent
critic reports `copy_risk: low` and every other hard condition passes; medium
or high risk remains blocked regardless of product fit or popularity.

A metadata-only result can complete reference research, but it cannot claim
design-review readiness. The compiled pack deterministically records
`reviewer_source_capture_readiness` with sorted capture evidence IDs, uncovered
selected reference IDs, uncovered verified observation IDs, and
`revalidate_on_design_start: true`. Only `ready_at_compilation` may enter a
reference-backed design run; `manual_pending` means the capture evidence must
be supplied through a new valid reference run, not patched into the pack.

For manual results, place every evidence file beside the submitted result JSON
or below that directory. The Router resolves relative paths from the result
directory and rejects absolute or relative escapes. Dispatch includes only
packets without an accepted result. It writes both the compatibility packet
and a digest-bound `.request.json` containing the exact stage-required prior
results. The request intentionally removes prior evidence paths while retaining
their result, source, and evidence digests. Discovery has no prior result;
grammar receives discovery; review receives discovery and grammar.

When a reference pack is bound to design exploration, KSR first verifies its
exact completed producer state. The full pack remains an audit artifact with
selected source identities, links, verified observations, causal reasoning,
grammar, and a path-free evidence digest manifest, but no source image bytes or
paths. KSR projects only aliased causal reasoning and transferable grammar to a
creator—never source names, URLs, observations, or pixels. A reference-backed
brief must explicitly bind `reviewer_source_access` version 1 in
`digest-bound-internal-critic` mode, limited to the two purposes
`promotional-citation-firewall` and `source-composition-independence`, with
`allowed_evidence_kinds: ["source-capture"]`. Redistribution, creator access,
browser-provider access, and external network must all be false.

KSR derives `review_source_authority` version 1 from the pack and exact
producer state. It carries aliased captures, sorted unique
`source_recipient_provider_ids` from accepted results plus every executable
attempt, and `source_recipient_actor_ids` from accepted normalized results,
plus a
canonically ordered `source_recipient_execution_lineage` and a
`capture_set_digest`; actual paths appear only in reviewer run artifacts. Each
executable lineage item binds its status, provider, adapter, provider-declaration and
authority digests, plus adapter entrypoint content, physical-identity, and
graph digests when an entrypoint exists. A completely manual run uses an empty
lineage array rather than made-up execution authority. The
design review packet must use audience `independent-reviewer`, require
`reference-evidence:read`, set
`source_evidence_descriptors_included` and
`source_pixels_available_to_participant` true, and keep
`source_pixels_exposed_to_downstream_creator` false. Creator packets use
audience `creator`; creator and browser packets forbid both
`reference-evidence:read` and `network:external` and cannot carry
`review_source_authority`.
An older review adapter without this permission and typed analysis contract is
capability-incomplete for a reference-backed review and must remain
`manual_pending`; do not grant source access to a creator as a fallback.
Provider and actor recipient identities remain binding across the reference and
design runs: a source recipient cannot become a direction/color creator or
browser participant. It may remain an independent direction/color reviewer,
where source access is explicit and expected. Check provider conflicts before
state creation and actor conflicts before result acceptance.

Direction and color creators must return `reference_reasoning_trace`; every
selected dimension must be `applied` or target-specifically `not-applicable`
and preserve actual grammar-to-reasoning edges from the pack. Independent
direction and color reviews must return the eleven stage-scoped
`reference_checks` for every candidate. The registry contains eleven checks,
but they are stage-scoped: direction review applies ten and color review two,
with `source-composition-independence` shared by both. A false check is valid
only with a matching hard blocker whose code is exactly
`reference-check-failed:<check-id>`. The packet carries each check's linked
reasoning lenses, pass condition, and required evidence. Each required role
must resolve to a typed, digest-bound candidate, browser, or review artifact;
specifically, `reference-capture-set` binds
`reference-authority/source-capture-set`, and
`source-composition-analysis` binds
`review-evidence/source-composition-analysis` conforming to
[`design-source-composition-analysis.schema.json`](../schemas/design-source-composition-analysis.schema.json).
An arbitrary evidence ID is rejected. These fields document
why a hierarchy works; they do not grant visual authority or permit source
pixel, copy, color-value, dimension, typeface, or composition reuse.

### Visual-intent reviewer

Implement `visual-intent-review` as an independent `agent-json-v1` or explicit
manual provider at strength 4. It must cover:

- `visual-intent-fidelity`
- `editorial-boundary`
- `character-preservation`
- `energy-preservation`
- `depth-preservation`
- `palette-fidelity`
- `typography-fidelity`
- `density-fidelity`
- `shape-fidelity`
- `elevation-fidelity`
- `imagery-fidelity`
- `motion-fidelity`
- `transformation-boundary`

Read `packet.visual_intent_contract` and
`packet.visual_signature_contract` as authority. Compare the rendered artifact
with its direction and every exact signature aspect. Report
`visual-intent-contract-violation`, `visual-signature-contract-violation`,
`brand-token-substitution`, `unapproved-style-normalization`, or
`unapproved-editorial-treatment` as applicable. Do not choose a quieter style,
derive a primary color from frequency, turn craft restraint into flatness, or
approve merely because the scanner found nothing. The reviewer actor and
provider must remain distinct from the creator.

## Response protocol

Write one JSON response to stdout and diagnostics to stderr:

```json
{
  "host_adapter_response_version": 1,
  "result": {
    "audit_result_version": 1,
    "run_id": "copy-from-request",
    "packet_id": "copy-review--independent-copy-agent--1",
    "packet_digest": "sha256:copy-from-request",
    "journey_identity": {
      "journey_identity_version": 1,
      "orchestrator_id": "kill-slop-router",
      "orchestrator_version": "1.0.0",
      "display_name": "KillSlopRouter",
      "canonical_entrypoint": "killsloprouter:kill-slop-router",
      "invocation": "explicit",
      "run_id": "copy-from-request",
      "presentation": {
        "active_workflow": "KillSlopRouter",
        "participant_rule": "internal-role-only"
      },
      "identity_digest": "sha256:copy-from-request"
    },
    "provider_id": "independent-copy-agent",
    "participant": {
      "participant_version": 1,
      "provider_id": "independent-copy-agent",
      "role": "critic",
      "visibility": "internal",
      "orchestrator_id": "kill-slop-router"
    },
    "reviewer": {"actor_id": "agent:review-session-42", "kind": "agent"},
    "verdict": "pass_with_findings",
    "capabilities_checked": ["copy-specificity", "copy-honesty", "copy-concision"],
    "artifact_digests": {"src": "sha256:replace-with-packet-value"},
    "findings": [],
    "evidence": [],
    "resolutions": [],
    "started_at": "2026-08-18T00:00:00.000Z",
    "finished_at": "2026-08-18T00:01:00.000Z"
  },
  "metadata": {"child_pid": 1234, "transport": "local-agent-runner"}
}
```

The result must copy `run_id`, `packet_id`, `packet_digest`,
`journey_identity`, `provider_id`, `participant`, `artifact_digests`, and the
assigned capability set from the request. If the request carries
`baseline_lineage`, the result must also copy its `lineage_digest` into
`baseline_lineage_digest`. The audit ledger rejects cross-run or cross-parent
result replay, creator self-review, and incomplete capability reports even if
the child exits zero.

## Browser evidence

A browser adapter must create evidence files inside `output_directory` and
return paths relative to that directory. KillSlopRouter resolves and confines
those paths before audit ingestion. The output root's real path and filesystem
identity must remain unchanged. Symlink components, hard-linked evidence files,
special files, and physical paths outside the granted root are rejected even
when their lexical relative path appears safe.

For integrated automation, the parent persists the grant/output device, inode,
real path, and lexical path with the completed attempt. Later finalize/resume
requires the audit result source to match the latest recorded result file and
re-snapshots every automated evidence item through that retained boundary.
Device and inode markers are emitted as decimal strings so large filesystem
identifiers remain lossless; readers accept an older safe-integer marker only
for compatibility. Verified root-owned macOS `/tmp` and `/var` aliases are
canonicalized, while every other symlink ancestor is rejected before output
creation or child spawn.
Adapters must therefore finish all evidence writes before returning and must
not expect a copied or relocated evidence tree to remain authoritative.

Each required viewport needs a `screenshot`. Every required browser check needs
non-screenshot proof such as a `test-report`. For each
`packet.evidence_contract.required_scenarios` ID, return non-screenshot proof
and one screenshot at every required viewport. An evidence item must list the
capabilities, viewports, checks, and scenarios it actually covers. A smoke-test
label does not satisfy keyboard, state, overflow, contrast, zoom, visual
regression, screen-reader, or critical-state requirements.

`manual-v1` records an explicit reviewer attestation; it does not make a custom
report machine-verifiable or claim that KillSlopRouter ran the browser. Prefer
the official adapter when a technical pass must prove layout geometry through
the child-process boundary. Project-specific requirements belong in the
digest-locked scenario as typed assertions, not arbitrary profile commands.
Only the bundled official Playwright transport may serve as a runtime
redesign's pre-change `--observation-run`; a schema-valid custom result remains
valid custom audit evidence but cannot claim that stronger provenance. The
official host must also match the profile's `browser_contract_digest`; reusing
scenario IDs with weaker actions, assertions, or viewport definitions remains
`manual_pending`.

### Official Playwright adapter

Prefer the bundled adapter for normal UI audits. Configure it through the CLI;
do not hand-author its entrypoint or runtime paths:

```bash
killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --channel chrome \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios account-overview,account-tabs,settings-permissions \
  --baseline-dir .killsloprouter/playwright-baselines \
  --json
```

Configuration binds the bundled entrypoint's complete local module graph, the
complete `playwright-core` and `axe-core` runtime directories, the scenario
file, and the baseline directory to content and physical-identity digests.
Immediately before execution the two
runtime package trees are privately cloned and the child verifies that seal
before loading them. It also places the stable verification-contract digest in
the profile so the host cannot substitute scenario or viewport semantics.
Localhost is the default network boundary. External base URLs or resource
origins require both `--allow-external` at configuration time and
`network:external` in the resulting provider permission set.

The profile's browser verification digest binds portable reviewed semantics and
runtime content, not machine-local inode/owner/timestamp values. The latter stay
in the host manifest and remain mandatory at local preflight and child spawn.
Trusted bundled package files may be root-owned or hard-linked by a
content-addressed installer; custom adapter files do not inherit that exception.

The adapter connects only to a server the operator already started. It never
accepts a start command, package script, shell, arbitrary executable, or
profile-supplied argument. It also blocks page requests outside the configured
origin set and requires the server to attest the exact audit artifact digest
map before opening a browser. See
[Official Playwright browser evidence](playwright-browser.md) for scenarios,
baseline approval, evidence files, and the screen-reader scope boundary.

## Scanner adapter

`kill-ai-slop-v1` takes `adapter_root` instead of an arbitrary entrypoint. The
host locates one of the documented scanner paths under that root and verifies
its `entrypoint_digest` before invocation. Scanner findings enter the ledger as
`candidate` findings and always stop at the triage gate.
Zero findings mean only that the locked scanner patterns were absent. A scanner
cannot emit or substitute the visual-intent, craft, browser, adjudication, or
owner verdict.

## Manual fallback

Use `manual-v1` when the provider has a valid route contract but no authorized
host integration. It records `manual_pending`; it never creates an audit
result. Complete the generated packet template, then pass the result with
`run --resume STATE --authority-digest SHA256 --result FILE`, using the
authority digest retained from the original modern start. Manual ingestion is
recorded separately and still enforces reviewer identity, capability, digest,
and evidence checks. This is the correct public default for example manifests
and partially integrated projects.
