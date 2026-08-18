# V1 Release Checklist

This checklist prepares a release. It does not authorize `npm publish` or a
GitHub Release.

- [ ] Working tree contains only reviewed V1 changes.
- [ ] Package and router versions agree.
- [ ] `npm test` passes, including child-process E2E fixtures.
- [ ] `npm run check` passes.
- [ ] `npm run pack:check` confirms required public files and excludes tests.
- [ ] CI covers Node.js 20 and 22 with read-only repository permissions.
- [ ] README commands were executed from a clean checkout or equivalent worktree.
- [ ] Migration notes describe the Node 20 floor and rejected profile execution fields.
- [ ] Threat model names the host child and identity limitations.
- [ ] No real credentials, private artifacts, screenshots, or owner approvals are packaged.
- [ ] npm publication and GitHub Release remain separate, explicit owner actions.
