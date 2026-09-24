# Fit-first reference selection without invented popularity

Use this optional contract when the project needs a fitting reference and a
source does not expose a verifiable popularity count. It does not collect more
screens, approve a theme, generate UI, or silently enable a provider.

## A component is not a theme

First match the project user, task, screen, trust, density and locale. Then say
which component relationship transfers, why it helps, what does not transfer,
and which target behavior still needs evidence.

For example, a source's selected check / name / purpose-description row may be
a useful comparison input. That does not select a “Gemini-style” product. It
does not establish that a floating menu is suitable, or that the source's
colors, fonts and entire screen should replace the project.

- A few mutually exclusive choices with meaningful descriptions may need all
  choices visible. Use actual cardinality, not a fixed three-option preset.
- A large searchable choice set has different navigation and space needs.
- Repeated objects with comparable conditions may need aligned table columns,
  not a row menu or a collection of visually unrelated cards.

These are application criteria, not automatic component decisions. Keep the
project's approved visual character. A source screenshot cannot prove native
clicks, keyboard handling or responsive transitions. Keep unseen adaptations
as `target-proposal`, use concrete component recipes and target specifications,
then test the rendered artifact with separate critics and browser evidence.
Owner source selection, direction, color and exact-artifact approval remain
separate. Source names never become parent workflow identities: the parent is
KillSlopRouter.

## Opt in explicitly

In a **new** reference brief, add only this property to the existing policy:

```json
{
  "popularity_prior": {
    "unavailable_policy": "fit-only"
  }
}
```

This is a fragment, not a complete brief. Use
[`reference-brief.fit-only.example.json`](../examples/reference-brief.fit-only.example.json)
for the complete schema-shaped example. Its sources and numbers are synthetic
package fixtures, not actual UI Bowl research or Owner permission for a product.

The policy continues to declare every expected signal, including exact metric,
product-or-screen subject, scope, category and normalization. Every exported
record and discovery result must account for every configured signal exactly
once: an observed numeric signal or an explicit unavailable record. Empty arrays
and omitted signals are still invalid.

In this mode the router sorts eligible references by product-fit band, then
fit score, then stable reference ID. It excludes **all** popularity from ordering,
even observed values, so unknown references do not gain an invented numerical
rank and mixed availability cannot produce inconsistent comparison ordering.
Observed numbers still retain their independently checked audit provenance.
Without the option, the existing within-fit-band popularity ordering and
numeric requirements are unchanged.

## Record what is unknown

The following is a synthetic export record shape, not evidence that any real
screen was checked. Replace the IDs, scope, time and reason with actual
caller-owned evidence; do not copy its values into a real claim.

```json
{
  "record_kind": "unavailable",
  "signal_id": "screen-bookmarks",
  "metric": "bookmark-count",
  "subject_kind": "screen",
  "subject_record_id": "synthetic-choice-screen",
  "scope": "bounded synthetic collection",
  "category": "synthetic choice controls",
  "normalization": {
    "formula": "linear-bounds-v1",
    "lower_bound": 0,
    "upper_bound": 100,
    "direction": "higher-is-better"
  },
  "checked_at": "2026-09-04T01:00:00.000Z",
  "reason": "Synthetic capture shows a bookmark control but no public count.",
  "evidence_ids": ["synthetic-screen-metadata"]
}
```

An unavailable record has **no** `raw_value`, `normalized_score`, `as_of` or
`snapshot_at`. A check time is not a statistical measurement date. Normalization
remains bound policy metadata; no calculation is performed on the unknown value.
No zero, product MAU substitution, estimated count or guessed measurement date
is permitted.

The export remains a version-1 digest-bound manual manifest. Its actual
capture/metadata bytes, exact query/product/screen/frame/subject membership and
physical identity checks are unchanged. An unavailable product-level claim
and every known conflict must also appear in the submitted result: checking
membership only for records the child chose to submit is insufficient. Omitted
or duplicate conflicts fail closed. An unavailable product-level claim
repeated across screens must be canonically identical, including its
product-subject evidence; mixing numeric and unavailable claims for that same
product signal fails closed rather than selecting a convenient version.

The child result uses `availability: unavailable` and `id` in place of the
export's `record_kind` and `signal_id`. Other fields retain their exact meaning
and membership. See
[`reference-popularity-unavailable.schema.json`](../schemas/reference-popularity-unavailable.schema.json).

If any signal is unavailable, the reference's popularity status is
`unavailable`, its aggregate score is null, and the critic must leave
`popularity_verified` false. The independent critic must nevertheless verify
the evidence describing the absence before eligibility. Other observed signals
and their conflicts remain in the record. One signal cannot be both unavailable
and conflicted. Unavailable evidence is not a weak-source, copy-risk, coverage
or Owner exception.

## Run with the existing CLI

A clean checkout of the exact reviewed follow-up commit contains this option;
pushing a branch does not update an already installed plugin cache.

```bash
npm ci --ignore-scripts
node bin/killsloprouter.mjs reference run \
  --brief examples/reference-brief.fit-only.example.json \
  --root "$PWD" --dry-run --json
```

The bundled example has no executable reviewers and intentionally exits **6**
(`manual_pending`). It is an installation/contract check, not executed research.

For a real project, bind its reviewed external planning, research authorization,
rights, genuine exports, coverage and allowed host adapters in a new brief, then:

```bash
# Run from the target project; point to the exact reviewed checkout.
KSR_CHECKOUT=/path/to/reviewed/killsloprouter
node "$KSR_CHECKOUT/bin/killsloprouter.mjs" reference run --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json --root "$PWD" --dry-run --json
node "$KSR_CHECKOUT/bin/killsloprouter.mjs" reference run --brief .killsloprouter/reference-brief.json \
  --host-config .killsloprouter/host-adapters.json --root "$PWD" \
  --out .killsloprouter/reference-run.json --json
```

Follow [reference intelligence](reference-intelligence.md) for real independent
results, Owner selection, pack compilation and design binding. Missing adapters
remain manual; missing source exports still block. No capture pixels or source
identities reach creators, and reference selection does not authorize source
asset reuse or whole-screen copying.

## Compatibility and rollout

- This is additive and opt-in; existing briefs, default packet/output shapes,
  ranking, no-reference design flow and exact-three matrices are unchanged.
- Exact export-set validation also rejects previously accepted malformed results
  that omitted or repeated conflicts. Such a historical run may now fail on
  resume. Preserve its evidence; start a successor run instead of re-signing or
  deleting the missing/conflicting records.
- Older builds may reject the new property or unavailable record. Do not call
  that successful processing. Pin a capable reviewed build; keep global plugin
  installation/migration a separate explicit operation.
- Policy and records are covered by the existing brief/authority/packet/result/
  selection/pack hashes. Never edit an active or completed ledger to enable it.
  Start a new run from verified external sources and obtain fresh Owner selection.
- Approval of this software patch is not source selection or product UI approval.
  Private screenshots, session exports, product approvals and live traces do not
  belong in the public repository.
