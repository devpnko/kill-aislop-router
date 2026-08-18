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
- [ ] CI covers Node.js 20 and 22 with read-only repository permissions.
- [ ] CI installs the pinned Chromium build explicitly and uses `KSR_PLAYWRIGHT_CHANNEL=bundled`.
- [ ] README commands were executed from a clean checkout or equivalent worktree.
- [ ] Migration notes describe the Node 20 floor and rejected profile execution fields.
- [ ] Threat model names the host child and identity limitations.
- [ ] Browser runtime, scenario, baseline, origin, and served-artifact boundaries are documented and digest-locked.
- [ ] Personal-plugin installation preserves unrelated marketplace entries and backs up refreshed installs.
- [ ] No real credentials, private artifacts, screenshots, or owner approvals are packaged.
- [ ] npm publication and GitHub Release remain separate, explicit owner actions.
