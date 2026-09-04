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
- downstream creator: receives the compiled grammar pack, never source pixels.

## Why popularity is useful but subordinate

Popularity is a strong prior among references that solve the same kind of
problem. It is not a universal design score. A high-MAU shopping home page is
not better evidence for a dense evidence-review console than a lower-traffic
screen with the correct user, task, trust, density, and state model.

KillSlopRouter therefore sorts in this order:

1. hard eligibility: provenance, rights, independent verification, and
   anti-copy safety;
2. product-fit band: `exact`, `adjacent`, then `weak`;
3. weighted popularity score inside the same fit band;
4. fit score and stable reference ID only as tie-breakers.

Each popularity signal includes its metric, raw value, normalized 0–100 score,
scope, category, as-of timestamp, and evidence. The router computes the
weighted score from the brief. Popularity cannot change eligibility, waive a
hard gate, or make an owner decision.

## Input contract

Start with
[`examples/reference-brief.example.json`](../examples/reference-brief.example.json)
and validate the shape against
[`schemas/reference-brief.schema.json`](../schemas/reference-brief.schema.json).
The runtime additionally re-hashes every authority file.

The brief requires:

- explicit owner activation for bounded reference research;
- at least one external `service-planning-gate` receipt and the gate IDs that
  must already be `passed`, `approved`, or `locked`;
- a product frame: user, job, screen family, main object, core task, trust
  risk, density, states, and success metric;
- bounded UI Bowl queries by pattern, component, app, or OCR term;
- reference-use rights evidence with redistribution and downstream creator
  pixel access both disabled;
- minimum coverage for component families, UI patterns, and grammar
  dimensions;
- distinct discovery, grammar, and critic providers.

`manual-export` is the safe default. KillSlopRouter V1 does not bundle a UI
Bowl scraper or silently activate an MCP server. Use
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

1. `reference-discovery` records source-linked observations, exact provenance,
   rights, and popularity signals;
2. `reference-grammar` separates observed facts from confidence-labelled
   inference and extracts transferable hierarchy, navigation, component,
   comparison, evidence, typography, color-role, density, interaction, and
   responsive grammar;
3. `reference-review` independently verifies the evidence, individual
   component families and patterns, product fit, popularity basis, and copy
   risk.

All providers run as internal KillSlopRouter participants. The first two have
the `researcher` role and the last has `critic`; no child becomes the active
workflow. Providers and returned actors must be distinct. A high-reasoning
model such as Fable 5.1 can be bound through an explicit digest-locked
`agent-json-v1` host adapter for discovery or grammar analysis. Use a separate
provider identity and fresh actor for the critic. KillSlopRouter does not ship
or infer that external adapter, its credential, or its network permission.

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
presented as new work. Manual evidence must be stored in the submitted result
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

At least one support must come from a different product. This does not prove
novelty by itself, but it prevents a single source from becoming a disguised
clone specification.

## Output boundary

The completed
[`reference-pack.schema.json`](../schemas/reference-pack.schema.json) contains:

- the unchanged service-planning product frame;
- selected source links and popularity provenance;
- owner-selected, critic-verified transferable grammar;
- the complete discovery/grammar/review/selection digest chain;
- `authority_scope: discovery-evidence-only`;
- explicit false values for source-pixel inclusion, visual authority, visual
  signature authority, and design creation.

The pack intentionally excludes capture paths and source pixels. It cannot be
copied into a profile as an approved visual intent or signature. A later
bridge may add it to design-exploration methodology sources, but only after
the design-exploration V2 base is committed and reviewed. Until then, use the
pack as research evidence while keeping the current exact-three 3×3 route,
Playwright evidence, owner shortlist, color exploration, and final owner
approval unchanged.

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
