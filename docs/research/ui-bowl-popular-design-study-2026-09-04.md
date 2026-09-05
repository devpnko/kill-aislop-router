# UI Bowl popular-product design study

This is a dated, rights-safe research record for KillSlopRouter's optional
reference-intelligence stage. It contains observations and hypotheses, not
visual authority, source assets, or Owner approval.

## Method and limits

- Source: [UI Bowl](https://uibowl.io/), including its public mobile and PC
  product lists, pattern/component taxonomy, MAU sorting, and bookmark sorting.
- Snapshot: 2026-09-04.
- Sample: 24 released products and 48 screens, balanced across 12 mobile and
  12 desktop products.
- Cohorts: high bookmark, high reach, and task-fit challenge cases.
- Inspection: temporary local copies were viewed only for analysis and were
  not committed, packaged, or supplied to a creator.
- Review: Fable 5.1 inspected four contact sheets read-only with explicit
  instructions to separate observation from inference and grant no approval.

UI Bowl says its collection is updated from released products and exposes MAU,
bookmark, category, pattern, and component discovery. Its copyright notice
leaves rights with the relevant rightsholders or providers. This study
therefore transfers only abstract relationships. It does not reproduce source
screens, copy, assets, exact colors, typefaces, dimensions, or layout recipes.


Static screenshots do not reveal private design intent, usability tests, or
conversion results. Every explanation below is a hypothesis with bounded
confidence. Popularity is a search prior, not a quality label.

## Corpus

| Platform | Products | Why present |
| --- | --- | --- |
| Mobile | Daangn, InOut, Rround, Planfit, Yeogi Eottae, Socar | High-bookmark Korean consumer products plus category and task contrast |
| Mobile | 29CM, My Doctor, WeChat, CapCut, Duolingo, Instacart | Editorial commerce, trust, utility, expert-tool, learning, and fulfillment contrast; several high-reach products |
| Desktop | Toss Business, Toss POS, Toss Payments, Tagby, Payhere POS, Recatch | High-bookmark B2B and operator workflows, forms, support, payments, and pipeline state |
| Desktop | Kurly, Jandi, Pandarank, Slack Admin, Naver Travel, Skyscanner | Commerce, AI work entry, support, multi-session discovery, and comparison contrast |

At snapshot time, examples from the queried popularity lists included Daangn
(841 bookmarks), InOut (807), Toss Business (622), Toss POS (356), Toss
Payments (285), WeChat (1.38B MAU), CapCut (300M), Instacart (280M), Slack
Admin (79M), Naver Travel (36M), and Skyscanner (32.6M). These values are
scope- and record-specific. One endpoint also surfaced an older Toss record
with a bookmark value inconsistent with the current app-list record. KSR must
therefore bind metric, product-or-screen subject, subject record ID, scope, and
snapshot time and rank conflicted popularity last within its product-fit band.
A product-level signal repeated under several screens is still one claim: its
canonical fields and product-subject evidence must match or the records remain
conflicted.

## What the screens actually teach

| Reference family | Direct observation | Likely product reason | What breaks if flattened or copied |
| --- | --- | --- | --- |
| Daangn transaction chat | Object context, peer trust, conversation, and payment action share one surface | Negotiation and commitment form one continuous peer-to-peer task | Moving payment away loses context; copying its trust metaphor would borrow brand meaning |
| InOut statistics | A plain-language daily answer precedes charts; current values receive selective emphasis | Non-expert users first ask “how am I doing now?” | Equal chart emphasis removes the answer; copying the chart set ignores target data |
| Toss POS and Payhere | Amount or order state dominates; common payment branches are visually equal; accounting detail remains available | Arm's-length, time-pressured operation makes legibility and branch frequency more important than a single primary CTA | “Dark plus huge buttons” without the physical environment merely wastes space |
| Socar map commitment | Spatial canvas persists while a detail sheet places price, conditions, and commitment together | Users need answers to the most likely objections immediately before a location/price commitment | Hiding conditions creates surprise; replacing the map with cards destroys spatial reasoning |
| Yeogi Eottae entry | Dense category entry and recurring benefit signals precede long-form discovery | Arrival intent is often already category-specific and price-sensitive | A fashionable search hero can insert work; copying the category grid imports another market's intent model |
| 29CM versus Instacart | Editorial image-led reading and dense row-level fulfillment controls occupy opposite registers | Margin, purchase frequency, and task cadence determine whether discovery should slow down or speed up | Treating editorial or utility as a universal style destroys the other product's job |
| WeChat settings | Multi-value permission states appear as labels and drill-in rather than binary toggles | The state model has more than two truthful values | A toggle would make the interface lie |
| CapCut export | Expert parameters keep inline education, recommendations, cost labels, and predicted output | Pros need control while novices need a safe default; export is costly enough to preview its consequence | Hiding all detail weakens the core tool; copying dark controls without an editing environment is cosmetic |
| Duolingo lesson | One decision, persistent stakes/progress, functional character, and dominant feedback layer | Repetition and reward depend on protecting one micro-decision at a time | A decorative mascot or tiny toast copies the surface while losing the loop |
| Toss business forms | Input, live output preview, draft state, and review/submit authority remain distinct | External publication has error cost, interruptions, and organizational approval | A generic Save button collapses state and authority |
| Skyscanner and Recatch | Repeated objects use fixed comparable slots; color is largely reserved for state or action | Comparison speed and perceived neutrality depend on consistency | Decorative card variation is actively harmful here |
| Pandarank and Jandi | Open-ended entry is paired with suggested first actions and visible output/status | Generative tools must answer “what can I do?” before a blank input can work | Suggestions without live data or a real output path become demo slop |
| Naver Travel | Recall, inspiration, utilities, and booking coexist around a destination over multiple sessions | Long research journeys need a durable home and resume cues | Flattening it into search results removes continuity; copying modules without content operations leaves shells |

Promotional frames from Rround and portions of Daangn, Planfit, My Doctor,
Socar, 29CM, WeChat, Duolingo, Instacart, and Toss POS were useful only for
brand-expression hypotheses. They were weak evidence for operational
hierarchy. A popular-source corpus naturally over-samples such frames, so KSR
now applies a promotional-evidence firewall.

## Resulting reasoning model

The transferable unit is not a theme. It is a causal chain:

```text
visible priority
  -> user decision it supports
  -> likely product, environment, state, or business constraint
  -> consequence if the hierarchy is flattened
  -> conditions where the principle applies
  -> tradeoff and context where it becomes harmful
```

The bundled, non-authoritative
[`human-design-reasoning.json`](../../registry/human-design-reasoning.json)
turns this study into reusable questions. It covers decision order, scope,
object state, comparison alignment, risk near action, progressive disclosure,
persistent context, cadence-driven density, product expression, color roles,
state completeness, responsive reprioritization, physical environment,
state cardinality, arrival intent, live-data scaffolding, and typography
register/numeracy.

## Contract consequences

Reference discovery must now record product family and frame count, screen
role, evidence strength, platform, environment, business model, session shape,
locale, selection rationale, ecosystem, cohort, and snapshot-bound popularity.
Every actual capture or metadata file must be a member of the digest-bound
manual export, stay inside its directory, and pass content, byte-digest, and
physical-identity checks. Its record remains closed over the enclosing product
and screen, enumerated frame IDs, and explicit subject bindings. An observation
may cite only its bound screen/frame, and a popularity claim may cite only
evidence carrying that exact product-or-screen subject.
Single-frame or no-core-task families remain weak evidence. Hard sampling
coverage uses task-fit, cross-domain, and competent-baseline cohorts; reach and
bookmark status remain non-gating discovery metadata. Promotional
captures cannot substantiate operational grammar.

Grammar extraction must connect every reusable principle to verified visible
priority and an explicit user decision, likely constraint, flattening
consequence, application conditions, tradeoff, harmful context, live-data
dependency, and anti-copy boundary. The independent critic verifies that
chain. Sampling coverage limits a single product or ecosystem, requires
multiple products/categories/cohorts, preserves multi-state families, and caps
promotional references.

Only references independently verified with `copy_risk: low` are eligible;
medium or high risk cannot be offset by fit or popularity. The complete pack
retains selected source identities and links, verified text observations,
reasoning, transferable grammar, and a path-free evidence digest manifest, but
not capture paths or image bytes. Its creator-safe projection contains only
aliased causal reasoning and transferable grammar. It is digest-bound as an
optional input to the unchanged exact-three design exploration and grants no
visual intent, visual signature, shortlist, approval, or release authority.
The registry defines eleven stage-scoped checks: direction review applies ten
and color review applies two, with source-composition independence shared by
both. Comparing a candidate to source composition requires the explicit
version-1 internal-critic source-access contract and a digest-bound capture set;
that evidence never becomes creator or browser input. Playwright and Owner
gates remain separate and mandatory.

The `FlowDesk`, `MarketLine`, and `ProofGrid` files under `examples/` are
synthetic schema/install fixtures. Their IDs and popularity values are not
claims about UI Bowl records and are not evidence for this study. Their evidence
is intentionally metadata-only: it can demonstrate a research-complete fixture
but yields `reviewer_source_capture_readiness: manual_pending`, not a
design-ready reference pack.

## Known gaps

- This is not an exhaustive crawl of UI Bowl; exhaustive copying would be both
  less useful and harder to keep rights-safe.
- Government, senior-first, accessibility-first, specialist mapping, and
  reading-heavy products remain underrepresented.
- Static frames cannot prove interaction quality. Any adopted direction still
  needs real browser interaction, keyboard, state, overflow, contrast, zoom,
  console, network, and visual evidence.
- Popularity snapshots can age or conflict. Refreshing them requires a new
  bounded discovery run and never silently mutates an existing digest chain.
