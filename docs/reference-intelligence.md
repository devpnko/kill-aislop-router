# Reference intelligence

`killsloprouter reference` turns an approved service-planning frame and
curated released-product references into a small, reviewable design-grammar
pack. It is an optional stage before design exploration. It does not generate
UI, choose visual authority, or replace the exact-three 3×3 workflow.

The intended roles are:

- UI Bowl: reference source and popularity evidence;
- KillSlopRouter: authority binding, routing, deterministic ranking, ledger,
  and owner gate;
- external researchers: discovery and transferable-grammar extraction;
- independent critic: provenance, product-fit, and anti-copy verification;
- Owner: one anchor, supporting references, and grammar selection;
- downstream creator: receives only the creator-safe projection of aliased
  causal reasoning and grammar, never source identities, observations, or pixels.

## Why popularity is useful but subordinate

Popularity is a strong prior among references that solve the same kind of
problem. It is not a universal design score. A high-MAU shopping home page is
not better evidence for a dense evidence-review console than a lower-traffic
screen with the correct user, task, trust, density, and state model.

KillSlopRouter therefore sorts in this order:

1. hard eligibility: provenance, rights, independent verification, and
   `copy_risk: low`; medium or high copy risk is never eligible;
2. product-fit band: `exact`, `adjacent`, then `weak`;
3. weighted popularity score inside the same fit band;
4. fit score and stable reference ID only as tie-breakers.

Each popularity signal includes its metric, raw value, normalized 0–100 score,
subject kind (`product` or `screen`), subject record ID, scope, category,
snapshot timestamp, as-of timestamp, and evidence. Product-level MAU is never
silently rebound to a screen record. The pack carries the configured signal
weights, and KSR recomputes both each normalized value and the weighted total.
Conflicting records must be declared. The router keeps that reference eligible
when its design evidence is otherwise valid, but ranks its popularity last
inside the same fit band. Popularity cannot change eligibility, waive a hard
gate, or make an owner decision.

When several screen records belong to one product, a repeated product-level
signal is one shared claim, not extra votes. Its canonical metric, value,
scope, category, timestamps, normalization, and product-subject evidence must
match across records; otherwise the export must declare the conflict and the
score remains unverified.

## Input contract

Start with
[`examples/reference-brief.example.json`](../examples/reference-brief.example.json)
and validate the shape against
[`schemas/reference-brief.schema.json`](../schemas/reference-brief.schema.json).
The runtime additionally re-hashes every authority file.

The example's `FlowDesk`, `MarketLine`, and `ProofGrid` records are synthetic
schema and package-install fixtures. They do not assert that those products,
URLs, or popularity values exist in UI Bowl and are not corpus evidence.
Replace the example export with a caller-owned, rights-reviewed export for
actual research. All three example evidence records are deliberately
`source-metadata`, not screenshots. A run may therefore prove the research
contract and complete, while its compiled pack remains `manual_pending` for
reviewer source captures and cannot start reference-backed design exploration.

The brief requires:

- explicit owner activation for bounded reference research;
- at least one external `service-planning-gate` receipt and the gate IDs that
  must already be `passed`, `approved`, or `locked`;
- a product frame: user, job, screen family, main object, core task, trust
  risk, density, states, and success metric;
- bounded UI Bowl queries by pattern, component, app, or OCR term;
- for `manual-export`, at least one caller-owned export manifest conforming to
  [`uibowl-manual-export.schema.json`](../schemas/uibowl-manual-export.schema.json),
  bound by path and SHA-256; every returned product, screen, URI, frame, query,
  popularity record, and evidence file must be a member of that exact
  manifest. Evidence paths must stay inside the manifest directory; KSR pins
  the actual bytes, digest, and physical identity, validates capture/metadata
  content, requires every exported frame to be covered, and rejects an
  evidence subject that does not match the enclosing product or screen.
  Every evidence item must bind the enclosing screen subject. A product-level
  signal additionally needs evidence carrying that exact product subject; a
  screen-level signal needs the exact screen subject. For
  `authorized-read-only-adapter`, no manual export may be mixed into the
  network run;
- reference-use rights evidence with redistribution and downstream creator
  pixel access both disabled;
- minimum coverage for component families, UI patterns, and grammar
  dimensions;
- coverage-balanced sampling across distinct products, categories, ecosystems,
  task-fit, cross-domain challenge, and competent-baseline cohorts, with caps
  on source-family dominance and promotional evidence. High-reach and
  high-bookmark labels may explain discovery, but cannot be a hard coverage
  requirement;
- distinct discovery, grammar, and critic providers.

Discovery treats a product reference as a screen family, not an isolated
pretty frame. It records canonical product and screen record IDs, source URL,
platform, physical environment, business model,
session shape, locale, why it was sampled, core-task/state/promotional frame
counts plus an enumerated frame-role manifest, screen role, and evidence
strength. A family with fewer than two
frames or no core-task frame is weak evidence. Promotional screens are always
weak and cannot establish operational hierarchy, navigation, comparison,
evidence, interaction, or responsive grammar.

The bundled
[`human-design-reasoning.json`](../registry/human-design-reasoning.json) is a
dated, non-authoritative research aid derived from a 24-product/48-screen
study. KSR copies and digest-locks it into each run, then sends its questions
to discovery, grammar, and review participants. It cannot grant visual
authority. See the full
[UI Bowl study](research/ui-bowl-popular-design-study-2026-09-04.md).

`manual-export` is the safe default. Its discovery packet forbids
`network:external`; KSR validates manifest membership, binds the actual local
capture/metadata files, and includes the export digest in selection and pack
provenance. The brief, not the provider,
fixes each popularity signal's subject kind, scope, category, weight, formula,
bounds, and direction. KillSlopRouter V1 does not bundle a UI Bowl scraper or
silently activate an MCP server. Use
`authorized-read-only-adapter` only after the owner has verified an official
endpoint, authentication, terms, retention, and copyright boundary; that mode
also requires an explicit `network:external` grant. A missing integration is
`manual_pending`, not evidence that research ran.

The [UI Bowl site](https://uibowl.io/) states that rights remain with the
relevant rightsholders or providers. Keep screenshots and source metadata in
the reviewer evidence tree. Do not redistribute them, lift copy/assets, or use
a visual clone as the creator prompt. Link back to the source and extract
structural principles.

## Dry run

From the project root:

```bash
killsloprouter reference run \
  --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json \
  --root "$PWD" \
  --dry-run \
  --json
```

The report verifies service-planning, owner, and rights files and shows exact
provider readiness. Exit `6` means one or more providers are correctly waiting
for a manual result. No reference state or source capture is created by the
dry run.

## Execute and resume

```bash
killsloprouter reference run \
  --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json \
  --root "$PWD" \
  --out .killsloprouter/reference-run.json \
  --json
```

The state machine runs three digest-bound child roles in order:

1. `reference-discovery` records source-linked observations, visible priority,
   screen-family strength, sampling cohorts, exact provenance, rights, and
   snapshot-specific popularity signals;
2. `reference-grammar` separates observed facts from confidence-labelled
   inference. Every principle must trace through visible priority, supported
   user decision, likely constraint, flattening consequence, application
   conditions, tradeoff, harmful context, live-data dependency, and anti-copy
   boundary. It then extracts transferable hierarchy, navigation, component,
   comparison, evidence, typography, color-role, density, interaction, and
   responsive grammar. Product-fit score and band are recomputed from the six
   fixed dimensions (`user`, `task`, `screen`, `trust`, `density`, `locale`),
   and every target locale receives an explicit transferability analysis;
3. `reference-review` independently verifies the evidence, individual
   component families and patterns, causal chain, product fit, popularity
   basis, promotional firewall, sampling diversity, and copy risk.

Every packet repeats two immutable task-authority bindings:
`brief_digest` identifies the exact reference brief, while
`authority_graph_digest` covers the brief snapshot, owner activation, rights,
planning sources, manual-export manifests, export evidence, and bundled
reasoning-registry source as one canonical graph. KSR recomputes that graph and
revalidates both digests on resume before it accepts a persisted packet or
starts another child. A mismatch blocks rather than inheriting later authority.

All providers run as internal KillSlopRouter participants. The first two have
the `researcher` role and the last has `critic`; no child becomes the active
workflow. Providers and returned actors must be distinct. A high-reasoning
model such as Fable 5.1 can be bound through an explicit digest-locked
`agent-json-v1` host adapter for discovery or grammar analysis. Use a separate
provider identity and fresh actor for the critic. KillSlopRouter does not ship
or infer that external adapter, its credential, or its network permission.
The reference-stage participants may inspect only the read-only source files
that the manual-export authority explicitly binds to their request. Those
files remain internal research/review evidence; their availability here does
not grant a downstream design creator access to them.

Without a configured provider, dispatch the current packet and obtain the
result independently:

```bash
killsloprouter reference dispatch \
  --run .killsloprouter/reference-run.json \
  --out-dir reports/reference-packets \
  --json

killsloprouter reference run \
  --resume .killsloprouter/reference-run.json \
  --result reports/reference-discovery-result.json \
  --json
```

Repeat dispatch/resume for the next emitted packet. A supplied result remains
`manual_recorded`; it is never mislabeled `ran`.
Dispatch emits only unresolved packets, so already accepted child work is not
presented as new work. Beside each compatibility `<packet-id>.json`, dispatch
writes `<packet-id>.request.json`. That request binds the current state and
packet digest, preserves the packet's exact `brief_digest` and
`authority_graph_digest`, the authorized manual-export source descriptors,
public authority snapshots, and only the prior results required by that stage: none
for discovery, discovery for grammar, and discovery plus grammar for review.
Prior child-result evidence paths are stripped; semantic results,
result/source digests, and evidence digests remain for independent checking.
This stripping does not remove the separately authorized source evidence
needed by the internal reference role. The request reports this boundary
explicitly through `source_evidence_descriptors_included`,
`source_pixels_available_to_reference_participants`, and the invariant
`source_pixels_exposed_to_downstream_creator: false`; the legacy ambiguous
`source_pixels_included` flag is not used for dispatch authority.
Manual evidence must be stored in the submitted result
file's directory or a descendant; absolute or relative paths that escape that
boundary are rejected before KSR reads them.

After coverage passes, the router exits `6` at
`owner-reference-selection` and writes a template under:

```text
<state-without-extension>.reference/templates/reference-owner-selection.json
```

Copy it outside the child-writable state tree, inspect the evidence, select
exactly one anchor and one to four supports, choose only critic-verified
grammar IDs, then resume:

```bash
killsloprouter reference run \
  --resume .killsloprouter/reference-run.json \
  --selection reports/reference-owner-selection.json \
  --json
```

At least one support must come from a different product, category, and product
ecosystem. This does not prove novelty by itself, but it prevents one design
family from becoming a disguised clone specification.

## Output boundary

The completed on-disk
[`reference-pack.schema.json`](../schemas/reference-pack.schema.json) contains:

- the unchanged service-planning product frame;
- selected source links, independently verified six-axis product fit, and
  subject-bound popularity provenance;
- the digest-bound human-design reasoning lenses;
- a path-free source-evidence manifest binding every digest to its product
  reference, screen record, and enumerated frame IDs;
- critic-verified text observations that cite only that manifest;
- critic-verified causal hierarchy reasoning;
- owner-selected, critic-verified transferable grammar;
- the complete discovery/grammar/review/selection digest chain;
- router-recomputed reviewer source-capture readiness, including the exact
  capture evidence IDs and every uncovered selected reference or verified
  observation;
- `authority_scope: discovery-evidence-only`;
- explicit false values for source-pixel inclusion, visual authority, visual
  signature authority, and design creation.

This full audit pack deliberately retains selected source identities and
links, verified text observations, reasoning, grammar, and the path-free
evidence digest manifest. The evidence kind `source-capture` may remain beside
its digest so an auditor can tell how a claim was observed, but the pack
intentionally excludes capture paths, encoded bytes, inline images, and source
pixels. It cannot be copied into a profile as an approved visual intent or
signature. Research completion and design readiness are deliberately separate:
`reviewer_source_capture_readiness.status` is `ready_at_compilation` only when
every selected reference has a capture and every verified observation cites a
capture covering its exact reference/frame. Otherwise it is `manual_pending`
and lists `capture_evidence_ids`, `uncovered_reference_ids`, and
`uncovered_observation_ids`. KSR recomputes these sorted sets from the pack and
requires `revalidate_on_design_start: true`; editing the status cannot create
readiness. To bind a ready pack to design exploration, add its path/file digest,
the exact completed producer-state path/file digest, and the explicit
internal-critic source-access contract as the optional `reference_pack` in the
design brief:

```json
{
  "reference_pack": {
    "path": ".killsloprouter/reference-run.reference/outputs/reference-pack.json",
    "digest": "sha256:<file digest>",
    "producer_state": {
      "path": ".killsloprouter/reference-run.json",
      "digest": "sha256:<producer state file digest>"
    },
    "reviewer_source_access": {
      "reviewer_source_access_version": 1,
      "mode": "digest-bound-internal-critic",
      "purposes": [
        "promotional-citation-firewall",
        "source-composition-independence"
      ],
      "allowed_evidence_kinds": ["source-capture"],
      "redistribution": false,
      "creator_access": false,
      "browser_provider_access": false,
      "external_network": false
    }
  }
}
```

KSR verifies the pack's project, surface, journey, internal digest, authority
flags, exact planning target and product-frame digest, current bundled
reasoning-registry digest, reasoning chain, applicability, tradeoffs, and
exact output/result/selection lineage in the completed producer state. It then
gives each direction/color creator a smaller creator-safe projection containing
only aliased causal reasoning and transferable grammar. Source identities,
URLs, observations, pixels, and capture paths do not cross the creator
boundary. KSR derives a digest-bound `review_source_authority` version 1 for
the independent reviewer. It binds the pack and producer-state digests,
aliased source captures, and one `capture_set_digest`; actual source paths
exist only inside that reviewer's run artifacts. Its packet audience is
`independent-reviewer`, sets
`source_evidence_descriptors_included: true` and
`source_pixels_available_to_participant: true`, keeps
`source_pixels_exposed_to_downstream_creator: false`, and requires the separate
`reference-evidence:read` permission. Creator packets use audience `creator`,
forbid that permission, and cannot receive `review_source_authority`. Browser
providers likewise receive no source access. Every reference-carrying packet
forbids `network:external`. This optional bridge does not alter the exact-three
3×3 matrix, Playwright evidence, Owner shortlist, color exploration, final
Owner approval, or any visual-intent/signature gate.

The derived authority also binds sorted, unique
`source_recipient_provider_ids` from accepted producer results plus every
executable source-recipient attempt, including failed attempts. Its
`source_recipient_actor_ids` come from the normalized accepted results. This is
a cross-run separation boundary: those providers and actors cannot return as
direction/color creators or browser participants in the consuming design run,
even under a renamed stage. Reuse as an independent direction or color
reviewer is allowed because source comparison is that role's explicit
responsibility. Provider overlap is rejected before design state creation; a
newly observed creator/browser actor overlap is rejected before its result is
accepted.

The authority also contains `source_recipient_execution_lineage`. Its attempts
are ordered by `packet_id` in codepoint order and then integer attempt number,
and bind execution status, provider, adapter, provider declaration, immutable execution
authority, and any adapter entrypoint content, physical-identity, and graph
digests. This prevents a provider rename or later adapter replacement from
laundering a source-privileged participant into a creator/browser role. An
entirely manual producer legitimately records an empty attempts array; KSR
must not invent executable authority for it.

The registry binds eleven fixed but stage-scoped reviewer checks. Direction
review applies ten checks; color review applies two. The totals overlap because
`source-composition-independence` applies to both stages. These are not
aesthetic scores; each carries its reasoning lenses, a pass condition,
required evidence, and a fixed hard-failure code:

| Check | Stage | What must be proved |
|---|---|---|
| `decision-inventory` | direction | primary groups map to a user decision, required information, and permitted next action |
| `state-cardinality` | direction | controls expose the real number of states instead of visually simplifying them |
| `accent-role-budget` | color | brand, action, selection, semantic state, data, and depth colors have distinct accessible jobs |
| `comparison-slot-alignment` | direction | repeated objects retain aligned value, conditions, uncertainty, provenance, and action slots |
| `risk-near-action` | direction | consequence and evidence appear before irreversible, paid, private, or uncertain actions |
| `density-by-cadence` | direction | density follows task frequency, interruption, and use environment rather than a style genre |
| `live-data-scaffolding` | direction | dynamic-looking content has a real source, freshness, empty state, and failure behavior |
| `state-completeness` | direction | loading, partial, empty, error, blocked, and success preserve truthful hierarchy |
| `responsive-reprioritization` | direction | small screens recompose priority and remain genuinely operable in Playwright |
| `promotional-citation-firewall` | direction | promotional frames never establish operational hierarchy |
| `source-composition-independence` | direction + color | the candidate proves target-derived composition instead of copying a source arrangement |

For source comparison, the typed role `reference-capture-set` must bind
`reference-authority/source-capture-set`; the reviewer-authored
`source-composition-analysis` must bind
`review-evidence/source-composition-analysis` and conform to
[`design-source-composition-analysis.schema.json`](../schemas/design-source-composition-analysis.schema.json).
Neither role may be satisfied by creator testimony or an unrelated digest.

Each reviewer check must bind every declared `required_evidence` role to a
typed, digest-bound candidate, browser, or independent-review artifact. A
boolean assertion or an unrelated evidence digest does not satisfy the check.
Every selected non-color grammar dimension, plus `color-roles`, must also have
an `applied` or target-specific `not-applicable` trace preserving its exact
grammar-to-causal edge.

When a bound design run completes, its final decision keeps a non-authoritative
`reference_intelligence_binding`: pack/file and producer-state/result/selection
digests, target/frame binding,
selected direction and color trace digests, and independent review result
digests. It also records `review_source_capture_set_digest`,
`direction_source_composition_analysis_digest`, and
`color_source_composition_analysis_digest`, so final provenance proves which
capture authority and two independent analyses were accepted without exposing
their paths. The binding fixes provenance while retaining
`visual_authority_granted: false`; only the separate Owner decision grants the
approved visual intent and signature.

## State and failure semantics

Start and resume take the same exclusive atomic state lease used by integrated
automation. A competing call exits `5` before another child starts. Every
child intent is written to state before spawn, then marked as child execution;
the attempt and result are checkpointed before release. Unresolved child or
state-write phases retain the lease and fail closed for explicit recovery.

Reference state, packets, source results, evidence, owner selection, and final
pack are digest- and physical-identity checked on every read. Changed planning,
rights, owner activation, source result, evidence, or output blocks resume.
Authority files are parsed, hashed, and snapshotted from one pinned descriptor;
hard links, symlink ancestors, and redirected state or dispatch paths are
rejected before an off-tree write.

Before an allowlisted automated reference child can start, KSR persists both
an `execution_authority` and its pinned `execution_authority_source`. The
authority fixes the exact host-manifest snapshot, provider declaration digest,
adapter/strength/capabilities/permissions/timeout, optional adapter-entrypoint
content, physical identity and module-graph digest, plus its own digest. The
source is an immutable JSON sidecar below the state directory. The sealed child
intent carries both before spawn; `ran`, child-returned-manual, execution-error,
and crash-recovered attempts retain them. Read and resume re-open the sidecar
and revalidate the current host declaration and entrypoint against that
historical grant. Inspection-only `manual_pending` and caller-supplied
`manual_recorded` results have no automated execution authority and never gain
one by inference.

After a real orchestrator crash, inspect the generic lease and recover the
reference state only with the exact displayed tuple and only after
`recover_after`:

```bash
killsloprouter lease status \
  --state .killsloprouter/reference-run.json \
  --json

killsloprouter reference recover \
  --state .killsloprouter/reference-run.json \
  --owner-token '<exact token>' \
  --acquired-at '<exact timestamp>' \
  --state-digest 'sha256:<exact current state digest>' \
  --json
```

Recovery checks PID plus canonical process-start identity; PID alone is never
enough. A child that may have started is recorded as
`blocked_abandoned_after_crash`. It is not marked `ran`, and the next resume
must include an explicit retry selector. An unresolved recovery or state write
keeps the lease fail-closed.

If the child result and attempt were already durably checkpointed before the
crash, recovery verifies their packet, provider, attempt, packet digest, and
result digest, records `checkpoint_recovered`, and does not run that child
again. The recovered state becomes `manual_pending` with an explicit resume
instruction. A second crash while writing that recovery converges on the same
single recovery receipt; state re-sealed outside the lease-bound digest
transition is rejected.

Use `--retry all`, packet ID, provider ID, stage ID, or result kind only after
reviewing a recorded failure. Completed reference results are immutable within
the run.

## Preview migration

This contract was strengthened while the reference-intelligence feature was
still confined to its draft follow-up PR. A state created from an earlier
preview packet does not contain the bound reasoning registry, source-file and
product/screen/frame/subject evidence closure, screen-family evidence fields,
causal grammar tuple, stage-scoped review IDs, exact producer-state lineage,
router-recomputed reviewer source-capture readiness, the version-1 reviewer
source-access/capture-set, source-recipient authority and execution lineage, or immutable
per-attempt execution authority/source snapshots. Do not hand-edit, re-sign,
backfill authority from the current host manifest, or resume it as current
evidence. An automated attempt cannot be migrated because its historical
executable grant cannot be reconstructed after the fact. Retain the old files
as historical evidence and start a new reference run from the same external
planning and Owner authority files. Inspection-only/manual attempts remain
manual provenance but do not make the old run resumable. Run a
fresh dry-run, regenerate all three stage packets and results, obtain a new
Owner selection, and compile a new pack. If a design state already bound the
preview pack, start that design exploration again with the regenerated pack;
do not transplant its shortlist or approval. Existing design briefs that omit
the optional `reference_pack` remain valid and keep the prior exact-three flow.
An existing reference-backed review adapter that lacks the exact
`reference-evidence:read` grant or typed source-composition report stays
`manual_pending`; do not remove the checks to make it routable.
