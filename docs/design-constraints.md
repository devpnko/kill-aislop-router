# Separate requirements from unapproved visual proposals

An Owner-rejected direction can survive in a new brief after the old HTML/CSS is
removed. Global bans, color strategies, component roles and reviewer instructions
can all keep the same skin. KSR does not choose a replacement style or ban white,
gray, gradients, broad color, rounding, depth or restraint universally.

For a new continuation after visual rejection, inspect **all** those inputs and
use a new brief with `constraint_audit` and `--require-constraint-audit`. The
[schema](../schemas/design-constraint-audit.schema.json) records:

- `context`: `exploration` or `reconsideration-after-rejection`.
- `entries`: one exact pointer/value digest per review unit: product, editorial
  boundary, every baseline policy entry, full direction/color strategy, target
  part, relationship and visual goal. Changing nested prose invalidates the audit too.
- `role`: functional, accessibility, privacy, source-rights, approved-visual,
  host-requirement or design-proposal. Every non-proposal needs scoped evidence.
- `evidence`: ID, path and file digest of a target JSON authority document in the
  brief lane, outside the creator baseline and child-writable state directory.
- `released_proposals`: discarded provisional instructions and the reason. For
  rejected-direction reconsideration this is nonempty. It is a declaration of
  the new scope, **not** proof of a prior Owner decision, predecessor lineage,
  permission to revoke real requirements or inherited approval.

Use the source-neutral `designConstraintInventory(brief)` export from
`src/design-constraints.mjs` to enumerate `{pointer, value_digest, hard, value}`.
Review the values; do not automatically label every hard rule `functional`.
Use the normal `digest --target FILE --json` for actual evidence bytes. The
inventory is preparation only, not validation or a signed receipt.

`baseline_policy.preserve` / `.forbid` and the product/editorial boundary are
shared hard instructions. A `design-proposal` cannot occupy them. Release an
unapproved appearance rule from those arrays and reconsider it as a
candidate-specific hypothesis, if still useful. A relationship cannot use
`preserve` to freeze an unapproved proposal. Proposed anatomy, hue adaptations,
accessibility-driven changes and legitimate approved brand preservation remain
available; they are not replaced with a KSR house style.

Visual goals are audited too, but may be design proposals: authorizing a new
hypothesis for implementation and criticism is not approving its appearance.
Functional or Owner-required outcomes use the matching evidenced role instead.
A proposal goal must not be promoted into an approved shared skin by its critic.

Split mixed clauses carefully: removing “no gradients; no fake live counters”
must preserve the data-truth obligation about counters. An actual higher-priority
host instruction is not a model preference and cannot be silently waived. Record
its real source and conflict; the phrase “host constraint” alone is insufficient.
The router checks bytes, declared classification and scope—not authenticity or
truth of free-form evidence. Re-labeling taste as functional remains dishonest
input, not a supported bypass. Independent semantic review is required.

```bash
node <candidate-root>/bin/killsloprouter.mjs design run \
  --brief NEW_BRIEF --baseline FROZEN_BASELINE --root PROJECT \
  --host-config HOST --require-reference --require-constraint-audit --dry-run --json
```

Do not dispatch until both reference authority and the classified brief pass.
Use a separately authorized new output, never edit a bound run or its pins.
The reference/direction/color/exact-artifact Owner stops remain unchanged.

## Execution, review and privacy

The brief/state binds the audit; evidence bytes and physical identity are checked
again at dispatch, ingest and resume. Final packets must contain the exact
contract and unchanged audited policy/thesis/strategy, not merely a new hash.
Creators receive only classifications and evidence IDs/digests, besides their
own assigned task values. Reviewers receive `review_inventory`: every exact
instruction value with its pointer and value digest, canonically checked against
the frozen brief and validated with the existing source-neutral projection guard.
Discarded prose and actual evidence descriptors go only to independent reviewers; browser
packets receive neither. No new source-pixel, network or approval grant exists.

Direction/color/specimen reviewers return `constraint_audit_review`, bound to the audit
digest, with exact pointer coverage, reasoning, `supported` determinations and
`released_proposals_not_reintroduced`. Well-bound negative provenance or
rejected-skin findings remain accepted review evidence, with a mandatory
`constraint-audit-unresolved` hard blocker for every reviewed candidate. They
remain visible in comparison but cannot become eligible. Malformed, incomplete
or stale reviews still fail ingestion. Preserve findings and use a new brief.
Do not fix it by changing a score, claiming browser PASS, or cosmetically patching
spacing. This review concerns instruction provenance; rendered component craft,
functional/browser evidence and real Owner visual acceptance remain separate.

A reviewer may suggest preserving a treatment. A `bound-obligation` preserve
instruction must repeat the exact bound relationship decision and that
relationship must have a non-proposal provenance classification with evidence.
Repeating a model's prior `preserves` text does not upgrade it into authority.
This check applies at the first specimen review as well as aggregate reviews.

An audit cannot infer a rejection omitted by its caller, detect arbitrary
paraphrases, authenticate a human, prove all candidate families are genuinely
different, or certify beauty. Exact recurrence is detected; semantic equivalence
and mixed functional/aesthetic clauses require actual independent review. This
is not an automatic predecessor migration. The inventory and review checks also
support the separate single-reference candidate route; they do not require three
directions or any color strategies, and do not themselves authorize expansion.

## Compatibility and delivery

Historical briefs remain inspectable with their old checks and no fabricated
classification. The strict CLI/API assertion requires the new field, including
on resume/status/dispatch. Once bound it cannot be dropped on continuation even
without repeating the flag. The KSR skill requires this explicit preflight after
Owner visual rejection; bare legacy API/CLI calls without that intent assertion
remain compatible and must not be described as audited reconsideration.

`capabilities --json` exposes `design-constraint-provenance` in a package that
contains this code. Older installed builds cannot execute the new field/flag.
Source tests and package verification do not mean installation, visual quality,
completed browser review, or product adoption. Synthetic fixtures exercise
failure propagation; they are not genuine Owner evidence or aesthetic review.
