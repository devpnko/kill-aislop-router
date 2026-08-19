# V1 Release Checklist

This checklist prepares a release. It does not authorize `npm publish` or a
GitHub Release.

- [ ] Working tree contains only reviewed V1 changes.
- [ ] Package and router versions agree.
- [ ] `npm test` passes, including child-process E2E fixtures.
- [ ] Real Playwright E2E proves attestation tamper, missing baseline, approved baseline retry, material visual change/diff, resume, and owner approval behavior.
- [ ] `npm run check` passes.
- [ ] `npm run pack:check` confirms required public files and excludes tests.
- [ ] The Codex plugin and bundled skill pass their official local validators.
- [ ] Bootstrap tests prove non-overwrite behavior and manual-only host readiness.
- [ ] Surface tests prove bootstrap requires an explicit value, the most-specific
      artifact binding wins, mismatches and mixed surfaces block, and profile
      tamper prevents resume/finalization.
- [ ] Visual-intent tests prove unresolved intent blocks, `marketing-editorial`
      does not imply editorial styling, editorial treatment requires explicit
      authority, and receipt/evidence tamper blocks finalization.
- [ ] Visual-signature tests prove exact palette/token propagation across a
      child boundary, full aspect coverage, legacy non-visual compatibility,
      intent/signature conflict blocking, and receipt/evidence tamper detection.
- [ ] Design exploration tests prove both 3×3 matrices, real child-process
      creation, separate Playwright evidence, partial capability, creator
      self-review, viewport omission, computed contrast, owner shortlist,
      owner approval, receipt compilation, artifact tamper, resume, and retry.
- [ ] Design matrix tests reject byte-identical prototypes, repeated palettes,
      weak distinctiveness, unbound static resources, malformed font evidence,
      and token specs that disagree with emitted role values.
- [ ] The example design brief describes an operator product without acting as
      a reusable style preset, and missing direction no longer falls through to
      `taste-skill`.
- [ ] Scanner-zero E2E proves a clean scan cannot replace the independent
      visual-intent/signature reviewer, browser evidence, or owner approval.
- [ ] CI covers Node.js 20 and 22 with read-only repository permissions.
- [ ] CI installs the pinned Chromium build explicitly and uses `KSR_PLAYWRIGHT_CHANNEL=bundled`.
- [ ] README commands were executed from a clean checkout or equivalent worktree.
- [ ] The packed tarball installs in a clean consumer and its installed CLI
      passes help, doctor, and manual-pending dry-run exit semantics.
- [ ] ERP/operator, B2C/consumer, and ko-KR high-risk dogfood fixtures preserve
      their distinct intent/signature contracts and keep privacy gates closed.
- [ ] Migration notes describe the required surface, visual-intent, and visual-signature contracts, missing-direction behavior change, Node 20 floor, and rejected profile execution fields.
- [ ] Threat model names the host child and identity limitations.
- [ ] Browser runtime, scenario, baseline, origin, and served-artifact boundaries are documented and digest-locked.
- [ ] Personal-plugin installation preserves unrelated marketplace entries and backs up refreshed installs.
- [ ] No real credentials, private artifacts, screenshots, or owner approvals are packaged.
- [ ] npm publication and GitHub Release remain separate, explicit owner actions.
