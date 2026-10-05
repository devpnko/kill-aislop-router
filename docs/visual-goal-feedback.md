# Visual goals and early specimen feedback

KSR orchestrates, verifies and stops; it does not generate a style, predict taste,
or approve its own work. A technical pass, local spacing repair and relative
ranking are different from satisfying the intended visual direction. Preserve
an unresolved/rejected goal even when its implementation defects are closed.

## Brief and reviewer contract

New recipe-backed starts require `visual_goal_contract` alongside
[`component_craft`](component-craft-coverage.md). The [schema](../schemas/visual-goal-contract.schema.json)
maps each goal's intent and unacceptable outcomes to declared target relationship
IDs. Cover every relationship. State the project's actual intended treatment;
there is no universal white/gray prohibition or mandatory rich/decorative style.

Direction/color reviews require the separate
[`visual_goal_review`](../schemas/visual-goal-review.schema.json):

- Explicit `satisfied`, `unresolved` or `rejected` for every goal; `local_regression`
  is separately `closed`, `open` or `not-assessed` with its scoped note.
- Per-relationship comparison against the exact verified projected recipe or
  declared target invention. Actual candidate/browser result digests and target
  screenshot observations at each required viewport/state are mandatory.
- Unresolved goals or unsupported/unassessed relationships require the persistent
  `visual-goal-unresolved` hard blocker. An open/unassessed local regression needs
  its separate `local-regression-unresolved` blocker. Scores cannot replace them.
- `preserve_instructions` must explicitly classify advice as `suggestion` or
  `bound-obligation`. The latter must repeat an exact preserved property of an
  existing relationship decision and its digest. Neither creates skin/Owner
  approval. A new or unjustified preservation rule must not silently constrain
  the next creator. Reconcile it in a scoped successor if the intended direction
  actually changes; do not amend a frozen brief/result.

This checks typed evidence/authority, not the truth of arbitrary prose or pixels.
Reviewers must inspect the actual target render, not fill the fields from its
manifest. PMs must carry materially unresolved findings into the typed review;
outside supplemental prose is not automatically ingested or semantically parsed.
Independent review may still be wrong. Owner approval remains separate.

The comparison is source-supported but **not source-image craft parity**:
reviewers use verified neutral recipes and target images. Existing source-aware
permissions remain only promotional-citation-firewall and source-composition-
independence. Do not reuse those purposes to inspect sources for craft parity.
No source captures, source identities, literal brand assets, or new pixel rights
are passed to a creator or specimen reviewer.

## Evidence limits of this candidate

**Locale.** Historical visual-goal contracts bind only viewport/state; they do
not retroactively gain per-language visual review. New contracts can declare
`observation_locales`, and the primary-reference candidate route requires it.
See the locale-bound contract below. Execution coverage remains distinct from
a critic actually assessing clipping, typography and hierarchy; schema-valid
observations are not a machine judgment of the image's quality.

**Relevant states.** Current review requires every declared goal and relationship
at every required viewport/state. There is no per-relationship applicability or
`not-applicable` cell, no check that free-form observations contain useful distinct
judgments, and no proof about undeclared states or action sequences. Repeated
boilerplate can satisfy shape checks without supplying meaningful assessment.
Choose a planning-grounded, task-relevant scope before starting a new journey;
do not shrink an existing required matrix to make review pass. If a component is
legitimately absent in a required state, the existing craft presence check cannot
represent that as a successful N/A. Report the contract/scope mismatch and retain
the blocker, rather than inventing presence or marking an unobserved relationship
supported. Eligibility remains confined to the actual observed specimen, states
and viewports; it is never universal visual quality or a complete UX assessment.

**Source adequacy.** An accepted pack verifies provenance/bindings, not unlimited
detail in its pixels. A wide gallery screenshot containing thumbnails is not a
capture of the service at that viewport. Record native frame resolution and what
is actually legible separately from gallery size or upscaling. Small frames may
support broad grouping and hierarchy while leaving exact type, spacing, edge,
material, interaction and responsive claims unproven. Assess each claim against
visible evidence; there is no universal resolution threshold. Mark unsupported
treatment as target invention/unassessed instead of promoting it into extracted
detail. Keep frozen packs unchanged; narrower claims or additional permitted
evidence belong in a separately reviewed successor, not a rewritten old receipt.
No recapture, new source access or source-to-creator pixel grant is implied.

## Optional one-candidate checkpoint

In a NEW scoped brief retain the existing three theses, three depths and color
strategies. Add (replace the example ID with an actual planned candidate):

```json
{
  "specimen_feedback": {
    "specimen_feedback_version": 1,
    "candidate_id": "your-direction--refine"
  }
}
```

Also declare `providers.specimen_reviewer`, independent from every creator and
the browser provider. Configure an allowlisted digest-locked host or manual
adapter for it with the direction-review capabilities, strength 4, and only
`artifact:read`/`evidence:write`. Source-read and external-network permissions
are forbidden for this packet; do not reuse a source-privileged host declaration.
Manual reviewer results are allowed with real independent provenance. Browser
results still require the executed official Playwright child; manual/browser
substitutes are not accepted. Missing adapters remain `manual_pending`.

With that reviewed brief and already verified reference pack:

```bash
killsloprouter design run --brief successor/design-brief.json --baseline BASELINE --host-config HOST.json --require-reference --dry-run --json
killsloprouter design run --brief successor/design-brief.json --baseline BASELINE --host-config HOST.json --require-reference --out successor/design-run.json --json
killsloprouter design status --run successor/design-run.json --json
```

Only the selected creator runs first. KSR accepts its strict normal result, runs
the official browser for that exact artifact, then emits `specimen-review` with
only that candidate/browser plus neutral obligations and target constraints.
That distinct result requires rendered craft and visual-goal review, not matrix
scores, source-composition analysis or a shortlist. Accepted evidence is immutable.
The creator and browser actor cannot perform their own specimen critique even
under different provider IDs.

At `specimen-feedback`, any hard blocker keeps expansion blocked on resume.
Otherwise the run remains `manual_pending`, with no selection or Owner approval.
After reviewing the evidence, an authorized coordinator can explicitly continue:

```bash
killsloprouter design run --resume successor/design-run.json --expand-specimen --host-config HOST.json --json
```

The continuation records the review digest, not approval. It dispatches the
remaining eight and retains the original nine-candidate browser and aggregate
review, three-direction Owner shortlist, nine colors and final Owner gate.
Specimen evidence cannot substitute for those stages. Dry-run readiness covers
the eventual full route, not permission to run all creators immediately.
`--expand-specimen` before the recorded feedback checkpoint is rejected before
child execution; it cannot pre-authorize expansion on a future review. The
expansion record and all nine canonical creator packets are committed together.

Or abandon before shortlist/approval, including when browser execution is blocked:

```bash
killsloprouter design run --resume successor/design-run.json --abandon-specimen --reason "Direction does not meet the visual goal; no further expansion." --json
```

This is terminal `blocked/specimen-abandoned`, nonzero, with all evidence retained
and no output/approval. Retry/expansion cannot revive it. Prepare a new scoped
successor for a revised candidate, preserving the rejected run and its findings.
Do not fake eight siblings to receive feedback. The checkpoint is per-candidate,
not an automatic baseline-regression comparison or all-candidate Owner decision.
Explicit stale-lease recovery after an abandonment write also preserves that
terminal status and reason; recovery is not continuation permission.

## Compatibility and delivery

### Locale-bound observations

An optional `visual_goal_contract.observation_locales` lists the locales that
must be reviewed. The new primary-reference candidate route requires this list
to match the brief's locales. Every goal and relationship then has observations
for the bound viewport × state × locale matrix. Screenshot locale is joined
from the digest-bound, accepted official execution report, not inferred from a
filename or a reviewer's assertion. Borrowing a screenshot from another locale,
omitting a cell or changing report bytes fails validation.

Older contracts without this field prove only their viewport/state judgments;
they do not gain locale-qualified visual acceptance. Even the new matrix covers
only the declared relevant states and viewports. It is not every possible task
sequence, native control rendering, zoom level or global visual quality. A
reviewer must report unsupported detail rather than fill cells with boilerplate.
Recipe comparison remains source-neutral: thumbnail/galleries may support broad
composition but not exact type/spacing/native behavior, and existing source
access does not grant source-image craft-parity review or creator pixels.

Old runs remain readable under their original bound contract; no retroactive goal
verdict or specimen approval is added. The normal exact-three route is unchanged
when `specimen_feedback` is absent. New recipe starts without visual goals now
stop before dispatch. Existing no-recipe/approved opt-out routes stay unchanged.
Adapt host result producers to the new review fields for new goal-bound runs.

Only a distribution advertising `visual-goal-specimen-feedback` supports these
commands. A source branch or synthetic test pass is not an installed upgrade,
successful project design or resolution of historical browser lifecycle errors.
Until delivered, an existing installation can provide supplemental target-only
preview/independent feedback while its one-candidate run remains incomplete;
it cannot claim this official early checkpoint or bypass the nine-creator gate.
