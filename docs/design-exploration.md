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
require `browser:control` and must use a `browser-json-v1` declaration. The
browser result must attest `browser_engine: "playwright"`, cover every viewport,
locale, and state, pass every requested check, and return screenshots plus a
test report inside the granted output directory.

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
