# V1 Release Checklist

This checklist prepares a release. It does not authorize `npm publish` or a
GitHub Release.

- [ ] Working tree contains only reviewed V1 changes.
- [ ] Package and router versions agree.
- [ ] `npm test` passes the bounded contract and security suite.
- [ ] `npm run test:e2e` passes the isolated child-process, Codex-host, design,
      and Playwright fixtures.
- [ ] Real Playwright E2E proves attestation tamper, missing baseline, approved baseline retry, material visual change/diff, resume, and owner approval behavior.
- [ ] Existing-UI E2E proves required scenario × viewport coverage, official pre-change observation binding, changed artifact digest, post-change rerun, and rejection of a generic browser child.
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
- [ ] Official Codex host tests prove agent and skill execution across both
      Node and nested-runtime child boundaries, fresh thread provenance,
      fixed read-only arguments, missing auth/runtime/skill `manual_pending`,
      partial capability blocking, reserved-gate refusal, and runtime/skill
      tamper detection.
- [ ] Codex host documentation states the external model data flow, credential
      non-storage rule, and the limits of the OS read-only sandbox.
- [ ] The example design brief describes an operator product without acting as
      a reusable style preset, and missing direction no longer falls through to
      `taste-skill`.
- [ ] Scanner-zero E2E proves a clean scan cannot replace the independent
      visual-intent/signature reviewer, browser evidence, or owner approval.
- [ ] CI covers Node.js 20 and 22 with read-only repository permissions.
- [ ] Feature branches produce one PR run, and superseded runs are cancelled.
- [ ] CI action dependencies use reviewed, immutable full commit SHAs.
- [ ] CI installs the pinned Chromium build explicitly and uses `KSR_PLAYWRIGHT_CHANNEL=bundled`.
- [ ] CI rejects high-severity production dependency advisories, and Dependabot covers npm and GitHub Actions without auto-merge authority.
- [ ] README commands were executed from a clean checkout or equivalent worktree.
- [ ] The packed tarball installs in a clean consumer and its installed CLI
      passes help, doctor, and manual-pending dry-run exit semantics.
- [ ] ERP/operator, B2C/consumer, and ko-KR high-risk dogfood fixtures preserve
      their distinct intent/signature contracts and keep privacy gates closed.
- [ ] Migration notes describe the required surface, visual-intent, and visual-signature contracts, missing-direction behavior change, Node 20 floor, and rejected profile execution fields.
- [ ] Threat model names the host child and identity limitations.
- [ ] Browser runtime, scenario, baseline, origin, and served-artifact boundaries are documented and content/physical-identity locked; Playwright packages execute from a private seal, scenario/baseline bytes cross only in parent-sealed authority, and same-byte replacement blocks before spawn.
- [ ] Every process adapter with local imports declares a reviewed module-graph
      digest; entrypoint and helper same-byte replacement regressions block
      before spawn, and the child loads only descriptor-fed sealed modules.
- [ ] Codex executable and complete runtime root carry content and physical
      identities, execute only from a private clone, and pass copy-race and
      same-byte replacement regressions. Multi-provider manifest validation
      reuses a digest-bound readiness probe without cloning the runtime per
      provider; the private clone remains mandatory at actual child execution.
- [ ] Root-owned or hard-linked declarative router assets pass start, resume,
      stale-lease recovery, and verified legacy migration while changed bytes
      or physical identity still fail closed. Profiles, approvals, manual
      evidence, and custom executable adapters keep the single-link ownership
      rule.
- [ ] Personal-plugin installation preserves unrelated marketplace entries and backs up refreshed installs.
- [ ] Canonical plugin catalog verification rejects empty/self-authored markers,
      carries no self-asserted provenance, binds trusted payload/runtime/skill bytes, and permits a pre-integrity
      marker only through an explicit backed-up `--force` refresh.
- [ ] Parent-identity tests cover Korean correction, compaction/resume,
      duplicate entries, packet/state tamper, permitted internal-critic wording,
      and standalone explicit `$antislop` compatibility.
- [ ] Legacy skill migration preserves a digest-identical backup, creates only
      an implicit-disabled handoff shim, leaves standalone antislop unchanged,
      and is detected by `doctor` if tampered. A self-consistent marker over
      different shim bytes, a non-shaped backup, an orphaned exact public shim,
      or a canonical-install digest mismatch also fails closed.
- [ ] State/audit migration accepts only evidence-free legacy runs and refuses
      to relabel any prior child execution evidence. Its positive fixture is
      serialized by a supported historical commit, requires a byte-identical
      external backup and backup-file digest, and a fully identity-stripped
      modern state still fails source provenance.
- [ ] Baseline-lineage tests prove immutable parent plus newer slice
      coexistence, exact candidate routing, no version-based promotion,
      parent/candidate tamper blocking, child/receipt propagation, owner digest
      binding, mandatory exact candidate G7 evidence with parent promotion
      denied, project-root/symlink enforcement,
      and re-signed resume conflict refusal.
- [ ] Modern resume tests prove the original caller-held authority is required,
      state-selected router/profile redirection and complete audit graph
      downgrade fail before child spawn, and forged `legacy-migrated`
      invocation cannot bypass the boundary.
- [ ] Start-authority tests prove the external
      `<state>.authorities/<run-id>.json` receipt is durable before the first
      state, binds original artifact digests, initial plan/planning/lineage
      authority, and all parent paths, and cannot be backfilled into a
      pre-receipt modern state.
- [ ] Initialization-authority tests prove
      `<state>.authorities/<run-id>.initialization.json` is written and
      state-bound before the first child, detects deletion of every mutable
      initialization anchor and binding, and is required after progress.
- [ ] Fault-injected startup crashes after authority issue, initial state,
      plan sidecar/receipt, planning-verification receipt, audit
      sidecar/receipt, packet sidecar/dispatch receipt, initialization-authority
      write, and pre-state-bind boundary recover
      without duplicate initialization attempts or reviewer child spawn; an
      absent-state crash retains the abandoned receipt and restarts with a new
      receipt after lease recovery.
  - [ ] A lineage-bound crash after the initial state resumes exactly once when
        its planning authority is unchanged and refuses changed planning bytes
        before plan, audit, packet, or child commit.
- [ ] Parent-path tests copy valid plan, audit, packet, final, and phase-receipt
      sidecars outside `<state>.d/`, coherently re-sign mutable state, and prove
      resume rejects each redirect before child spawn or ledger mutation.
- [ ] Integrated-input tests reject owner approval, scanner triage, and manual
      review files inside state or behind a symlink ancestor before ledger
      creation/mutation or another child start.
- [ ] Integrated-input tests require invoking-user ownership, reject
      group/world-writable authority, pin a read-only descriptor through parse,
      and prove successful ingestion leaves bytes, inode, mode, and mtime
      unchanged.
- [ ] Result-provenance tests retain the physical child evidence boundary and
      reject coherently re-signed audit source/evidence redirects outside it.
- [ ] Output-boundary tests accept only verified root-owned macOS `/tmp` and
      `/var` aliases, reject a pre-existing symlink above an implicit grant,
      and persist device/inode markers as lossless decimal strings through
      resume and finalization.
- [ ] Legacy migration tests place a symlink at `identity-migrations` and prove
      both the active graph and off-tree target remain byte-identical/empty.
- [ ] Audit tests prove caller-retained authority across dispatch, record,
      status/finalize; exact run/packet/journey/participant/lineage result
      binding; cross-parent replay rejection; and final reviewer-independence
      revalidation after coordinated ledger rewriting.
- [ ] Child-process evidence tests reject lexical escape, symlink components,
      hard-linked files, special files, and physical output-root replacement.
- [ ] Real child-process E2E proves concurrent resume starts only one reviewer,
      normal resume releases its lease, start/resume/migrate conflicts fail
      before mutation, and crash recovery requires token + timestamp + state
      digest followed by an explicit retry for an unknown child outcome.
- [ ] Fault injection proves a lease cannot release after prepare-before-write
      failure or after state replacement-before-commit failure.
- [ ] Writable-path fault injection swaps an ancestor immediately after
      preflight and immediately before JSON commit; lease staging and receipt
      writes fail closed with the redirect target empty.
- [ ] Modern crash recovery rejects the public lease tuple without the original
      resume authority before claiming the stale lease or rewriting state.
- [ ] Initialization-ledger tests keep `plan.json` while stripping audit,
      packet, and fixed receipt bindings, then prove normal resume rejects the
      unbound anchors before child spawn. A prior unrelated recovery receipt
      grants no exception, while current authorized stale-lease recovery emits
      a version-3 receipt binding deterministic anchor IDs, the external
      initialization authority, and its non-circular graph digest. Fault-injected
      crashes at every reconstruction receipt/sidecar, after recovery-receipt
      write, before state write, and after state write preserve one set of bytes,
      one receipt, and one state checkpoint.
- [ ] Child-boundary tests delete and replace both caller-visible authority files;
      no child attempt is accepted and the exclusive lease remains held.
- [ ] Planning/G7, start/initialization, phase/migration/final receipts, routed
      router/profile and route-plan sources, visual authorities, and Playwright
      scenarios use one descriptor for parse plus digest. A real path/inode
      swap is rejected, including the final pre-child route-plan check.
- [ ] Every reviewer pre-spawn re-pins current profile, visual authority/evidence,
      and file artifacts; changed bytes or an inode swap leaves the child start
      marker absent.
- [ ] Playwright parent/child handoff normalizes manifest-relative paths and
      rejects same-byte symlink or inode substitution before browser spawn.
- [ ] Initial-path tests prove state, lease, router, and profile symlink
      ancestors fail before any parent-owned state/sidecar write while normal
      canonical platform aliases remain supported.
- [ ] Standalone audit tests prove init preflights both run and packet paths,
      dispatch cannot create a redirected packet directory, record/triage
      cannot mutate a run through a symlink ancestor, and explicit receipt
      `--out` leaves the symlink target empty.
- [ ] Standalone record, triage, and approval tests prove parse and provenance
      use one pinned descriptor and reject path replacement between read and
      source binding.
- [ ] `run --dry-run --out` and `digest --out` reject symlink ancestors and
      leave the redirect target empty; stdout remains pipeable transport.
- [ ] Sidefy parent-identity UAT passes explicit invocation, Korean correction,
      compaction/resume, official Playwright observation, parent-versus-child
      wording, tamper refusal, and separate standalone explicit antislop.
- [ ] No real credentials, private artifacts, screenshots, or owner approvals are packaged.
- [ ] npm publication and GitHub Release remain separate, explicit owner actions.
