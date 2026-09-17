# Independent bounded reference-delivery review — 2026-09-16

Reviewer: `/root/reference_delivery_review`, separate from the implementing
agent. This was a read-only implementation review followed by authorization to
write this evidence document only. The reviewer made no implementation edits.

Result: three P2 findings were independently reproduced, corrected by the
implementer, and independently rechecked. No further concrete findings remained
within the bounded scope below. This is not Owner, visual, merge, publication,
installation, or whole-stack approval, and is not a KillSlopRouter gate receipt.

## Scope and exact reviewed bytes

Reviewed worktree: `/Users/hyuk/PETA/killsloprouter-reference-delivery-worktree`,
branch `fix/reference-delivery-contract`, with base HEAD
`a3252def429ef0c56b7a04666d1db2084a9e72fc` plus its working changes.

The scope was the new reference requirement and CLI assertion, child-before-gate
behavior, resume persistence, provenance reporting, required component-family
application, and package/entrypoint integration. Package/install integration was
inspected statically and with a temporary copied-bundle fixture, not by installing
a plugin. The latest skill guidance was also checked for the distinction between
bundled research, actual project binding, and bounded fixes that do not require
new reference research.

These SHA-256 hashes identify the reviewed file bytes at closeout; they do not
claim exhaustive review of every pre-existing line. They were checked again
after the final 54-test run. Later changes to these files are outside this note's
byte-specific review.

| File | SHA-256 |
| --- | --- |
| `src/design.mjs` | `8de8e24bb464383410b1c1f03a15b1613b32c58b7017750feab3dfac0669612a` |
| `src/component-recipes.mjs` | `f134b6e864ce3e3e4f58d9bc279c6df63a9209de888d3cbd9224d4de0a47f819` |
| `src/cli.mjs` | `92610c12317e017c9dccb27503fc9aa6fa09a5e10dabfc45fbfcaf37106747f4` |
| `src/distribution.mjs` | `b43f6665a65d219886268d5877bbf7e90f34f1398008bd98da436097e77b55dc` |
| `schemas/design-brief.schema.json` | `f1451307aca0f29f7f03f05bc7b864d838e67f08ca18e97d07ab939a1f66cda5` |
| `skills/kill-slop-router/SKILL.md` | `9d38be235671ea635e62ddf418b2b148e340cf526f37ce73409878925d101af2` |

## Reproduced findings and checked fixes

### P2-1: Public continuation ignored the required-reference assertion

Before correction, the exported `continueDesignExploration(state, options)`
forwarded `requireReference: true` to a shared helper that did not consume it.
In a temporary no-reference run, `resumeDesignExploration` correctly rejected
the assertion, but `continueDesignExploration` with `retry: "all"` and an
allowlisted local fixture provider spawned nine fixture attempts. A marker file
proved the child executed. The fixture intentionally failed; no model or browser
was invoked.

Checked fix: `src/design.mjs:4211` now consumes the option in the shared
lease-bound continuation and asserts it at line 4220, before execution, state
mutation, or the completed-state return. The regression named
`public continuation enforces the same assertion before a real fixture child can spawn`
passes with no marker and byte-identical persisted state.

### P2-2: Default status trusted a forged cached provenance report

Before correction, `formatDesignState` preferred a persisted
`state.reference_delivery` over a derived report. Starting an ordinary
no-reference run, adding a fabricated `bound` report and pack digest, and
recomputing `state_digest` was accepted by `readDesignState`. `design status`
then exited zero and printed the invented reference binding despite both the
brief and state having no reference pack.

Checked fix: `src/design.mjs:2214` rejects a persisted `reference_delivery`
field, including a coherently resealed state; `src/cli.mjs:811` derives the
full-run display from verified state. The coherent-reseal regression checks both
`status` and `provenance`: nonzero exit, no misleading stdout, and an explicit
derived-report error.

### P2-3: Capability inventory omitted a mandatory reference resource

Before correction, a temporary copy of `PLUGIN_BUNDLE_ENTRIES` excluding
`registry` still returned exit zero and `available` for every feature from its
own `capabilities --json` command. The same copied CLI's reference dry-run
failed with exit 4 because `registry/human-design-reasoning.json` was missing.
This was a copied fixture, not an installation.

Checked fix: `src/distribution.mjs:8` inventories the mandatory registry and
related static reference resources. The entrypoint evidence at line 35 also
binds CLI and skill files into the report digest. Independently rerunning the
partial-bundle reproduction returned exit 5, overall `incomplete`, reference
feature `missing`, and a null registry digest. The regression also confirms
that changed skill guidance changes `distribution_digest`.

## Independently executed verification

The reviewer executed this exact bounded command in the reviewed worktree,
including a final rerun before recording the hashes:

```sh
/Users/hyuk/.npm/_npx/6d82ddbdd7da268b/node_modules/node/bin/node --test \
  test/reference-delivery.test.mjs \
  test/component-recipes.test.mjs \
  test/schema-contract.test.mjs \
  test/design-sharding.test.mjs
```

Observed result: **54 tests, 54 passed, 0 failed, 0 cancelled, 0 skipped, 0 todo**.
This total is from the reviewer's own run, not the implementer's broader runs.
It includes legacy no-reference compatibility, requirement/schema rejection,
resume binding, the three findings' regressions, and the required-family test
that rejects discarding the requested recipe while applying an unrelated one.
The design-sharding suite checks inventory/registration and a selected local
contrast-ratio case; it does not execute the full browser design matrix.
`git diff --check` was also clean.

Independent `git merge-base --is-ancestor <commit> HEAD` checks returned exit
zero for all requested integration ancestors:

- Reference/component chain: `8bf2751d90dd1d3dcbdbb3fe992163f249d30533`.
- Account synchronization: `a3113b8b18867987ab57b8fb381388f58757ebcf`.
- Project onboarding: `49ca40ff11b0773a037be94bea3cde446129eca4`.

## Exclusions and authority boundary

No live browser, UI Bowl service, model provider, product redesign, fresh-account
skill-loading acceptance, npm/package installation, account synchronization,
publication, or merge was executed by this reviewer. No product, global
configuration, or real journey state was modified. Test-generated state and
local child outputs were confined to temporary fixtures and cleaned up.

The implementer's full E2E run was ongoing when this note was requested. This
note makes no claim about that run or any other independently unobserved test
results. It does not certify visual quality, human authorship, project-specific
reference delivery, or operational readiness of an installed account.

All Owner decisions and merge/install authority remain external. The sole
repository write by this reviewer is this review-evidence document.
