# Component craft and responsive recipes

Layout reasoning alone is not an implementation brief. Creators also need the
surface, edge, depth, type, spacing and color relationships that make a component
feel deliberately designed. Responsive work preserves that craft while changing
composition, not just scaling a desktop screenshot down.

This optional extension uses the existing `reference -> design` workflow.
KillSlopRouter remains the orchestrator, not a UI creator or a human-authorship
detector. Browser success and zero scanner hits are not aesthetic approval.

## Collect concrete craft

Attach `component_recipe` to a grammar principle. See the
[schema](../schemas/component-recipe.schema.json) and
[table example](../examples/component-recipe.example.json) and
[card example](../examples/component-card-recipe.example.json). Both are
synthetic teaching material, not extracted UI Bowl screens or approved themes.

- Anatomy: semantic part IDs, roles, visual priorities and treatments.
- Eight visual aspects: surface/material, edges/radii/strokes, elevation,
  typography, spacing/alignment, color roles, imagery and motion. Explain a
  deliberate absence rather than leaving fields blank.
- Character to retain and coherence with the surrounding product. Do not erase
  intentional color, depth, media, density or expressive type for a generic
  anti-slop preference.
- Rest, hover, focus-visible, active/selected and disabled treatments. Explain
  inapplicable states for noninteractive parts; no hover-only essential access.
- Compact, medium and wide compositions. Every part is preserved or deferred
  behind a named access path. Primary decision/comparison parts cannot be
  deferred. A table may retain bounded accessible scrolling; converting every
  table to cards is not a rule.
- Long localized content, numerals/units, partial/missing data, and behavior
  between named sizes. Do not fit content by shrinking readable text.

For cards, scrutinize image crop, title/number/caption proportions, badge/action
placement, grouping gaps, surface separation and focused/selected appearance.
For tables, scrutinize header weight, row rhythm, numeric alignment, group vs
row separators, selection and expansion. These are visual decisions, not an
instruction to make every product sparse or neutral.

Recipes require non-promotional capture observations; metadata/popularity alone
cannot establish craft. An `observed` responsive variant cites observations
already bound to its grammar. One screenshot does not prove another width or
interaction: label unseen adaptations `target-proposal` with empty observation
IDs. The independent reference critic must reject semantic overclaims; a valid
citation alone does not prove responsive behavior.

Recipe treatments are transfer proposals, not claims that source behavior was
executed. In particular, static captures cannot prove hover, focus, motion,
keyboard handling or reduced-motion support. Keep such source facts in verified
observations only when actually evidenced; otherwise specify target behavior
to implement and verify later.

## Request the extension

Keep existing planning, rights and Owner activation. Extend the reference brief
coverage with the families actually needed. This is a partial brief fragment:

```json
{
  "coverage": {
    "required_component_families": ["result-card", "comparison-table", "tabs"],
    "required_recipe_families": ["result-card", "comparison-table"]
  }
}
```

Required recipe families must also be required component families. The grammar
packet requests the recipes; coverage blocks without independent verification
of their grammar, observations and families. Owner selection must include them.
A plain hierarchy principle cannot silently satisfy a craft requirement.

Use existing commands; there is no arbitrary component-install command:

```bash
killsloprouter reference run --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json --root "$PWD" --dry-run --json
killsloprouter reference run --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json --root "$PWD" \
  --out .killsloprouter/reference-run.json --json
```

Follow [reference intelligence](reference-intelligence.md) for independent
results, real Owner selection and completed producer/pack binding. Missing
adapters remain `manual_pending`. Insufficient source captures still block
reference-backed design. Do not author approvals or claim research ran.

## Creator handoff and rendered specimen

The creator-safe projection retains transferable treatments and fact/proposal
labels, removing observation IDs. Source identities, URLs, pixels, capture
paths, assets, copy, exact source style literals and source-access permission
still do not reach creators. This does not authorize source-code imports or
screenshot redistribution. Licensed code reuse needs separately reviewed
permission and project integration; popularity is not a license.

Direction and color packets include a derived, digest-bound
`component_recipe_contract`: aliased grammar IDs, recipe digests and required
project states/viewports. It includes a self-contained schema and schema digest;
all schema references are expanded so a fresh child in its output directory
needs no package-relative file access. Creators return `component_specs` inside existing
`design-contract` evidence JSON; see the
[specification schema](../schemas/component-specs.schema.json).

An applied specification binds the exact recipe digest, rationale, actual
target values/tokens for all eight visual aspects, part selectors in the
executable prototype, responsive mappings for every required viewport, every
required product state's treatment, interaction treatments, content stress
cases, between-size behavior and cross-component coherence. The prototype is
the rendered specimen, not an unrelated screenshot. Target CSS measurements,
colors and fonts are allowed here: prohibiting copied source literals does not
prohibit concrete implementation values.

Three named project viewports are required before creation. A configured
official browser must declare three distinct widths, not aliases for one
desktop size. Browser ingest/resume checks range ordering against executed host
authority. The existing official state/locale/viewport proof matrix remains
mandatory. Project scenarios should exercise actual selectors, keyboard actions,
overlays, meaningful assertions and stress cases. KSR does not invent product
interactions or grant live mutation rights.

Every selected recipe needs a disposition. `not-applicable` requires a target
reason and forbids implementation claims. Discarding every recipe blocks:
select fitting references instead of calling a generic replacement craft-ready.

## Independent visual gate

Recipe-backed direction and color reviews add `component-craft-and-reflow` to
the unchanged fixed reasoning checks. It requires typed, digest-bound
`component-craft-spec` (candidate design-contract), `prototype`,
`playwright-evidence` and independent `review-report` bindings.

The critic inspects the actual specimen: are parts present, do the specified
type/spacing/depth relationships render, is project character retained, and do
size/state/focus/pointer paths work? Reject incompatible style collages,
generic flattening, lost comparison axes, unreadable labels and blocked actions.
Missing evidence is not a pass even when the specification is persuasive.

KSR verifies shape, provenance, digests, state/viewport coverage, range order
and participant independence. It does not numerically prove taste, inspect
every CSS value itself or certify human authorship. Intermediate-width,
selector-level and specific interaction correctness require supplied scenarios
and critic evidence; listing a stress case is not proof it ran. Failed craft
checks require hard blockers. Creator testimony cannot replace independent
review, and review cannot replace Owner choice.

Use one coherent project visual family. Shared components become candidates
for an approved library only through the existing G6T/G7-gated `systemize`
route, not through research or specimen generation alone.

## Compatibility and rollout

- Recipe and required-family fields are additive and opt-in. No-recipe briefs
  retain the prior exact-three 3×3 route, check sets, packet shape and viewport
  minimum. Old Router versions may reject the new optional fields.
- Once selected, recipe bytes are covered by existing grammar, pack, projection,
  packet, evidence and final review-result hashes. Missing specifications or
  mismatched recipe digests fail closed. Incapable adapters remain pending or
  blocked; do not pretend they support the new contract.
- Never retrofit completed packs, active ledgers or approvals. Start a new
  reference run from verified external authority, obtain fresh selection and
  bind its new pack to a new design run. Keep old evidence historical.
- This development does not install global plugins, migrate shims, modify an
  approved product baseline or authorize publication/merging.
