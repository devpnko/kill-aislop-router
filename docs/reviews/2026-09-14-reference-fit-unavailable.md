# Independent code review: fit-only unavailable popularity

Bounded review of `feat/reference-fit-unavailable` against base commit `4d632e74aecbde704242da0ad9c2dbf8a0b0356b`. Final check completed on 2026-09-15. This is independent code-review evidence, not formal reference-critic eligibility, Owner selection, or merge approval.

## Scope and outcome

Reviewed the changed runtime in `src/reference.mjs`, the five schemas listed below, and the reference test/fixture changes. Checked explicit opt-in, numeric-free unknowns, subject/policy/evidence binding, mixed known/unknown and known-conflict preservation, global fit-band / fit-score / ID ordering, legacy behavior, independent review gates, and pack/resume integrity.

Two P2 findings were reported and corrected. No additional substantiated defect was found within this bounded scope. This is not a guarantee about untested paths or the whole repository.

## Findings and revalidation

1. **P2 — discovery could omit an exported known conflict. Corrected.** With one unavailable signal and a different known signal, the discovery validator originally checked submitted records' membership without requiring the full exported popularity-record set. An independent in-memory probe removed the known conflict while retaining shared evidence; validation accepted the result. The correction collects all submitted signal/conflict keys, rejects duplicate conflicts, and requires exact set equality with the manual export (`src/reference.mjs:3111` and `src/reference.mjs:3117`). The actual-child omission regression at `test/reference.test.mjs:705` was independently executed and passed as part of the 29-test run below. This closes the reproduced omission route; it does not turn an unavailable value into a verified numeric claim.

2. **P2 — dry-run reported popularity ranking for fit-only mode. Corrected.** The preview originally always reported `within_band: popularity-descending`, contrary to execution and pack policy. `src/reference.mjs:5142` now reports fit-score ordering, explicit `fit-only`, and exclusion of unverified/conflicted popularity only in opt-in mode. The legacy three-field report remains unchanged. The comparison regression at `test/reference.test.mjs:606` was independently executed after this correction and passed.

## Checks personally executed

Using Node 26.8.1, after the first correction and before the final dry-run correction:

```sh
node --test --test-name-pattern='fit-only|unavailable|reference child processes rank popularity|weighted popularity is reproducible|independent critic self-review|conflicted popularity ranks' test/reference.test.mjs
```

Result: **29 passed, 0 failed**. Coverage included all/partial/no-unavailable opt-in execution, Owner stop, pack and idempotent resume, strict default rejection, malformed unavailable exports and child claims, known-conflict preservation and omission rejection, same-product consistency, critic verification/self-review/evidence gates, policy tampering, and selected legacy ranking/weighted-popularity regressions.

After the final dry-run correction:

```sh
node --test --test-name-pattern='^fit-only dry-run reports the actual policy and preserves legacy report shape$' test/reference.test.mjs
```

Result: **1 passed, 0 failed**. These are two separate runs, not a claim that the earlier 29 tests were rerun on the final snapshot. Scoped `git diff --check` also passed. Final hashes below were identical before and after the last test/read check.

## Final reviewed snapshot

SHA-256, with repository-relative paths:

```text
f2dc93c29c182c5abff061df689aa8c630220afefd93543009d254a32a50d313  src/reference.mjs
85b8229656ff01d6bc09fe46189a5594946ba34c345e5156cd628d9cc9fd0e6f  schemas/reference-brief.schema.json
1de861f5cf504507fc2d9ba59da14599c86bee99ecadff73be3ec8a4489baf4c  schemas/reference-pack.schema.json
d89c664059e649f540f5c02572bf8ef0c5050e5a856f37f90ae86d8e378b05b0  schemas/reference-result.schema.json
51fe7be6e4b007b0e156b46a20c02514929d4caf62e01f3ae90910d368f26286  schemas/uibowl-manual-export.schema.json
ee5f69eeb8861527e7c4596d5379cc9b2b7f26efd1b5f14b596b8273a5c7a670  schemas/reference-popularity-unavailable.schema.json
d0de289d5c924592c862e3f549ef03ad1ddad4c7e0a9e84918f0d8c60986e3a2  test/reference.test.mjs
b8cfc1f9d05dddfb1b950b98170cc83fe6416cf28263f2c2d5c275377d229796  test/fixtures/unavailable-popularity.mjs
82cb87ad708da33687b3164ebdf16d8336b5891c992e255a4877f6939cd8b5a6  test/fixtures/reference-host-adapter.mjs
```

## Limits and remaining gates

The reviewer did not run the full suite or installed-CLI checks, review documentation/examples, perform network/source/UI research, or modify implementation code. The author's separate test reports are not represented as reviewer-executed results. Repository-wide regressions, documentation/packaging checks, and the authorized commit/merge decision remain with their respective owners. Existing independent-reference review, Owner selection, downstream visual authority, and product approval gates are not waived by this review.
