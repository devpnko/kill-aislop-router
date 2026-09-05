# Project-aware design exploration

`killsloprouter design run` resolves a missing visual direction without turning
an anti-slop critic into a house-style generator. It compares project-specific
hypotheses, requires real Playwright evidence for every candidate, and produces
profile-ready visual-intent and visual-signature receipts only after explicit
owner choices.

This is a control-plane workflow. KillSlopRouter does not invent the three
design theses, render prototypes, choose a palette, or make an owner decision.
Those actions belong to evidence-backed briefs, digest-locked creator adapters,
independent critics, a Playwright browser adapter, and the real owner.

## The two matrices

The first matrix is fixed at nine artifacts:

| Project-specific thesis | Refine | Evolve | Reimagine |
|---|---:|---:|---:|
| Direction A | one artifact | one artifact | one artifact |
| Direction B | one artifact | one artifact | one artifact |
| Direction C | one artifact | one artifact | one artifact |

`refine`, `evolve`, and `reimagine` describe redesign distance, not visual
styles. The comparison scores whether each artifact actually matches that
distance, so nine near-identical variants are ineligible. Every candidate must preserve the brief's product model, domain,
required density, and forbidden transformations. An ERP cannot become a
storefront merely because the candidate uses `reimagine`.

After an independent comparison, the owner shortlists exactly three direction
candidates. Each shortlisted candidate is then paired with all three declared
color strategies, producing a second nine-artifact matrix. The strategies name
a seed source, role intent, harmony method, and OKLCH or HCT working space.
They do not name a fashionable fixed palette.

Each direction and color artifact receives a separate Playwright packet. A
creator's prototype is not browser evidence, and a routable browser provider is
not proof that Playwright ran.

## Author the brief

Start from
[`examples/design-brief.example.json`](../examples/design-brief.example.json)
and validate it against
[`schemas/design-brief.schema.json`](../schemas/design-brief.schema.json).
The runtime validator is stricter than the descriptive schema in several
places.

The brief must contain:

- the user, job, main object, core task, trust risk, density, real states, and
  success measure;
- baseline qualities that must survive, aspects that may change, and
  transformations that are forbidden;
- an explicit editorial boundary: `forbidden`, named `bounded` scopes, or
  `required` editorial mode;
- exactly three theses grounded in the project's subject world, evidence, and
  anti-references;
- allowed energy and depth for each thesis;
- exactly three color strategies with seed sources, role intent, harmony
  method, color space, and anti-patterns;
- independent direction, color, and browser providers;
- at least two viewports, every real state, all project locales, and the
  mandatory Playwright checks.

It may also contain one digest-bound `reference_pack`, the exact completed
producer-state path/digest, and a required `reviewer_source_access` contract
from the optional
[reference-intelligence stage](reference-intelligence.md). KSR verifies that
the pack belongs to the same project, surface, screen ID, product frame, and
current bundled reasoning registry and producer output lineage, remains
`discovery-evidence-only`, contains causal hierarchy reasoning with conditions
and tradeoffs, excludes source image bytes and paths, and grants no visual
authority. Its router-recomputed
`reviewer_source_capture_readiness` must be `ready_at_compilation`; a
research-complete pack marked `manual_pending` cannot start design work, and
the exact capture/reference/observation coverage is revalidated from the
producer at design start. The complete pack remains an audit artifact with
selected source identities, links, verified observations, causal reasoning,
grammar, and its path-free evidence digest manifest. Each creator packet receives only a
source-identity-free projection of causal reasoning and transferable grammar;
raw source observations, URLs, names, pixels, and capture paths are absent.

`reviewer_source_access` must be version 1,
`mode: digest-bound-internal-critic`, limited to
`promotional-citation-firewall` and `source-composition-independence`, and
allow only `source-capture`. Redistribution, creator access, browser-provider
access, and external network are false. KSR derives `review_source_authority`
version 1 with pack/producer digests, aliased captures, and a
`capture_set_digest`. Actual paths appear only in independent-reviewer run
artifacts. That packet requires `reference-evidence:read` and declares source
descriptors/pixels available to its participant while preserving
`source_pixels_exposed_to_downstream_creator: false`. Creator and browser
packets forbid both source-evidence access and external network.
The authority also binds every accepted source-recipient provider and actor,
plus providers from executable attempts even when an attempt failed. None may
serve as a direction/color creator or browser
participant in this consuming design run; independent direction/color reviewer
reuse remains allowed. Provider conflicts stop before state creation, and actor
conflicts stop before accepting a creator/browser result.
The same authority carries a canonically ordered, digest-bound execution
lineage for the reference attempts, including provider declaration and adapter
type, entrypoint content, physical-identity, and graph digests. A fully manual
producer has an empty attempts array; it never receives synthetic executable
provenance.

Creator traces must disposition every selected dimension as applied or
target-specific not-applicable while preserving actual grammar-to-reasoning
edges. Reviewers apply the eleven fixed checks by stage: ten for direction and
two for color, with `source-composition-independence` shared by both. Each
applicable check requires typed, digest-bound evidence and its fixed failure
code. `reference-capture-set` must resolve to
`reference-authority/source-capture-set`; `source-composition-analysis` must
resolve to `review-evidence/source-composition-analysis` and validate against
[`design-source-composition-analysis.schema.json`](../schemas/design-source-composition-analysis.schema.json).
The approved decision retains pack, producer, target, trace,
independent-review digests, `review_source_capture_set_digest`, and the
direction/color `*_source_composition_analysis_digest` values as
non-authoritative provenance. Omitting
`reference_pack` preserves the original packet and receipt shape exactly;
providing it does not change the three theses, three depths, three color
strategies, Playwright checks, or Owner gates.
An earlier preview brief or pack that lacks the complete
`reviewer_source_access`, router-recomputed capture-readiness, or
source-recipient separation and execution-lineage contract is intentionally
rejected; regenerate the
reference run and start a new design run rather than patching or re-signing the
old state.

Do not derive a thesis from the semantic surface label. Do not fill all three
rows with renamed versions of `editorial`, `minimal SaaS`, or another familiar
template. A useful row explains how this product's object, task, trust, brand,
or subject world creates a distinct visual logic.

## Dry run

The baseline may be a file or directory. If it is a directory, keep state below
the ignored `.killsloprouter/` boundary so evidence output cannot mutate the
artifact digest.

```bash
killsloprouter design run \
  --brief .killsloprouter/design-brief.json \
  --baseline . \
  --host-config .killsloprouter/host-adapters.json \
  --dry-run \
  --json
```

The report lists all nine direction candidates, all nine planned color
combinations, and adapter readiness. Exit `6` means at least one adapter is
still `manual_pending`; it is not a successful execution. No state or evidence
is written by the dry run.

## Execute and resume

```bash
killsloprouter design run \
  --brief .killsloprouter/design-brief.json \
  --baseline . \
  --host-config .killsloprouter/host-adapters.json \
  --out .killsloprouter/design-direction.json \
  --json
```

With complete adapters, the first call executes nine creators, nine independent
Playwright evidence packets, and one direction comparison. It then exits `6`
at `direction-selection`. The state directory contains a generated template:

```text
.killsloprouter/design-direction.design/templates/design-shortlist.json
```

Copy that file outside the state directory, inspect the candidates and browser
evidence, replace the owner fields, and resume:

```bash
killsloprouter design run \
  --resume .killsloprouter/design-direction.json \
  --host-config .killsloprouter/host-adapters.json \
  --shortlist reports/design-shortlist.json \
  --json
```

The shortlist is accepted only when it names exactly three eligible candidates,
matches the exact `selection_scope_digest`, and is not authored by any selected
candidate's creator. The next leg creates and browser-tests nine color systems,
runs the independent color comparison, then stops at `owner-approval`. Copy and
edit the generated owner-decision template and resume:

```bash
killsloprouter design run \
  --resume .killsloprouter/design-direction.json \
  --host-config .killsloprouter/host-adapters.json \
  --approval reports/design-owner-decision.json \
  --json
```

Use `--retry all`, a packet ID, provider ID, stage ID, or result kind after a
child execution error. Completed results are not silently regenerated. Manual
adapter results can be supplied with repeatable `--result FILE` and pass the
same schema, identity, capability, evidence, and digest checks.

Every completed automated design attempt also retains the exact execution
authority used for that child: a digest- and physical-identity-bound host
manifest, provider declaration digest, optional adapter-entrypoint snapshot,
and an authority digest over that tuple. State reads and resumes revalidate the
snapshot before trusting the attempt. A recovery receipt may represent an
abandoned child whose outcome is unknown, but it never upgrades that child to
`ran`. A pre-contract design state containing an automated attempt without this
authority cannot be made trustworthy by copying values from today's host
manifest or re-signing the state; start the design run again from the unchanged
brief, baseline, and external Owner authority. Inspection-only
`manual_pending` and genuine `manual_recorded` attempts remain distinguishable
and do not claim automated execution.

Final approval publication is also crash-resumable rather than an untracked
directory write. KSR stages exactly the decision, visual-intent receipt,
visual-signature receipt, and profile bindings, records their names, byte
counts, digests, receipt digests, destination paths, and transaction digest in
`pending_finalization`, and durably writes that state before publishing the
directory. Resume may adopt only that exact staged or already-published file
set, after revalidating the full authority graph. Missing, doubled, redirected,
or changed staging/published directories fail closed. A lease recovery can
record the already-durable checkpoint, but it cannot manufacture a finalization
transaction or publish a second copy.

Inspect or redispatch the current immutable packets with:

```bash
killsloprouter design status --run .killsloprouter/design-direction.json --json
killsloprouter design dispatch \
  --run .killsloprouter/design-direction.json \
  --out-dir reports/design-packets \
  --json
```

## Outputs and profile binding

An approved run writes four files under the state directory's `approved/`
folder:

- [`design-direction-decision.json`](../schemas/design-direction-decision.schema.json): selected direction, color system, source
  digests, per-result evidence and execution provenance, and exact owner
  authority;
- `visual-intent-approval.json`: a version-1 authority receipt for mode,
  editorial boundary, energy, depth, preserve, and avoid;
- `visual-signature-approval.json`: a version-1 receipt covering palette,
  typography, density, shape, elevation, imagery, motion, style keywords, and
  forbidden transformations;
- [`profile-bindings.json`](../schemas/design-profile-bindings.schema.json): exact `visual_intent` and `visual_signature` objects
  with receipt paths and digests.

KillSlopRouter does not edit `.killsloprouter/profile.json` automatically.
Review the decision, copy the two binding objects into the matching surface,
then run `doctor`. These receipts authorize visual direction only; the normal
integrated run still requires its locale, domain, privacy, browser, critic,
conflict, and final owner gates. This keeps a generated candidate from gaining project
authority through an implicit write.

A design state created before the lease/recovery and transactional-finalization
contract is not upgraded by adding fields or re-signing JSON. In particular,
an interrupted legacy approval with an unbound `approved/` or staging directory
has no adoptable `pending_finalization` authority. Preserve it only as
historical evidence and start a new design run from the unchanged external
brief, baseline, reference pack (when present), and Owner inputs. The same
restart rule applies when an automated attempt lacks its historical execution
authority. Do not copy either authority from the current filesystem or host
manifest.

Exploration also does not approve a reusable `design_system`. Implement the
chosen prototype and token spec through one explicit project creator. An
existing-artifact `--task audit` route needs no creator; a `build`, `redesign`,
or `runtime-handoff` route still needs either a separately approved project
design system or a profile `surface_overrides.<surface>.creator` backed by the
right project capabilities. Do not grant that override merely because a
prototype adapter was routable.

## Adapter contracts

Design adapters use the existing `agent-json-v1`, `skill-json-v1`, and
`browser-json-v1` transports. Packets conform to
[`design-packet.schema.json`](../schemas/design-packet.schema.json); the packet's `design_task.kind` determines the
result contract in
[`schemas/design-result.schema.json`](../schemas/design-result.schema.json).

| Kind | Minimum strength | Required capability set |
|---|---:|---|
| `direction-candidate` | 3 | direction generation, baseline preservation, responsive and locale prototype |
| `direction-review` | 4 | product fit, distinctiveness, preservation, responsive review |
| `color-candidate` | 3 | color system, semantic roles, contrast-aware palette, responsive prototype |
| `color-review` | 4 | harmony, semantic roles, contrast, brand fit |
| `browser-evidence` | 3 | responsive, keyboard, state, overflow, contrast, and zoom evidence |

Direction creators return exactly one prototype and one [`font-report`](../schemas/design-font-report.schema.json)
covering font availability, every required locale, fallback behavior, and
cleared license/use constraints. Color creators return exactly one recolored
prototype and one [`token-spec`](../schemas/design-token-spec.schema.json) that maps every normalized role to a
unique implementation token and repeats the exact tone scales and gamut
targets.
Those reports are digest-bound and become evidence for the approved typography
and palette fields; naming a fashionable font or a harmonious palette is not
enough.

Creators need `artifact:read` and `evidence:write`. Browser packets additionally
require `browser:control` and must use a digest-locked `browser-json-v1`
declaration. The browser result must come from a KSR-run sealed adapter attempt;
a caller-supplied manual browser result is never execution evidence. The result
must attest `browser_engine: "playwright"`, cover every viewport, locale, and
state, pass every requested check, and return screenshots plus a test report
inside the granted output directory.

The no-reference exact-three flow retains compatibility with an explicitly
allowlisted custom `browser-json-v1` Playwright adapter. A reference-backed
flow is stricter: every candidate browser packet resolves to the bundled
official Playwright contract. The browser never receives source-reference
pixels, paths, identities, or the reviewer-only `reference-evidence:read`
permission. A generic or manual browser remains `manual_pending` before child
spawn in that flow.

The bundled official Playwright adapter also accepts design browser packets.
For that path, each creator returns exactly one digest-bound static `.html`
prototype. Mark every demonstrated locale and state so the browser verifies
coverage rather than trusting a claim:

```html
<section data-killsloprouter-locale="ko-KR">...</section>
<section data-killsloprouter-locale="en-US">...</section>
<section data-killsloprouter-state="default">...</section>
<section data-killsloprouter-state="error">...</section>
```

The official adapter requires a self-contained prototype: inline CSS/JS and
`data:` or `blob:` assets. It opens only the exact bound HTML and blocks every
other local or network request, so an unbound stylesheet, font, script, or
image cannot change after the prototype digest is recorded. It runs the pinned
Chromium/axe harness. Exploration screenshots do not become approved pixel
baselines. The later integrated artifact audit still requires served-artifact
attestation and exact owner-approved baselines.

The static-design path intentionally does not claim a real screen-reader run or
an approved visual-regression comparison. If either check is added to the
brief, the official adapter reports `manual_pending`; use a separately
allowlisted adapter that can produce that evidence. `aria-semantics` is the
available automated accessibility proxy and is never relabeled as
`screen-reader` evidence.

Direction critics cannot share a provider or actor with direction creators;
the equivalent rule applies to color critics. Browser evidence also cannot be
authored by the candidate creator. The owner who shortlists or approves cannot
be a selected candidate's creator.

The router rejects byte-identical prototypes in either matrix. For each
shortlisted direction, the three color strategies must also emit three
different normalized palettes. These are minimum mechanical diversity checks;
the independent critics still decide whether the differences are meaningful,
product-specific, and faithful to `refine`, `evolve`, or `reimagine`.

## Color gate

Color creators may reason in OKLCH or HCT, but must emit normalized `#RRGGBB`
sRGB roles and tone scales. KillSlopRouter recomputes, rather than trusts, these
minimum ratios:

- primary, secondary, and muted text on canvas: `4.5:1`;
- primary text on base and raised surfaces: `4.5:1`;
- on-action across default, hover, and pressed; on-accent across default and
  hover; and semantic on-colors: `4.5:1`;
- focus ring against canvas, base surface, and raised surface: `3:1`;
- default border against canvas: `3:1`.

The role set separates canvas, surfaces, text levels, borders, focus, action,
accent, success, warning, danger, and information. `color_only_meaning` must be
`false`, and every palette value must be bound to one of those roles. Passing
contrast does not constitute aesthetic approval; the color critic and owner
remain separate gates.

## Integrity boundary

Brief, baseline, packet, result, prototype, font report, token specification,
screenshot, test report, shortlist, owner decision, compiled receipt, and
state digests are checked on every resume. A changed bound file exits through
the tamper path. SHA-256 detects replacement relative to the state; it is not
an identity signature. Preserve and sign final evidence externally when a
writer capable of replacing the entire ledger is in scope.

Both owner scope digests include each provider/actor, packet digest, result JSON
digest, evidence-file digest, execution status, strength, capabilities,
permissions, host-manifest digest, and adapter entrypoint digest (`null` only
where explicitly recorded `manual-v1` evidence has no executable provenance).
The final decision repeats the six selected
candidate/browser/critic bindings, so its receipt does not rely on an
unexpanded `result_digest` claim.
