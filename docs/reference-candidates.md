# Reference-per-candidate specimens

This optional route explores a justified number of independent, primary-reference hypotheses. Each run makes one rendered direction specimen, not nine direction/depth siblings or a color sweep. The canonical three-direction × three-depth route remains unchanged when `reference_candidate` is absent.

The route preserves constraint provenance, visual goals, actual locale/state/viewport observations, official browser execution, independent criticism, source blindness, leases and pinned artifacts. It does not infer Owner preference from a reviewer score, a popular reference, or passing tests.

For separately authorized comparison of actual source captures with target renders,
see [scoped source-craft review](source-craft-review.md). This opt-in adds a distinct
reviewer after target-only feedback; old reference access does not authorize it.
Without that stage, source-craft comparison remains unassessed.

## Plan before creation

Choose the number of hypotheses for this task. One is valid; more may be appropriate when primary references imply materially different approaches. The 24-run ceiling is a resource bound, not a quality quota. Record the reason and the exact future state paths shared by every candidate; a rejected run cannot later be silently replaced in that cohort.

Each new brief must contain:

- Exactly one `directions` entry and `color_strategies: []`.
- An existing `specimen_feedback` candidate ID selecting one direction/depth.
- A verified `reference_pack`, `component_craft`, explicit `visual_goal_contract` and `constraint_audit`.
- `visual_goal_contract.observation_locales` covering every project locale.
- A `reference_candidate` object, for example:

```json
{
  "reference_candidate_version": 1,
  "comparison_id": "exception-triage-two-hypotheses",
  "planned_candidate_count": 2,
  "planned_state_paths": [
    "/project/review/candidate-a.json",
    "/project/review/candidate-b.json"
  ],
  "candidate_count_rationale": "Compare two different primary-reference approaches to evidence grouping; do not multiply them by arbitrary depth or color quotas.",
  "primary_reference_id": "reference-id-from-this-verified-pack",
  "primary_grammar_ids": ["selected-verified-grammar-id"],
  "task_frame": "Help operators choose the next exception using comparable evidence, then inspect its proof."
}
```

Primary grammar and its reasoning closure must belong only to the named primary reference. Global anonymous grammar/causal aliases stay stable. Required recipe families and component craft mappings must still be satisfied; narrowing the primary subset cannot silently discard obligations. Reference identities, state path plans and source captures are not sent to creators. The packet receives only anonymous scoped recipe/reasoning and digest bindings. Supporting-reference blending is not implemented.

Keep the same project, screen, product, baseline bytes, baseline/editorial policies, evidence matrix, locales and task-frame text for the cohort. Assign independent creator, browser and critic identities across **all** candidates, and keep every creator/browser separate from the union of source recipients and executable identities. Existing per-run checks apply before dispatch; comparison checks cross-run independence again. This is a fail-closed detection step, not a claim to undo earlier disclosure: plan participants before running any candidate.

## Run and inspect independently

```sh
killsloprouter design run --brief candidate-a-brief.json --baseline baseline --out /project/review/candidate-a.json --host-config host.json --require-constraint-audit
killsloprouter design run --brief candidate-b-brief.json --baseline baseline --out /project/review/candidate-b.json --host-config host.json --require-constraint-audit
killsloprouter design status --run /project/review/candidate-a.json
killsloprouter design provenance --run /project/review/candidate-a.json
```

Resume and ingest use the normal design-run protocol. An eligible specimen stops at `specimen-feedback`; it never dispatches hidden siblings. To reject without expanding:

```sh
killsloprouter design run --resume /project/review/candidate-a.json --abandon-specimen --reason "This direction does not fit the task. Preserve its evidence."
```

`--expand-specimen`, the matrix shortlist, and final approval compiler are unavailable in this mode. Do not fabricate nine result records. Unrendered abandoned candidates remain explicitly unrendered.

## Compare actual evidence, then ask the Owner

```sh
killsloprouter design compare --runs /project/review/candidate-a.json,/project/review/candidate-b.json --out /project/review/comparison.json --json
```

Every predeclared run must have feedback or explicit abandonment. The report includes primary provenance, exact prototype/screenshot paths, browser and critic digests, accepted/rejected dispositions and a digest-bound task frame. All rendered candidates must use the same executed scenario digest, viewport dimensions, color schemes, locale, browser/runtime settings and browser version. Unrendered abandoned entries have no invented browser contract.

The Owner inspects actual rendered screenshots/prototypes and writes an external decision outside child-writable run evidence. Substitute real report values in this standalone input shape; no winner or approval is preselected by the tool:

```json
{
  "design_specimen_owner_decision_version": 1,
  "comparison_digest": "sha256:REPLACE_WITH_COMPARISON_DIGEST",
  "owner_id": "external-human-owner",
  "status": "select",
  "selected_run_id": "REPLACE_WITH_CRITIC_ELIGIBLE_RUN_ID",
  "observed_render_bindings": [
    {
      "run_id": "REPLACE_WITH_RUN_ID",
      "render_binding_digest": "sha256:REPLACE_WITH_RENDER_BINDING_DIGEST",
      "observation": "The actual compact and wide renders keep evidence aligned; the alternative crowds the primary action."
    }
  ],
  "rationale": "This rendered specimen best supports the target decision.",
  "planned_expansion": "Use these exact selected prototype bytes and this primary-reference binding as the starting artifact for a separately scoped expansion; add remaining states and obtain their required reviews.",
  "decided_at": "2026-10-05T09:00:00.000Z",
  "acknowledges_not_final_approval": true
}
```

Include one observation for **every rendered** candidate, including critic-rejected candidates. To reject all, use `status: "reject-all"`, `selected_run_id: null`, and `planned_expansion: null`; keep the rendered observations. With only unrendered abandoned candidates the observation array is empty. The Owner must be independent of the parent and every routed/source participant. This protocol checks identity separation and evidence bindings; it cannot authenticate a human's claimed viewing outside the tool.

```sh
killsloprouter design select --comparison /project/review/comparison.json --decision /project/review/owner-decision.json --json
```

Selection revalidates all runs, accepted browser execution, current evidence and Owner input. It atomically creates exactly one immutable `/project/review/comparison.json.selection.json`. It never overwrites an earlier choice. Selected prototype bytes are frozen inline as base64, along with their digest, primary recipe/reasoning provenance and exact browser/critic/Owner bindings. `reject-all` creates no selected artifact. Comparison and selection do not edit a product, profile, run, installation or design system.

The frozen artifact scope is **prototype HTML only; external dependency closure is not certified**. A later expansion is deliberately not automated: materialize/validate the selected bytes and any required dependency closure, start a new scoped run against that artifact rather than the old baseline, and preserve this receipt. This receipt is neither G7 nor final design-system approval, and target-only criticism does not certify source-grade aesthetic parity.
