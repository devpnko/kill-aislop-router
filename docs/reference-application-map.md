# Part-by-part reference application

A reference is useful when it answers **which part, which task, which visual
detail, and why**. A whole-screen anchor and supporting component references are
different decisions. Do not assemble nine unrelated themes or impose a neutral
editorial theme on every product.

## Prepared study, not a project approval

On 2026-09-22, eight distinct archived UI frames from five products were visually
inspected through ordinary public UI Bowl pages. Native browser screenshots are
retained privately, with SHA-256 identifiers in the
[research map](../registry/reference-application-map.json); source pixels, assets
and copy are not shipped. No source-app behavior, mobile reflow, exact CSS
values, popularity ranking or human authorship was established.

| Part / task | Actual source frames | Useful observed cue | Do not infer or import |
| --- | --- | --- | --- |
| Search entry, category cards | [Magnific entry](https://uibowl.io/website?imgId=cmttckbdm0013kx04kb8voa19), [panel](https://uibowl.io/website?imgId=cmttckbeb0015kx04dcc9as7f) | Wide input above a grid; bounded mode/input panel; colorful task media on lower-emphasis surfaces | A media-search hero or icon rail is not a universal knowledge-search layout |
| Comparison table, empty selection | [CardGorilla populated](https://uibowl.io/website?imgId=cmr360f1y0010jt047oqepqjd), [empty](https://uibowl.io/website?imgId=cmr360eyd000qjt04zk847cz7) | Aligned item identities/actions and shared attribute rows; empty slots explain the next step | Financial claims, promotions, source assets, or exactly three target items |
| Tabs, metrics, local empty states | [Clarity dashboard](https://uibowl.io/website?imgId=cmt17w3iw001fjy04fiwqu9a6) | Separated context controls and local views; repeated value/label hierarchy; localized accent and empty state | A reader must become a dashboard; static filters prove functioning interactions |
| Sidebar, original and summary | [ClovaNote transcript/summary](https://uibowl.io/website/%ED%81%B4%EB%A1%9C%EB%B0%94%EB%85%B8%ED%8A%B8?imgId=cmpnujssg000dlb04d6sfajqk) | Labelled navigation; continuous original text beside bounded summaries; speaker/time context | Accurate summaries, working source jumps, recording features or approved target typography |
| Evidence card, claim inspection | [Facticity claim selection](https://uibowl.io/website/Facticity.AI?imgId=cmi7e3sgu000bl504ahcdkudz), [explanation and sources](https://uibowl.io/website/Facticity.AI?imgId=cmi7e3skq000jl504it0ys9ct) | Original context adjacent to claim details; title/excerpt/relation inside source cards | Truth, confidence, citation correctness or suitability of all-blue text/reward controls |

The map contains nine part entries: eight bounded studies and one explicit
responsive-layout gap. Repeated use of one frame does not increase its evidence
count. Facts are frame-bound, proposed explanations are labelled hypotheses,
and target craft is labelled adaptation, not extracted source CSS.

This study also rejects mismatches: the inspected Perplexity lead showed a
scheduling-entry preview, not the required evidence-reading task. A historical
Clarity popover link did not load an enlarged image in the current visit.
Neither is counted as fresh transferable evidence. ClovaNote and Facticity
provide contrasting reading structures, not a certified end-to-end search
reference. News/mobile/public-access coverage remains open.

## Use the map

From a checkout containing these files:

```bash
npm run reference:parts
npm run reference:parts -- --part comparison-table --json
node scripts/reference-application-map.mjs --part source-reader --json
node scripts/reference-application-map.mjs --part responsive-layout --json
npm run test:catalog
```

The same script works relative to an npm/plugin package that actually includes
it, independent of the calling directory. It is **not** a new native
`ksr reference parts` command or a claim that today's Mac installation has
updated. No network, capture, state write, selection or creator dispatch occurs.
Exit 0 means lookup succeeded, not that a design can start.

Each bounded part includes anatomy, material, edge, depth, typography, spacing,
color roles, imagery, motion, excluded transfers, target states and validation
questions. Unseen motion/compact behavior stays a target proposal.

## Apply to a real project

1. Read service planning: user, core job, content/data objects, states, trust
   boundaries, locale and devices. Inventory target parts before picking a look.
2. Find a fitting whole-screen anchor and named supporting sources. Use the
   [candidate catalog](reference-catalog.md) and this map as leads. Compare
   alternatives for uncovered tasks; do not stop merely because the first
   three sources were admitted, or chase a larger arbitrary quota.
3. Record a project-local application table: **target part -> source/frame ->
   observed cue -> intended benefit (hypothesis) -> concrete adaptation ->
   exclusion -> states/reflow -> verification**. Revalidate access, rights,
   frame identity and project fit. A row with missing evidence stays unresolved.
4. Harmonize adaptations into the project's authorized visual signature.
   Use one coherent type scale, spacing rhythm, color-role system, edge/radius
   family and elevation policy. Keep useful character and energy; harmonization
   does not mean making everything white, gray, flat or identical.
5. Use the existing independent reference flow and real Owner source/direction/
   color decisions. Named sources and private captures stay with research,
   critics and the Owner. Creators receive only the Router's existing aliased
   grammar and [component recipes](component-recipes.md), not this named map.
6. Implement actual component specs. Review the visible material/type/spacing/
   color transfer as well as hierarchy; execute target browser checks for
   native clicks, keyboard, states, clipping, overflow and compact reflow.
   Browser success is necessary evidence, not aesthetic or Owner approval.

Research ends for a batch when its named task/part coverage is sufficient or an
actual access boundary is reached. Here the bounded desktop study is complete;
same-product mobile and interaction evidence and any project-specific search
gap are not. Acquire those when the target needs them.

## Rights, compatibility and limits

UI Bowl's [content notice](https://uibowl.io/) does not grant a general reuse
license. This package supplies original analytical notes and public source
links only. A private study capture is not permission to redistribute pixels,
copy branded components or transplant another project's selection.

The map has its own [research schema](../schemas/reference-application-map.schema.json)
and cannot validate as a manual export, ready reference pack or executable
component recipe. No runtime contract, default exact-three route, planning gate,
visual authority, old ledger or installed plugin is changed. Research lookup
does not automatically force the existing discovery agent to compare a
sufficient set: coverage judgment and independent review are still required.
It also cannot guarantee a universally best source or a human-made appearance.
