# First project setup and continuation

This is a setup checklist, not a new approval or an automatic installer. The
plugin remains the entrypoint; its CLI keeps the authoritative ledger.

In the target project, start with:

```text
KillSlopRouter로 현재 UI를 확인하고 기존 제품 의도와 디자인 개성을 유지하며 개선해.
지금 단계, 실제 실행한 검토, 막힌 이유, 내가 결정할 것만 간결하게 알려줘.
```

For a new product, say that there is no UI yet and request design exploration.
An approved existing UI does not need nine new directions merely to fix a tab.
If the skill is not discovered implicitly, name
`$killsloprouter:kill-slop-router` explicitly.

## 1. Identify the project

The assistant reads the real product contract and asks only about ambiguity.
It needs a stable project ID, locale, intended users/product surface, and exact
artifact scope. It must not interpret “operator UI” as a gray visual preset.

From another directory, an explicit project root limits profile discovery:

```bash
killsloprouter doctor --root /absolute/project --json
```

Only `/absolute/project/.killsloprouter/profile.json` is discovered in that
mode. It does not borrow the invoking or enclosing project's profile. Without
`--root`, discovery still walks up from the current directory. An explicit
`--profile` takes precedence for a deliberately separate configuration; that
does not waive surface/artifact authority checks. Relative CLI file arguments
such as `--profile`, `--host-config`, `--out` and `--resume` remain relative to the invoking working
directory. Prefer absolute paths when invoking from elsewhere; artifact paths
are resolved against the routed project root.

If no profile exists and the entrypoint has no conflict, `doctor` reports
`bootstrap-project` first. The assistant
may run `bootstrap` once the real ID, locale and surface are known. Bootstrap
creates manual-only configuration and refuses to overwrite it; it does not
approve a design or connect reviewers. See [first use](getting-started.md).

## 2. Bind authority, not example values

`doctor --json` includes ordered `next_actions`, with required inputs and a
documentation pointer for each. They describe unresolved visual intent,
signature, entrypoint conflicts and the execution preflight. All actions must
be satisfied as applicable; their display order never authorizes bypassing a
conflict. The text form prints the same instructions.

Use actual planning/brand/reference/Owner evidence. Do not copy the example
Owner receipts, set `approved_design_system: true` to clear a blocker, invent a
palette, or edit a frozen profile after an observation has started. A changed
binding may require a successor run. If visual direction is undecided, follow
the existing [Owner-gated exploration](design-exploration.md).

## 3. Connect execution

Doctor validates project authority, **not host execution**. Its compatible
`automation-ready` label still means `completion_eligible: false`. Configure
only the integrations that have actual authority:

| Integration | Required input / boundary |
| --- | --- |
| Independent reviewers | Allowlisted provider, exact capabilities/strength, digest-locked host. The optional [Codex host](codex-review-host.md) additionally needs an explicit external-model grant; `anti-slop` is an internal `skill-json-v1` critic, never the creator's self-review. |
| Official Playwright | Reviewed running URL, exact artifact attestation served at `/.well-known/killsloprouter-artifact.json`, critical scenarios with state assertions, required viewports, approved origins and evidence storage scope. See [browser setup](playwright-browser.md). KSR does not infer a server command. |
| Visual baseline | Missing approved pixels remain a gate. Review the candidate evidence with the Owner; do not automatically bless the first screenshot. |
| Planning / Owner | Actual project planning and exact Owner decisions where required. Neither creator QA nor a clean scanner substitutes. |

After binding those inputs, run the **same exact task** with `run --dry-run`,
including its root/profile, artifact, scope and host configuration. The
[existing-UI walkthrough](existing-ui-closed-loop.md) provides both the
pre-change audit and the later `--observation-run` redesign commands.

- Exit `0` for a dry-run means preflight passed, not that reviews ran.
- Exit `6` means manual input or execution setup remains pending.
- A blocking/nonzero error is not permission to edit, bypass a gate, or rerun
  another standalone critic.

A missing official browser cannot be replaced with a hand-written Playwright
report for existing-UI observation. Keep the original browser evidence in its
authorized storage scope; sharing summaries does not authorize uploading raw
screenshots, traces, credentials or session data.

## 4. Stop and continue

An actual run prints its state path, digest and original resume authority.
The text output now adds attempt counts and a POSIX-quoted resume command,
using the currently executing Node and bundled CLI paths rather than resolving
another `killsloprouter` from PATH. It also retains the supplied host path.
This command is for **after** the named stop
is resolved; it does not invent the missing `--result`, `--triage`, or
`--approval` files and never adds `--retry all`.

Keep the original start output / authority in the caller's durable handoff
outside mutable state before switching conversations. A minimal handoff has:

- project and exact state path;
- original caller-retained `resume_authority_digest` and authority receipt path;
- current stop and pending packet/gate, plus the authorized host path;
- decisions or independent evidence still needed, without claiming approval.

Then say:

```text
KillSlopRouter로 같은 여정을 이어서 진행해.
앞서 보존한 원본 재개 권한과 현재 상태를 검증하고, 막힌 단계부터 알려줘.
```

Missing original authority is a stop; never derive its replacement from the
state being verified. An active lease is a stop; do not delete it or start a
second run over the same state. Use the documented [explicit crash recovery](automation-run.md#concurrent-execution-and-crash-recovery)
only with the required recovery authority.

Human-facing hints are presentation, not authority. Existing run/receipt JSON,
hashes, exit codes, independent review and Owner gates remain authoritative.
`complete` describes that exact run's verdict; it grants no additional right
to redesign, deploy or extract a design system.

## Acceptance boundary

The repository's usage regressions exercise first-use isolation, setup stops,
separate CLI processes, original-authority resume, tamper refusal, and literal
command argument handling. The full E2E suite separately tests real adapter
child processes and Playwright. These are fixture results, not proof that a
fresh model conversation will follow the whole journey correctly. Real
product/model acceptance needs its own scoped authorization and independent
review; no product approval is issued by these tests.
