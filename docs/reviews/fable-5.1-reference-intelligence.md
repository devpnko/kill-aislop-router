# Fable 5.1 reference-intelligence review evidence

This records independent, read-only code review evidence for the optional
KillSlopRouter reference-intelligence stage. It is not an Owner approval,
visual-direction decision, or release authorization.

## Review boundary

- Reviewer runtime: Claude CLI `--model fable --effort max`
- Permissions: plan/read-only; `Read`, `Glob`, and `Grep` only
- Explicitly denied: shell execution, editing, writing, and network tools
- Persistence: disabled
- Reviewed implementation: `src/reference.mjs`, `src/state-lease.mjs`,
  `src/integrity.mjs`, `src/cli.mjs`, reference tests, and crash fixtures
- Primary question: can a crash after a child result is durably checkpointed
  but before lease commit cause permanent loss or duplicate child execution?

## Independent verdicts

The first final review returned `MERGE_READY`, stated that the prior P1 was
resolved, and reported no blocker. It verified the atomic write ordering,
lease-bound current/pending state digests, exact packet/provider/attempt/result
checkpoint match, tamper rejection, recovery idempotence, and the direct
no-duplicate-child assertion.

- Output bytes: 8,836
- Output SHA-256:
  `2a8c3ca049192eea5208d79f584af4d7bf79ba79e85cc93c61f6830a6c81d964`

The focused follow-up also returned `MERGE_READY` with zero blocking findings.
It verified that the added recovery fault injection is not exposed by the CLI,
the recovered state is visibly `manual_pending`, a recovery-write crash
converges on one receipt, a completed child remains single-run, a second
successful-recovery call cannot duplicate the receipt, and a state re-sealed
outside the lease transition remains locked.

- Output bytes: 5,439
- Output SHA-256:
  `154eb695c55395faced91454d6fe6de6c9f0af4ebc8bc9ac1a415ae861b16632`

The final full-module security and product-contract review returned
`MERGE_READY`, reported no P0/P1 finding, and marked all five requested claims
PASS: single-descriptor authority input, symlink-safe writes, exact generated
JSON provenance, critic-verified component/pattern coverage, and preservation
of parent identity plus lease recovery.

- Output bytes: 10,413
- Output SHA-256:
  `8b4ab985828bf3cc45c1f092b531806958a31d9339ca610952a5d34edae39186`

## Findings closed after review

The reviewer identified one remaining non-blocking test gap between recovery
lease completion and the first recovery-receipt state write. The implementation
already converged through `recovered_from`; the branch now also has the direct
fault-injection regression:

```text
recovery completion crash converges before its first receipt write
```

The final reviewer also found a non-blocking adapter-contract mismatch: a
blocked disposition could declare empty verification arrays in the schema but
the runtime required non-empty arrays. The final contract now permits empty
verification for blocked references and requires non-empty component, pattern,
observation, inference, and grammar verification only for `eligible`
references. The low-coverage fixture exercises that distinction.

The reviewer also noted that manual result evidence could point anywhere the
caller account could read and that dispatch could re-emit completed packets.
The final implementation confines manual evidence to the submitted result
directory, resolves relative paths from there, and dispatches unresolved
packets only. Dedicated regressions cover both behaviors.

The final reference test inventory also covers:

- simultaneous resume rejection before a second child starts;
- unknown child outcome requiring explicit retry;
- post-child state-write/pre-lease-commit recovery;
- recovery-state-write/pre-lease-commit idempotent replay;
- recovery-complete/pre-state-write convergence;
- internally re-sealed state outside the lease-bound transition;
- single-descriptor authority binding, symlink-safe state/dispatch creation,
  and packet-file tamper rejection;
- critic-verified component and pattern coverage rather than researcher-only
  labels;
- self-review, partial capability, evidence tamper, owner-template misuse,
  popularity-over-fit attempts, and downstream source-pixel access.

## Residual boundary

The local integrity model does not authenticate an adversary who controls both
all same-user files and the caller-held recovery tuple. UI Bowl access and
rights were not exercised by this reviewer. Real reference selection remains
an explicit Owner gate, and the reference pack remains discovery evidence
without visual-intent, visual-signature, creator, or release authority.
