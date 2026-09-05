---
name: kill-slop-router
description: Bootstrap, continue, and run the safest eligible stage of a project-aware, fail-closed anti-AI-slop journey with independent reviewers, browser evidence, resumable receipts, owner approval, and gated design-system extraction. Use when the user says KillSlopRouter, killsloprouter, "킬슬롭", "이 프로젝트 정리해", anti-slop routing, AI slop audit or removal, asks to apply the process to a new repository, or wants evidence-backed creator, critic, browser, privacy, domain, and approval gates. This is the top-level entrypoint for those requests; route antislop as a digest-locked child critic instead of starting its standalone workflow in the parent session.
---

# KillSlopRouter

Use the plugin's bundled `bin/killsloprouter.mjs` CLI as the deterministic route
authority. Resolve the plugin root two directories above this skill directory.
Do not substitute an ad-hoc prompt workflow for the CLI ledger.

## Parent identity invariant

An explicit KillSlopRouter request binds the namespaced
`$killsloprouter:kill-slop-router` entrypoint as the sole orchestrator for the
whole journey. Create and preserve the CLI's digest-bound `journey_identity`
through compaction, resume, retry, dispatch, child execution, owner approval,
and final reporting. A continuation such as `계속 진행해`, and a correction
such as `왠 antislop? 킬슬롭라우터 아니야?`, must resume KillSlopRouter rather
than start or expose a child workflow.

Always call the active workflow **KillSlopRouter** in commentary and final
reports. A provider name may appear only with internal-role qualification, for
example: `KillSlopRouter 내부 critic인 anti-slop`. Never say that antislop,
anti-slop, a creator, scanner, browser provider, or reviewer is the active mode,
workflow, or orchestrator. Preserve its exact `provider_id` in packets and
receipts with `participant.visibility: internal`.

The standalone `$antislop` workflow remains compatible only when the user
explicitly invokes it outside an active KillSlopRouter journey. Once a
KillSlopRouter identity is active, child wording cannot replace the parent.

## Single entrypoint

Keep this skill and the CLI as the only top-level workflow when the request is
for KillSlopRouter. Do not start a separately installed `antislop` wizard, ask
its DURING/AFTER question, apply it in the creator session, or report its direct
output as a Router run. `anti-slop` is the provider ID for the routed
`functional-human-review` packet. Bind its exact skill root with
`host configure-codex --skill-provider anti-slop=/absolute/skill/root`; the
Router then starts it in a fresh read-only child through `skill-json-v1`.

If that binding is absent, weak, changed, or configured as an agent, leave the
packet `manual_pending`. A separately produced antislop review may be ingested
only as an explicitly manual result and remains `manual_recorded`, never `ran`.
The child applies antislop as a filter after visual authority is resolved; it
does not install skills, choose usage mode, create or fix the artifact, or
override the verified visual intent and signature.

## Start in a project

1. Locate the project root and read its product, planning, brand, design, locale, privacy, and authority contracts.
2. If `.killsloprouter/profile.json` is absent, determine a stable project ID, explicit locale, and semantic product surface. An ERP/admin/staff workflow is normally `operator-product-ui`; a customer product is `consumer-product-ui`; editorial acquisition content is `marketing-editorial`. Infer the surface only when repository evidence is unambiguous, report that inference, and stop for the owner when it is ambiguous.
3. Run:

   ```text
   node <plugin-root>/bin/killsloprouter.mjs bootstrap \
     --root <project-root> --project-id <id> --locale <locale> \
     --surface <surface> --json
   ```

4. Treat the generated host manifest as manual-only. Bind real project contracts in the profile. Replace a manual adapter only when its entrypoint, digest, permissions, strength, and complete capabilities are known. When the owner explicitly authorizes external Codex review, the optional `host configure-codex` flow in `<plugin-root>/docs/codex-review-host.md` may bind selected audit reviewers. Never infer that network grant, never store credentials, and never use the bridge for scanner, browser, design creation, or owner approval.
5. Resolve the generated `visual_intents` entry from project, brand, approved-reference, or explicit owner evidence. Surface is semantic, not aesthetic: `marketing-editorial` does not authorize a paper/editorial look, and `operator-product-ui` does not prescribe a gray dashboard. Never use scanner output or anti-slop rules as visual direction.
6. Keep visual intent unresolved when evidence is ambiguous. When direction already has exact project authority, create the receipt described in `<plugin-root>/docs/visual-intent-contract.md`, bind every evidence digest, and copy the exact mode, editorial boundary, energy, depth, `preserve`, and `avoid` values into the profile. Use editorial mode only when the evidence explicitly requires it; use `bounded` only with named scopes.
7. If direction is genuinely undecided and the task needs visual creation, use `<plugin-root>/docs/design-exploration.md`. Build a brief from product and repository evidence with exactly three distinct project-specific theses, not three renamed style presets. Run the 3×3 direction matrix through authorized creators and separate Playwright packets using self-contained digest-bound prototypes, stop for the real owner to shortlist three, run the 3×3 color matrix, and stop again for exact owner approval. Missing adapters remain `manual_pending`; never author the owner files yourself.
   When service planning is locked but the design inputs are still generic, the
   owner may explicitly authorize the optional
   `<plugin-root>/docs/reference-intelligence.md` stage first. Use UI Bowl or
   another future approved source only as provenance-bound reference evidence.
   In manual mode require a schema-valid, digest-bound export manifest and exact
   membership for products, screens, frames, URLs, popularity, and the actual
   evidence files. Pin each evidence file's content, digest, and physical
   identity; close it over the enclosing product/screen, enumerated frames, and
   explicit subject bindings. Observations must cite their bound screen/frame,
   and popularity must cite the same product-or-screen subject. Never let a
   provider invent or widen any of those fields, signal scope, category, or
   normalization.

   Rank popularity strongly only within an equal product-fit band, never across
   fit bands or over hard gates. Recompute every signal and weighted score, rank
   conflicted popularity last without making an otherwise sound reference
   ineligible, and require repeated product-level claims across screens to be
   canonically identical or explicitly conflicted. Permit Owner selection only
   for independently verified `copy_risk: low` references. Require multi-frame
   task evidence, screen-role
   and evidence-strength labels, product/category/ecosystem/cohort diversity,
   and a promotional-evidence firewall. Every transferable principle must trace
   visible priority to the supported user decision, likely constraint,
   flattening consequence, application conditions, tradeoff, harmful context,
   live-data dependency, and anti-copy boundary.

   Route distinct researcher and critic children and stop for the owner to
   select one anchor plus cross-product/category/ecosystem supports. The full
   pack may retain selected source identities, links, verified observations,
   causal reasoning, grammar, and a path-free source-evidence digest manifest;
   it contains no capture bytes or paths. A downstream creator receives only an
   aliased, source-identity-free projection of causal reasoning and transferable
   grammar. Treat research completion and design readiness separately. Require
   the pack's router-recomputed `reviewer_source_capture_readiness` to be
   `ready_at_compilation`, with no uncovered selected reference or verified
   observation; `manual_pending` is valid research output but cannot start
   design. Revalidate the exact capture coverage at design start. The optional
   `reference_pack` must bind its exact completed producer
   state and `reviewer_source_access` version 1 in
   `digest-bound-internal-critic` mode. Limit its purposes to
   `promotional-citation-firewall` and `source-composition-independence`, its
   evidence kind to `source-capture`, and set redistribution, creator access,
   browser-provider access, and external network false. Only an
   `independent-reviewer` packet may receive the derived
   `review_source_authority` and actual read-only artifacts under
   `reference-evidence:read`; creator/browser packets must forbid that
   permission and `network:external`, omit source authority, and preserve
   `source_pixels_exposed_to_downstream_creator: false`. Bind the derived
   authority's source-recipient provider and actor IDs across runs: none may
   return as a direction/color creator or browser participant, while independent
   reviewer reuse is allowed. Preserve the canonically ordered, digest-bound
   source-recipient execution lineage from the producer; it may be empty only
   for entirely manual production and must never be synthesized. Require
   per-dimension traces and apply the eleven
   fixed checks by stage: ten for direction and two
   for color, with source-composition independence shared. Bind
   `reference-capture-set` to `reference-authority/source-capture-set` and the
   reviewer analysis to a schema-valid
   `review-evidence/source-composition-analysis`. Preserve only the capture-set
   and direction/color analysis digests in the final binding, never source
   paths or pixels. It may supply reasoning
   to the unchanged exact-three design route, but it does not authorize visual
   intent/signature, select a thesis, start an unapproved creator, or replace
   Playwright and Owner gates. Missing or unverified source access remains
   `manual_pending`; do not scrape or silently enable MCP.
8. Resolve `visual_signatures` separately. Inspect approved design tokens, CSS variables, theme configuration, brand mappings, fonts, type hierarchy, density, radii, geometry, strokes, shadows, separation, imagery, and motion for the routed surface. A value's frequency or presence in a logo is discovery evidence only, never proof of its UI role. Do not combine signatures from other product surfaces.
9. If every aspect is authoritative, create the receipt described in `<plugin-root>/docs/visual-signature-contract.md`, map all nine aspects to digest-locked evidence, and copy the exact signature into the profile. If design exploration completed, use only its compiled `profile-bindings.json`; do not reinterpret the selected palette or style. If any role or source conflict is material, keep the signature unresolved and stop before creation. Never fill unresolved fields with an editorial, neutral, flat, or trend-based default.
10. For a UI artifact, inventory the critical routes and interactive states before approval. Write deterministic Playwright scenarios for primary navigation, requested components, dialogs/drawers, empty/error/loading and permission states, and mobile behavior. Put the reviewed IDs in `evidence.required_scenarios` or pass `browser configure --required-scenarios`; every required scenario needs a state assertion. A visible `body` alone is not sufficient for an existing product. Keep the configure-generated `scenario_digest` and `browser_contract_digest`; do not weaken scenario actions, assertions, or viewport definitions between observation and redesign.
11. Use the official Playwright adapter only when the project's reviewed server URL is already running or the user explicitly starts it. Run `browser attest` for the exact artifacts and make the project serve that JSON at `/.well-known/killsloprouter-artifact.json`, then run `browser configure`. Never infer or execute a dev-server command.
12. Run `doctor`, then an integrated `run --dry-run`. Doctor validates project/profile authority only; `automation-ready` does not mean a host or browser ran. Treat `configuration_required` as a blocker. Do not edit the artifact while the route is blocked.
13. For an existing UI improvement, follow `<plugin-root>/docs/existing-ui-closed-loop.md`: before any edit, complete a runtime `task audit` through execution, result ingest, scanner triage, conflict adjudication, and finalization. The browser result must come from the official Playwright child adapter and cover every required scenario × viewport. Use that state as `--observation-run` for the later runtime `task redesign`; a manual/custom browser result cannot substitute.
14. Start each `run` with state below the project's `.killsloprouter/` directory. Use the actual creator provider and session actor ID. Resume the same state until it is complete or an exact external action is required.
15. Never overlap `run --out`, `run --resume`, or identity migration for the same state. An active state lease is a hard blocker. After a real orchestrator crash, inspect it with `lease status`; recover only with the exact owner token, acquisition timestamp, and state digest after `recover_after`. If recovery records `abandoned_after_crash`, require an explicit packet/provider/stage retry and never report the unknown child as `ran`.
16. Retain the `resume_authority_digest` printed by a modern start outside the mutable state directory. Every integrated `run --resume` must pass that original value with `--authority-digest`. Never obtain a replacement value from the state being verified; if the original caller-held value is unavailable, fail closed and start a new journey from verified sources. The evidence-free `--migrate-identity` path is the only legacy bridge: it requires a byte-identical pre-mutation state backup outside the state directory plus that backup file's caller-retained SHA-256, accepts only a positively supported historical source and exact pre-identity shape, and emits a new resume authority for later resumes. Retain the backup because migration verification remains bound to it.
17. Treat every pre-contract reference-intelligence preview as historical
    evidence only. Do not hand-edit, re-sign, or resume it. Start a new
    reference run from the unchanged external planning and Owner authority,
    regenerate dry-run, packets, all child results, Owner selection, and pack,
    then restart any design exploration that had bound the preview pack so its
    reviewer source-access, capture readiness, capture-set authority, and
    source-recipient separation plus its digest-bound execution lineage are
    newly generated. A
    design brief with no `reference_pack` keeps the existing exact-three flow.
    Likewise, never backfill a design or reference automated attempt that lacks
    its immutable execution-authority snapshot (and, for reference attempts,
    the pinned authority-source sidecar) from a current host manifest. Start a
    new run from verified external inputs; inspection-only/manual attempts do
    not become automated evidence. Do not adopt an `approved/` or staging
    directory left by a pre-transaction design run: only an exact sealed
    `pending_finalization` checkpoint may be resumed. Preserve legacy output as
    historical evidence and restart the design journey from unchanged external
    authority.

Use the command forms in `<plugin-root>/docs/automation-run.md`. Never overwrite an
existing bootstrap configuration; inspect and migrate it deliberately.

## Default journey

When the user gives only a short request such as `KillSlopRouter로 ./src 전체 여정
진행해`, treat it as `continue`: inspect the repository and advance the safest
currently eligible stage without asking the user to restate CLI flags.

1. Reuse a matching active automation state below `.killsloprouter/`; resume it
   instead of starting a duplicate run, but only with the original caller-held
   resume authority. Ask only when multiple active states make the intended
   artifact ambiguous. If a modern state's authority value is unavailable, do
   not derive it from that state; report the blocker and start over only when
   the owner has authorized a new journey.
2. Read external planning, visual-intent, and visual-signature evidence. If product intent,
   artifact scope, visual character, exact signature, editorial boundary, or the required
   planning receipt is absent, stop with the exact missing evidence. Do not
   synthesize PRD, UAC, IA, data authority, visual authority, or owner decisions.
   When product evidence is sufficient but visual direction is not, offer or
   resume the design exploration instead of routing directly to a generic taste
   creator. Preserve all owner stops.
   When planning declares `baseline_lineage`, keep the original all-product
   parent and the newer scoped candidate together: route only the exact slice
   artifact set, make exact G7 owner scope binding mandatory, preserve named
   inherited dimensions, and never promote the candidate by version number.
   The G7 decision must be `candidate-slice-binding` with
   `parent_promotion: false`. Parent replacement requires a separate all-scope
   planning proposal and explicit owner authority.
3. For an existing UI improvement, collect and finalize the official pre-change
   runtime observation before changing any artifact. Then verify the redesign
   route with that `--observation-run` and hand the exact artifact plus both
   verified visual contracts and bound findings to the single selected creator. Do
   not include critic anti-pattern lists as a replacement design brief. If that
   creator is unavailable through an authorized integration, emit the handoff
   and remain `manual_pending`.
4. Audit the changed artifact with the same required scenario inventory,
   separate critics, scanner triage, conflict adjudication,
   locale/domain/privacy checks, official browser evidence, and owner scope.
5. Continue to `systemize` only when the planning bridge verifies G6T and exact
   G7 approval for the unchanged artifact. Audit the extracted candidate design
   system independently; never promote it merely because extraction completed.

Infer project ID, locale, changed dimensions, and artifact paths from repository
evidence when unambiguous. Surface inference has an additional hard boundary:
write it into the profile's artifact bindings before routing, never treat it as
an aesthetic preset, and stop for the owner if the product audience or artifact
root is ambiguous. Report every inferred value before execution. Never infer an
owner decision, adapter permission, reviewer identity, or evidence.

Do not infer visual style from the surface label. Infer a visual-intent contract
only from explicit project, brand, approved-reference, or owner evidence. Report
the evidence and values before creation. If the evidence merely says "editorial"
as a content type, keep editorial visual treatment forbidden until its visual
meaning and scope are explicit.

Do not infer a visual signature from aesthetic taste. First identify exact
roles and observable behavior from same-surface authority: main/accent colors,
background and surface colors, text and semantic colors, typography, density,
shape, elevation, imagery, and motion. Report the evidence and any conflict.
Color frequency, a logo swatch, scanner hits, a craft critic, or a reference
from another surface cannot authorize a role. Style labels such as operational,
warm consumer, expressive, cinematic, playful, luxury, technical, campaign, or
editorial may describe evidence but never choose concrete values by themselves.

## Rules

- Select one creator per artifact.
- Resolve surface from the profile and exact artifact roots before selecting that creator. Treat CLI `--surface` only as an assertion; never use it to override the contract.
- Split artifacts into separate runs when they resolve to different surfaces.
- Resolve visual intent independently after surface resolution and before creator selection.
- Resolve the exact visual signature independently after intent and before creator selection.
- Preserve the contract's character, energy, depth, and named qualities; do not normalize every project into gray, flat, paper-like, shadowless, or low-energy UI.
- Preserve approved palette roles and tokens, typography, density, shape,
  elevation, imagery, and motion. Treat every `forbidden_transformations` entry
  as a hard creation and review boundary.
- When direction is missing, require the 3×3 direction matrix, independent
  Playwright evidence per artifact, owner shortlist of three, 3×3 color matrix,
  computed color-role contrast, and exact owner approval before binding intent
  or signature receipts.
- Permit editorial treatment only when the verified contract says `bounded` or `required`, and never outside `editorial_scope`.
- Run overlapping tools as separate critics with different questions.
- Replace unavailable or weak tools only with capability-complete fallbacks of
  equal or greater minimum strength.
- Combine multiple fallback providers when necessary; block the stage if their
  capability union is incomplete.
- Never let the creator self-approve.
- Treat scanner hits as candidates, not verdicts. Treat zero hits as scanner output, not design approval.
- Let hard product, truth, accessibility, privacy, and authority failures block approval.
- Require browser evidence for visual and interaction approval.
- Require a non-empty reviewed critical-scenario inventory for scoped UI runs,
  and require each scenario at every required viewport plus non-screenshot proof.
- For runtime redesign, require a digest-bound pre-change audit executed by the
  official Playwright child adapter. `doctor`, `plan`, manual screenshots, or a
  generic browser child are not observation evidence.
- Treat missing Playwright baselines as an approval stop: review candidate screenshots, copy only owner-approved pixels, rerun `browser configure` to lock the baseline digest, then retry `browser-evidence`.
- Do not describe ARIA snapshots or axe output as a real screen-reader session. Require separate assistive-technology evidence when project risk demands it.
- Apply project locale and domain review after English-first tools.
- Report missing adapters as `manual_pending` or blocked according to the CLI state. Never pretend a tool ran.
- Treat service planning as an external authority. Read its gate receipt; do
  not recreate PRD, UAC, IA, ERD, or owner approval inside this router.
- Run `systemize` only after G6T and exact G7 approval evidence pass.
- Preserve a verified parent/slice `baseline_lineage` through state, packets,
  child requests, receipts, and owner scope. Parent or candidate tamper and any
  `supersedes_parent: true` slice declaration fail closed.

## Run contract

1. Resolve surface from the digest-bound project/artifact contract, then verify the separate visual-intent and visual-signature receipts, evidence coverage, and mutual compatibility before selecting a creator.
2. Classify task, direction, changed dimensions, scope, and risk from evidence, and verify any external planning receipt and its exact evidence digests.
3. Require every stage to be `ready_primary` or `ready_with_fallback` before execution.
4. Execute only adapters accepted by the explicit host manifest.
5. On `manual_pending`, use the emitted packet and a genuinely separate reviewer. If this session created the artifact, it must not author or approve that review result.
6. Ingest manual results with `run --resume ... --authority-digest ... --result`; they remain `manual_recorded`, never `ran`.
7. Classify every scanner candidate before adjudication. A clean scan cannot replace visual-intent/signature review. Resolve referenced critic conflicts without score averaging; the critic cannot override the exact signature.
8. Require browser screenshots plus non-screenshot check evidence when the packet requests them. For scoped UI work, verify every required scenario × viewport and preserve the same inventory before and after implementation.
9. Ask the real owner for the generated approval scope. Never manufacture approval.
10. Report final status, state digest, receipt digest, blockers, pending work, and the exact files used.

Exit `6` means the pipeline is correctly waiting for manual input. Exit `5` means a
hard blocker, tamper, rejection, or execution failure. Neither is success.

For a configured V1 host, `killsloprouter run` performs steps 3 through 10 as a
resumable fail-closed state machine. Pass the executable authority separately
with `--host-config`; never place commands in the project profile. A missing or
partial host adapter must remain `manual_pending`.

For a design-system extraction, route `--task systemize`. Preserve the approved
artifact's semantics, distinguish shared primitives from surface-specific
patterns, and produce tokens, component contracts, states, responsive profiles,
migration mappings, and drift controls. The extracted system is a candidate
until its own audit and owner approval complete.

Do not load every design skill into one generation prompt. KillSlopRouter is an
orchestrator, not a generator, linter, browser, or local design authority.
Use anti-slop, scanner, craft, and copy tools as independent post-creation
critics unless the verified route explicitly selected one creator. Never turn
their shared preference for specificity or restraint into a universal visual
style. The evidence-bound visual signature, not the critic, owns main color,
typography, density, geometry, depth, imagery, and motion.
