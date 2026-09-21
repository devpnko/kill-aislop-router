# Verify reference delivery before design creation

A pushed feature branch, installed plugin version, scanner pass or browser pass
does not mean a creator received reference evidence. The package and the project
binding are separate checks. The router remains KillSlopRouter; UI Bowl is a
source, not a theme, model-training claim or child workflow.

## Check the exact executable

Use the bundled CLI in the selected plugin, not a different PATH installation:

```bash
node <plugin-root>/bin/killsloprouter.mjs capabilities --json
```

This reports package-local feature files and digests, including reference
intelligence, component craft, executed design browser proof, project onboarding
and account sync. `available` means bundled, not tested against a product, loaded
in a fresh model session, approved or granted network access. An older CLI that
does not recognize this command is not a verified reference-delivery build.
Do not fall back to an ordinary design run while claiming reference delivery.

## Resolve source intent before creation

For new visual exploration, propose reference-first from the actual product
brief before asking for a style, direction or palette. A missing `reference_pack`
is **unresolved**, not permission to generate without references. New `design
run`, its dry-run, unfinished resume and packet dispatch stop with exit 5 until
there is either a verified ready pack or an explicit scoped Owner opt-out.
No creator is spawned and no historical design state is rewritten at this stop.
Otherwise-valid historical status/provenance remain read-only and distinguish `reference-bound`,
`owner-opt-out` and `unresolved-historical` intent.

This is not a universal UI Bowl dependency: a scoped Owner opt-out is a distinct
supported path. The current reference-pack provider is UI Bowl; arbitrary URLs
or another provider do not bypass that contract. Approved-style bounded bug fixes continue through
the integrated audit/redesign route without unrelated research or new matrices.
An explicit UI Bowl request must use the required-reference contract below; do
not treat a generic “진행해”, continuation after compaction, “latest KSR”, a
browser pass, or an old no-reference run as a change of that request.

If the actual Owner chooses **no reference-derived design** for this scope,
record that real decision outside the child-writable `.design/` directory using
[`design-reference-opt-out.schema.json`](../schemas/design-reference-opt-out.schema.json):
version 1, matching `project_id`, `surface`, `screen_id`, `owner_id`,
`decision: "no-reference"`, the actual rationale and `decided_at` timestamp.
Do not invent this evidence to unblock the CLI. KSR checks scope, bytes,
physical file identity and independence from the parent and every declared
provider/known result actor, not the human's identity or authenticity of conversation.
Keep the source decision available for later resume.

Digest that file using the same CLI:

```bash
node <plugin-root>/bin/killsloprouter.mjs digest --target <real-owner-decision.json> --json
```

Bind it in a new brief (partial fragment; substitute its actual SHA-256):

```json
{
  "reference_opt_out": {
    "path": "../authority/no-reference.json",
    "digest": "sha256:<digest-of-the-real-decision-file>"
  }
}
```

The decision path is relative to the **brief's directory**, not `--root`.
`reference_opt_out` cannot coexist with `reference_requirement` or
`reference_pack`; a real Owner scope change needs a successor, not a retrofitted
active brief. New opted-out packets bind the decision digest and explicitly state
`source_derived_craft: false`. They keep the exact-three matrices, independent
critics, browser proof, Owner shortlist, palette and final approval gates.
The packaged example decision is synthetic teaching/test material, not a
decision for any real project; copying it does not create Owner authority.

## Make an explicit reference request durable

When the Owner requests UI Bowl / released-product reference-derived design,
record the requirement in a **new** design brief:

```json
{
  "reference_requirement": {
    "mode": "required",
    "required_recipe_families": ["comparison-table", "result-card"]
  }
}
```

This fragment is not a complete runnable brief. Use only the families the target
actually needs. A hierarchy-only request may use an empty family array; a request
for card/table appearance must include the applicable craft families. The
reference brief must request the same families through
`coverage.required_recipe_families`. Generic "bright", "clean", or "human-like"
instructions and `aesthetic_sources` strings do not satisfy this requirement.

Follow [reference intelligence](reference-intelligence.md) and
[component recipes](component-recipes.md): bind external planning/rights, actual
source captures, independent research/review and a real Owner reference choice.
Bind the completed `reference_pack` and exact producer state in the new brief.
Required recipe families must exist in the selected verified grammar. Creator
results must apply each required family, not mark it all `not-applicable`.

```bash
node <plugin-root>/bin/killsloprouter.mjs design run \
  --brief .killsloprouter/design-brief.json --baseline <artifact-directory> \
  --host-config .killsloprouter/host-adapters.json --root <project-root> \
  --require-reference --dry-run --json
```

`--require-reference` is an assertion that the durable brief already declares
the requirement, not an implicit mutation or an approval. Missing binding or
selected craft fails before creator execution. Omitted adapters remain
`manual_pending`. Once bound, the original brief digest preserves the requirement
across resume even without repeating the flag. Tampering fails closed.

With an eligible dry-run, use the same arguments without `--dry-run` and add
`--out .killsloprouter/design-run.json`. Preserve the independent critic/browser,
exact-three direction matrix, real Owner shortlist, color matrix and final exact
artifact approval. The creator receives transferable craft and reasoning, not
source assets, copy or pixels. This is not permission to clone a released UI.

## Present references before asking for a design decision

The plugin should bring the reference choices to the Owner, not require the
Owner to discover a research command. For a new visual direction, explain the
reference-first option from the actual product brief. An explicit UI Bowl
request makes that requirement durable as above; it does not grant source
access, pick a design, or authorize a copy. An approved-style bug fix does not
need unrelated reference research. An existing no-reference run stays historical.

After independent reference review and coverage pass, use:

```bash
node <plugin-root>/bin/killsloprouter.mjs reference choices \
  --run .killsloprouter/reference-run.json --json
```

Present a compact comparison in the user's language: actual source link and
screen, product/task fit, what hierarchy and component treatment to transfer,
tradeoffs, and what remains unobserved. Explain the leading ranked candidate
as a recommendation, not a selection. Include recipe responsive variants' basis:
`target-proposal` is not an observed mobile reference. Unknown popularity is
not a measured zero or a claim of popularity. Do not substitute synthetic
fixture/example products for real project evidence. The Owner can inspect the
observed source links through normal authorized access; this command neither
opens a browser nor exports/copies source pixels.

The read-only report verifies the canonical state, results and bound evidence.
It shows no selectable candidates before review/coverage pass and includes
`can_select`, selection-scope/state digests, source links, verified grammar IDs,
capture gaps and recorded anchor/support roles. `reference run` and `reference
status` text output also surface the choices automatically; their JSON state
shape is unchanged. A successful `choices`/`status` read is not a successful run
or permission to create. The report is Owner-facing, never a creator packet.
`selection_requirements` includes the coverage and diversity constraints needed
to make a valid choice. `next_step` distinguishes an unfinished producer after
a recorded choice from a completed pack: a crash checkpoint must resume/recover
without selecting again, while a metadata-only completed pack needs a successor
with the missing capture evidence. Neither can start a creator.

### Recover a coverage stop without retrying accepted work

When all three research results are accepted but coverage fails, `choices` and
text `status` report `next_step: successor_coverage_research`. The additive
`recovery` projection lists accepted/unresolved packets and the exact coverage
blockers. Accepted results cannot be replaced, and `--retry all` does not rerun
them. Preserve the original run/export/evidence; supplement the missing evidence
in a separate successor brief/export, preflight it with `reference run --brief
NEW_BRIEF --host-config HOST --root PROJECT --dry-run --json`, then start with a
new `--out`. Regenerate packets/results and obtain independent review before
presenting the new real Owner reference selection. Do not lower coverage,
invent mobile observations, or substitute another style for an explicit UI Bowl
request. An ordinary no-reference alternative requires an actual Owner change
of scope, not just a disclaimer.

Reuse still-valid external planning, research and rights authority when it
actually covers the follow-up. A successor is not itself a reason to demand a
new work authorization or restart unrelated planning. Missing/no-longer-valid
authority or expanded source access/scope does require its own authority. New source selection remains a real Owner
gate; prior selections and approvals are not transplanted.

The additive `registry_comparison` distinguishes canonical JSON content digests
from source-file byte digests. A pretty-printed run snapshot may have different
file bytes from the bundled registry while its canonical contents match; that
alone requires no migration. A genuine content change is reported separately:
unfinished runs still verify their pinned snapshot, while pack compilation and
design consumption require the current bundled registry. Never rewrite a bound
snapshot to make it match. This comparison does not authorize resume or bypass
an active lease. Both projections are read-only diagnostics, not signed state,
new grants or creator inputs; existing receipt/state JSON is unchanged. An
exit-zero `choices` read still does not mean the run or coverage passed.

Ask the real Owner for **one anchor, one to four supports, and the transferable
grammar**. Keep the cross-product/category/ecosystem rule and existing
[selection template / resume procedure](reference-intelligence.md). Do not
submit its prefilled ranking as if the Owner selected it. Reference selection
does not approve direction, palette or the rendered artifact. Metadata-only
research may finish but capture readiness must still pass before design starts.

At the later direction, color and exact-artifact review, show the recorded
sources and the **intended** transfers again. Pair them with candidate-specific
rendered/independent/browser evidence; provenance alone cannot establish that a
card, table, hierarchy or responsive behavior was applied successfully. Creators
still receive only the existing anonymized grammar/recipe projection, never
this source-identity-bearing Owner report. Reopening `choices` or `provenance`
after compaction does not select, reapprove, reexecute or mutate anything.

## Report what was actually delivered

```bash
node <plugin-root>/bin/killsloprouter.mjs design provenance \
  --run .killsloprouter/design-run.json --json
```

The read-only report revalidates the run, shows `bound` versus `not_bound`, pack
digest, source providers, selected/required recipe families and bound creator
packet counts. It is not a signed state replacement, execution count or visual
approval. Default text status also names unbound reference delivery. Keep the
original signed state JSON unchanged; use this separate report for summaries.
The additive `selected_references` list and text output show selected source
links, anchor/support roles, fit rationale and intended grammar/recipe transfers
throughout the design journey, including its final-artifact stop.

If a historical run used no reference, retain its artifacts and Owner selections
as history. Do not insert a pack, relabel its candidates, transplant its approvals
or silently rerun an active color stage. Historical status/provenance inspection
is compatible, but unfinished creation/resume/dispatch now requires a successor
with a ready pack or genuine scoped opt-out. Completed receipts are not revoked;
resuming a completed run remains a verified no-op. Explicit lease crash recovery
can still reconcile its old checkpoint; it does not grant new design dispatch.
A successor can consider the Owner's
earlier preferences, but needs its own reference selection, candidate review and
exact-artifact decisions. No product edit or old-run migration is automatic.

## Delivery and installation boundary

This integration combines the previously separate reference/component and
onboarding/account-sync branches. Check both package features and project
provenance; updating only an onboarding branch cannot supply reference craft.
Package checks exercise a clean npm consumer and isolated plugin installation.
They do not replace review approval, a separately scoped global installation or
real per-account fresh-thread acceptance. Do not merge, publish, install globally
or rewrite active host adapter digests merely because the tests pass.
