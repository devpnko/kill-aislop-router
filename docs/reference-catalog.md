# Representative reference candidate catalog

KillSlopRouter starts discovery from a reusable catalog, then researches the
target's missing coverage. It does not keep one approved theme for every product
or restart unbounded browsing for every iteration. The unit of reuse is a
source-linked research lead and a bounded transfer hypothesis, not a copied UI.

## What is prepared

The [machine-readable catalog](../registry/reference-candidates.json) indexes
30 named product candidates across 14 task families. These are not 30 ready
reference packs or 30 freshly inspected products:

| Evidence level | Candidates | Meaning |
| --- | ---: | --- |
| `study-listed` | 7 | Included in the historical corpus, but no product-specific operational observation is carried here |
| `historical-summary` | 17 | Bounded observations from the 2026-09-04 study; exact per-product frame closure is unavailable |
| `historical-frame-notes` | 6 | Dated 2026-09-10 notes with 19 exact frame links, not retained capture bytes or freshly verified source behavior |

There are **zero ready project packs and zero newly visually inspected source
frames in this historical index**. The separate
[2026-09-22 part application study](reference-application-map.md) adds eight
visually inspected frames across five products without retroactively promoting
these dated entries or closing their whole-product gaps. Source study bytes are SHA-256 pinned.
The six-product notes and frame index are retained unchanged, with their original
dates and limitations. The first study's aggregate 48 screens are not assigned
to individual entries, added to the 19 links as new evidence, or presented as
current capture coverage. Related products such as Toss and Daangn variants
share an ecosystem key; multiple names do not prove independent design families.
Catalog IDs and ecosystem keys are local indexing labels, not source-native IDs.

| Task family | Candidate starting points | Important limit |
| --- | --- | --- |
| `news-reading` | New acquisition needed | A dashboard or editorial shop is not evidence for a news reader |
| `knowledge-search` | New acquisition needed | Search, long-form reading and provenance must be seen together |
| `comparison` | CardGorilla, Npay property, Skyscanner, Recatch | Financial/travel/CRM conditions do not transfer automatically |
| `operations` | Museby, Daangn Business, Toss Business, POS tools | Keep empty onboarding distinct from dense mature operations |
| `analytics` | Clarity, InOut, Daangn Business, Pandarank | Metrics require denominators, time and real evidence paths |
| `commerce` | Instacart, 29CM, Kurly, POS tools | Discovery and repeated fulfillment need different rhythms |
| `maps-travel` | Socar, Naver Travel, Yeogi, Skyscanner | Preserve location/conditions only when the target task needs them |
| `conversation` | Daangn, WeChat, Jandi, Moodee | Conversation, permissions and emotional expression are distinct jobs |
| `creation` | CapCut, Museby, Jandi, Pandarank | Output preview and cost/state matter more than a generic AI input |
| `learning` | Duolingo, Planfit lead | Feedback must have a truthful task/state model |
| `health` | InOut; Planfit/My Doctor leads | Weak coverage; no safety or clinical inference |
| `forms-permissions` | Toss Business, WeChat, Npay property; Slack Admin lead | Draft, consent, approval and submission cannot collapse into Save |
| `expressive` | 29CM, Moodee, Duolingo; Rround lead | Expressive material is not a universal style or a copying license |
| `public-access` | New acquisition needed | Calm styling does not prove accessibility or senior usability |

Family and component tags are **researcher-proposed search facets**, not
independently verified source classifications or target fit scores. Recheck the
actual frame before claiming an applicable pattern. Study listings and promotional
screens cannot establish an operational hierarchy. Style contrast is useful, but
changing only hue or typeface does not establish structural diversity.

## Look up candidates offline

From a checkout containing this catalog:

```bash
npm run reference:catalog
node scripts/reference-catalog.mjs --family comparison --json
node scripts/reference-catalog.mjs --component comparison-table --json
node scripts/reference-catalog.mjs --platform mobile --query 대화 --json
node scripts/reference-catalog.mjs --family news-reading --json
npm run test:catalog
```

The script resolves data relative to its package, not the current directory. In
a package or plugin that actually includes it, the same command can be called as
`node <package-root>/scripts/reference-catalog.mjs ...`. Do not assume an older
installed bundle has the new file. This is deliberately an offline research aid,
not a new `ksr reference catalog` CLI subcommand or automatic source acquisition.
The script uses no network, selects nobody, writes no state or receipt, and
never dispatches a creator. A zero-result query stays empty with discovery
routes and gap actions; it does not substitute a familiar theme. Lookup exit 0
means only that the catalog was read successfully.

## From reusable leads to a project reference pack

1. Read the product frame: user, job, core object, screen, trust risk, density,
   locale, device and required states. Query by task first, component second;
   popularity cannot move a weak match ahead of a fitting one.
2. Inspect several genuine task-fit candidates and a contrasting product or
   ecosystem. The catalog supplies leads, not a preselected anchor. Research
   missing families instead of forcing the closest familiar app onto the task.
3. Reopen exact product/frame links through normal permitted UI. Recheck
   identity, date, access and usage scope. Create the actual bounded
   project-local manual manifest and private source evidence described in
   [reference intelligence](reference-intelligence.md). Do not treat a bookmark,
   this JSON, or another project's captures/Owner choice as an export or grant.
4. Record visible facts separately from inferred reasons and target proposals.
   Collect core task plus meaningful alternate/empty/partial/error states;
   two scroll positions do not prove two states. Record device widths actually
   observed. Unknown mobile behavior stays unknown.
5. For card/table appearance, extract [component recipes](component-recipes.md):
   anatomy, material, edge, depth, type hierarchy, spacing, color roles, imagery,
   state treatment and responsive limits. Do not call a few hierarchy adjectives
   applied craft. This catalog has no extracted, capture-verified recipe.
6. Run the existing independent discovery/grammar/critic flow. Present verified
   choices to the real Owner; then lock that project's anchor/supports/grammar
   and ready pack. Default UI Bowl requirements, exact-three design exploration,
   source-recipient separation, browser proof and Owner stops are unchanged.
7. Reuse that exact project pack while its scope/evidence remains valid. Re-search
   only a changed requirement, stale/unavailable evidence or a demonstrated
   coverage gap. Never silently mutate old packs, states or approval lineage.

The named catalog is researcher/critic/Owner material. A downstream creator still
receives only the existing anonymized grammar/recipe projection through the
Router. The catalog is rejected by the existing export and pack validators.

## Acquisition boundary and next coverage

During the initial catalog pass on 2026-09-22, the public [UI Bowl taxonomy](https://uibowl.io/explore) and
15 discovery entry URLs were checked as page text. This confirmed navigation
paths, not the visual content of a source frame. Some text was cached, and the
CUA browser tool failed to initialize; no logged-in session, membership access,
new screenshot, hidden endpoint, MCP or exporter was verified. Search snippets
were not promoted into source observations.

The subsequent part study used the working ordinary CMUX browser UI. The CUA
failure was not a site-access failure; the later inspected source frames are
recorded separately, not relabelled historical notes. No hidden endpoint or
membership bypass was used.

The next useful collection is reading/search/detail/source evidence, followed by
same-product state/responsive coverage and concrete component craft. Public and
inclusive-service cases remain an explicit gap. Each backlog item has a
`done_when` criterion; no arbitrary corpus size certifies completeness. Stop a
collection batch when the target's actual coverage is adequate or a genuine
access/rights boundary is reached, not when a predetermined screenshot count is
filled. Never change accounts or bypass a restriction to complete a row.

UI Bowl's [rights notice](https://uibowl.io/) retains content rights with the
relevant owners/providers. This repository contains original summaries and
source links, not screenshots, assets, source copy, account data or a general
reuse license. Project-private capture scopes are not widened by this catalog.
Current popularity is not measured here; when appropriate, the existing
[fit-only policy](reference-fit-first.md) records evidence-bound unavailability
instead of inventing numbers.

### Korean-familiar first acquisition batch

The separate [2026-09-22 Korean-familiar study](research/ui-bowl-korea-familiar-30-2026-09-22.md)
adds 30 visually inspected archived frames from ten product/surface groups,
including six explicitly adjacent help/merchant-tool frames. It records five
ecosystems, source-displayed (not independently verified) MAU, excluded promotion
groups and actual remaining coverage. It does not turn this historical catalog
into 30 ready packs or a national popularity ranking. The new index is research
intake pending independent review, not creator input or automatic runtime routing.

The additive [component deep study](research/ui-bowl-korea-component-study-2026-09-22.md)
then analyzes the same 30 retained frames into 14 component entries and 89 parts,
with 65 proposed application checks. Its recipes use the existing component
contract, but remain non-authoritative adaptations: no source interaction or
responsive execution, no project-ready pack, no installed runtime promotion.
The original intake stays unchanged; the separate manual peer-review record
pins the detailed study rather than retrospectively approving the collection.

## Compatibility and delivery

The catalog/schema/query tool are additive discovery preparation. The existing
`human-design-reasoning.json`, default exact-three route, authority model,
runtime routing, project ledgers and provider commands are unchanged. No model
training, project design approval, global installation or automatic loading in
every current session is claimed. Package tests verify the offline tool in a
clean npm consumer and isolated plugin; delivery to the actual Mac remains a
separate reviewed installation step.
