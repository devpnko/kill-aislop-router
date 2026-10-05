# Target component craft coverage (v1)

This is a KSR routing/validation extension, not a creator, style preset, beauty
score or permission to copy a reference. It uses the existing
`component_recipe_contract`, `component_specs`, `component-craft-and-reflow`
review, official browser proof, immutable design run and external Owner stops.

## What was missing

Three supplied recipes can retain all 24 visual-aspect strings while an intended
card, badge or action has no mapped treatment. A row can legitimately inform a
card: changing the family label is not the remedy. Inventory the **target parts
and their relationships** and distinguish extracted support from invention.

New `design run` and `--dry-run` with selected recipes now require
`component_craft` and a [separate visual-goal contract](visual-goal-feedback.md)
in the design brief. Missing coverage stops before any creator
dispatch. Version 1 of the field is described by
[the contract schema](../schemas/component-craft.schema.json).
The [synthetic example](../examples/component-craft.example.json) binds the
bundled teaching recipe, not a real source or an approved project direction.
Replace its inventory and binding with the actual verified projected recipes.

- `parts`: semantic target IDs and roles. Each binding is either `recipe`
  (projected grammar ID, exact projected recipe digest, recipe anatomy IDs) or
  `target-invention` with a rationale. An abstract principle is not a recipe.
- `relationships`: target part IDs, affected visual aspects, concrete expected
  combination, recipe/invention binding and an explicit decision. Together the
  declared relationships must address surface, edge/depth, internal type,
  spacing and color. A deliberate lack of depth is a treatment, not a blank.
- Each `decision` records `preserve`, `adapt` or `replace`, its basis, rationale,
  target treatment, preserved properties, changed properties and evidence IDs.
  State relative contrast, accent area/placement, state separation, badge and
  control differentiation and coupled material treatment. Changing hue while
  preserving those properties is valid; literal color equality is not a check.
- `constraint_evidence`: digest-bound target JSON documents inside the brief's
  lane, scoped to relationship IDs. Functional, accessibility or approved-brand
  claims need such evidence. Parent preference is an explicit separate basis;
  it is never silently promoted into a hard project constraint.

Evidence pins establish bytes and scope, **not the truth of a constraint or Owner
approval**. An independent reviewer must assess that claim under existing visual
authority. A purported brand approval cannot create a new Owner gate. Creators
receive the neutral obligation and evidence ID/digest/scope, not constraint file
paths or contents. Reviewers get the target evidence descriptors. Constraint JSON
is checked against the reference identity firewall and re-read at dispatch,
ingest and resume; no new source access is granted. Keep these evidence files
outside both the creator-readable baseline and the child-writable run directory.
The final packet must retain the exact reviewer descriptors; creator/browser
packets must not contain them. A re-sealed packet cannot widen this access.

To inspect aliases before writing the brief, use the source-neutral projection
from the same KSR package that will run the journey. With an already verified,
locally owned selected pack, the existing module APIs are:

```js
import { referenceProjection } from './src/reference-projection.mjs';
import { selectedComponentRecipes } from './src/component-recipes.mjs';
const recipes = selectedComponentRecipes(referenceProjection(verifiedPack).transferable_grammar);
```

This projection is not validation or reference selection; do not fabricate a
ready pack, reuse another project's choices, or send raw pack/source captures to
a creator. `verifiedPack` must come from the existing verified reference journey.

## Creator and reviewer handoff

The final direction/color/reviewer packet carries
`component_recipe_contract.target_craft`: neutral obligations, original contract
digest and closed implementation/review schemas. KSR compares it with the brief
before dispatch, child execution, ingest and resume. Re-hashing a shortened
packet cannot hide missing obligations. Outside free-form commentary is not
parsed as authority: PMs must reconcile conflicting style instructions with the
typed decisions instead of adding a competing "quiet/flat" preset.

The creator keeps the existing eight-aspect `component_specs` and adds
`design-contract.component_craft` using
[the implementation schema](../schemas/component-craft-implementation.schema.json).
It supplies every target selector, the exact decision digest and concrete actual
treatment for every relationship. No relationship can silently change from
preserve to replace. Every recipe bound to a target part/relationship must remain
`applied` in `component_specs`; an unrelated applied recipe cannot mask disposal.
A justified new decision requires a new scoped design
brief/run; it does not automatically require unrelated service replanning or new
reference selection when the verified pack/authority still fits.

Both direction and color independent reviews add `component_craft_review` using
[the review schema](../schemas/component-craft-review.schema.json). For each
candidate it binds the exact creator/browser result digests and:

- Actual presence of every part at each required viewport/state, with the exact
  candidate screenshot digest and a specific observation note.
- Whether each expected relationship survives at those dimensions, plus whether
  the claimed adaptation/constraint is supported and why.

These observations must agree with `component-craft-and-reflow`. An absent part,
unsupported adaptation or failed relationship requires its existing hard blocker.
Missing review cannot become a pass via browser success or sibling ranking.
Creator/reviewer identity separation and all existing source, browser, privacy,
locale and Owner gates remain intact. A scoped craft pass is eligibility only;
it neither certifies improvement over the prior design nor predicts Owner taste.

Review target renders against neutral obligations. Current source-aware purposes
remain exactly promotional-citation-firewall and source-composition-independence;
they **do not permit or certify source-level craft parity**. Report that limit.

## Compatibility, recovery and honest evidence

Old brief/run/receipt bytes remain unchanged. Historical runs without the field
retain their previous checks and packets. Derived `reference_delivery.target_craft`
reports `legacy-unassessed`, not a new craft pass. Bound runs report
`bound-review-required`; that is not a review verdict. Do not retrofit old state.
No-recipe and genuine Owner-opt-out flows retain their existing behavior.

For missing mapping, complete the intended part/relationship inventory first.
For missing extraction, record target invention honestly or return to reference
research for the missing treatment. For altered pins or decisions, preserve the
rejected artifacts and prepare a scoped successor. Do not regenerate nine
variants merely to escape a material finding. An incomplete candidate can be
shown as a draft; the optional [single-specimen checkpoint](visual-goal-feedback.md)
provides early official evidence and independent feedback, not automatic approval.

Deterministic tests inject independent-review messages to prove binding and
failure propagation. They do **not** demonstrate an actual critic discovering a
visual defect. A separately inspected rendered example, full browser regression,
package verification and installed delivery must be reported separately. The
unresolved browser lifecycle incident is not fixed by this feature.
