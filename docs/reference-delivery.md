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
or silently rerun an active color stage. A successor can consider the Owner's
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
