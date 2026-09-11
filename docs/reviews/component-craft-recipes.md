# Component craft recipe implementation review

Date: 2026-09-11

Scope: optional reference-derived component craft and responsive recipes on
`feat/visual-component-recipes`, based on browser-state-proof commit
`e14b18c59cb8c3c8eec4567fbfcf8e8f592126c6` (PR #12). This is a separate
follow-up, not a modification to the existing dirty development worktree,
PR #6, a product baseline or an installed global plugin.

## Independent review

Reviewer: `component_recipe_review` (Kierkegaard), a separate read-only review
agent. The implementation author did not supply an approval decision. The
reviewer inspected code, schemas, tests, docs and package changes, and performed
in-memory schema checks. This is code-review evidence, not Owner authorization,
independent visual-quality certification or a claim that a production creator
has demonstrated the feature.

Three findings were returned and corrected before the final re-review:

1. The published design-packet schema initially rejected the new craft check.
   The correction adds a closed, design-packet-only check alternative. The fixed
   eleven-check reasoning registry is unchanged.
2. A child working in its evidence directory could not use package-relative
   schema paths. Packets now carry a closed schema with a canonical digest.
   A packet-only child test compiles it without Router/schema-directory access.
3. The test-only schema catalog did not resolve both historical published URI
   bases. Local aliases now change only the root `$id`, preserving validation
   constraints and fragment references. Regression checks resolve both packet
   schemas and confirm that an empty object is rejected.

The reviewer also requested execution coverage beyond direction selection.
The new lifecycle test continues through nine color candidates, independent
craft checks, fixture Owner decisions, final idempotent resume and subsequent
specification tamper rejection. Fixture decisions do not approve any product.

Final independent re-review: no additional confirmed defects; no identified
authority expansion, no-recipe flow change or human-authorship/visual-quality
overclaim. The reviewer explicitly left full-suite execution results to the
verification record below. This is not permission to merge.

## Verification boundary

The regression suite tests the protocol with synthetic adapters and specimens.
Official Playwright performs real local browser execution for the design matrix;
synthetic critics establish contract coverage, not whether a design is beautiful.

Local verification uses Node 26.8.1 because the machine's default Node binary
cannot load its installed library. Node 20 and 22 remain the existing CI matrix;
local Node 26 success must not be reported as either CI result.

Required handoff checks: `npm run check` (including `npm test`), the complete
`npm run test:e2e`, `npm run pack:check`, skill validation and `git diff --check`.
Package verification installs only an isolated temporary consumer, not the
user's global plugin.

Completed local results on 2026-09-11:

- `npm run check`: PASS; 252 tests, no failures/skips; 84 JSON and 28 Markdown
  static checks; isolated example doctor passed.
- `npm run test:e2e`: PASS; 345 tests, no failures/skips; 2,250,383 ms. This is
  the complete existing script, including child processes, official Playwright,
  concurrent resume, crash recovery and the new component lifecycle.
- Focused component unit/schema suite: 26/26. The standalone direction-to-color
  browser lifecycle also passed before the full E2E run.
- `npm run pack:check`: PASS; both examples, both schemas and the implementation
  module were present, and the isolated installed-consumer checks passed.
- Runtime-only and full dependency audits: zero reported vulnerabilities.
- Bundled skill validation, syntax checks for all 12 changed JavaScript modules
  and staged diff whitespace checks: PASS.

These are local results, not Node 20/22 CI results. Check both CI lanes on the
follow-up PR's exact head before rollout. They are also not real-product UAT or
an Owner approval of the synthetic specimens.

## CI timeout follow-up

Both Node 20 and Node 22 jobs for commit
`03f7e225d099c8946e0d0bda82d0fa5a110496d7` exhausted their 60-minute job budget.
Node 20 was cancelled during the complete E2E command and skipped the package
step. Node 22 completed E2E in 57m07s and passed the package step, but its whole
job was cancelled at cleanup. The [original CI run](https://github.com/devpnko/kill-aislop-router/actions/runs/34554641733)
is therefore cancelled, not passing. Completed steps and a local pass above are
not substitutes for a successful whole CI lane on the new head.

The follow-up moves all 42 design cases into `test/design-suite.mjs` and
registers them through eight deterministic entrypoints. The E2E worker limit
remains two; `node --test test/design.test.mjs` retains its complete standalone
behavior. Eight new inventory regressions verify exact names, disjoint and
complete assignment, callback/options preservation, valid selectors, actual
entrypoints, no skips/exclusivity, and real standalone/sharded execution.

The implementation author and the same independent read-only reviewer each
compared the extracted body with the prior commit: after removing only the
registration helper and restoring the test import name, all 152,311 bytes of
fixtures, test options, callbacks and assertions match. The reviewer found no
confirmed defect, lost test, overlapping fixture output, production contract
change or new Node 20/22 API requirement. This review did not execute the full
suite or CI and is not Owner or merge approval.

Completed follow-up local verification:

- `npm run check`: PASS, 260 tests, no failures/skips; static checks and example
  doctor passed on Node 26.8.1.
- New shard inventory: 8/8 on both Node 26.8.1 and Node 20.19.5.
- `npm run pack:check`: isolated install and consumer checks passed.
- Production dependency audit: no reported vulnerabilities.
- `npm run test:e2e`: PASS, 353 tests, no failures/skips/cancellations;
  1,542,114.5 ms (25m42s) on Node 26.8.1. All 42 existing design cases and the
  eight new shard regressions executed, alongside the unchanged full integrated,
  official Playwright, reference, identity, lease and dogfood inventory.

The preceding unsharded local run took 37m30s. These are observed run durations,
not a controlled performance benchmark or a guarantee for CI. Fresh exact-head
Node 20/22 CI results remain required before rollout.

The locally installed Homebrew Node 22 cannot start because its `simdjson`
dynamic library is missing. No global runtime or plugin was repaired or
replaced; the fresh CI Node 22 lane remains required.

## Remaining rollout and product gates

- Keep this follow-up dependent on PR #12; do not merge or publish automatically.
- Update an installed plugin only through a separately authorized, integrity-
  checked installation after the upstream and follow-up reviews.
- Start a fresh reference/design journey. Do not retrofit active/completed
  evidence or fabricate a new Owner selection for an existing run.
- Test real project cards and tables with long localized content, absent data,
  overlays, keyboard and pointer paths, all named sizes and intermediate widths.
  A scenario inventory or a written specification alone is not execution proof.
- An independent visual critic must inspect rendered craft and coherence with
  the project's visual signature; the real Owner must select and approve the
  direction. Existing G6T/G7 gates still govern systemization.
