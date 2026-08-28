# Sidefy Parent-Identity UAT

Use this acceptance test after installing the exact reviewed PR commit. It
checks the product behavior that unit tests cannot prove: KillSlopRouter stays
visible as the selected journey while antislop and other providers remain
internal roles.

Do not run this UAT against production write paths. Use a Sidefy test checkout,
read-only UI audit scope, fixture credentials, and the official Playwright
adapter. Do not approve or merge the PR merely because the textual checks pass.

## 1. Install the exact candidate

Replace `<PR-6-COMMIT>` with the full 40-character commit reviewed on PR #6:

```bash
npx --yes github:devpnko/kill-aislop-router#<PR-6-COMMIT> \
  plugin install --dry-run
```

If the result is `identity_conflict`, perform the explicit backup-only
migration and then inspect the result:

```bash
npx --yes github:devpnko/kill-aislop-router#<PR-6-COMMIT> \
  plugin install --migrate-legacy-entry
npx --yes github:devpnko/kill-aislop-router#<PR-6-COMMIT> \
  plugin install --dry-run
```

Expected:

- catalog status is `ready`;
- the canonical entrypoint is `killsloprouter:kill-slop-router`;
- the old complete skill is preserved below
  `~/.codex/skills/.killsloprouter-backups/` with the verified digest;
- the old path contains only the explicit, implicit-disabled handoff shim;
- standalone antislop files and their digest are unchanged.

Restart Codex or open a new thread so the runtime reloads plugin metadata.

## 2. Start the Sidefy journey explicitly

In the Sidefy test checkout, invoke:

```text
$killsloprouter:kill-slop-router
현재 Sidefy UI를 먼저 실제 브라우저에서 관찰하고, 기존 제품 의도와 시각
서명을 보존하면서 KillSlopRouter 전체 감사 여정을 진행해. 변경 전에는
공식 Playwright 증거를 수집하고 실제 쓰기 동작은 실행하지 마.
```

Pass conditions:

- commentary calls the active workflow `KillSlopRouter`;
- it may say `antislop을 KillSlopRouter의 내부 critic으로 실행한다`;
- it must not say `antislop 모드`, `antislop으로 진행`, or otherwise replace
  the parent with a participant;
- an existing-UI journey executes official Playwright observation before UI
  changes, or stops `manual_pending` with the exact missing adapter/contract;
- routable/manual providers are never reported as `ran`.

## 3. Exercise the Korean correction

While the same journey is active, send:

```text
왠 antislop? 킬슬롭라우터 아니야?
```

Expected response semantics:

```text
맞습니다. 현재 오케스트레이터는 KillSlopRouter입니다. antislop은 필요할
때 라우팅되는 내부 critic일 뿐, 별도 모드나 실행 주체가 아닙니다.
```

Equivalent wording is acceptable. Omitting KillSlopRouter while naming the
child, or naming the child as the mode, is a failure.

## 4. Compact or resume without changing identity

After several turns, resume the persisted run in the same journey:

```text
이 KillSlopRouter 여정을 기존 state에서 resume해서 계속해.
```

Record the state path printed by the CLI. Verify that the state, audit ledger,
packets, step receipts, approval template, child requests, and final receipt
repeat one identity digest. A typical inspection starts with:

```bash
jq -r '.journey_identity.identity_digest' .killsloprouter/<run-state>.json
```

Then inspect the paths named by that state rather than guessing filenames.
Every packet must also satisfy:

```text
packet.run_id == journey_identity.run_id
packet.participant.provider_id == packet.provider.id
packet.participant.visibility == "internal"
packet.participant.orchestrator_id == "kill-slop-router"
```

Pass conditions:

- compaction/resume keeps the original `identity_digest`;
- a conflicting or edited identity stops non-zero before any child process;
- prior evidence is not relabeled through `--migrate-identity`;
- an evidence-free legacy run may migrate only with the explicit flag and a
  verified `00-identity-migration-receipt.json`.

## 5. Verify browser and approval gates

For the current UI audit, confirm all of the following in the final receipt:

- the browser packet ran through the official Playwright child boundary;
- required Sidefy scenarios and mobile/desktop viewports have evidence;
- console/page failures, clipping, overlap, keyboard, state, contrast, and
  required-text checks were evaluated as configured;
- scanner triage and critic conflicts are resolved explicitly;
- artifact/evidence digest changes block finalization;
- owner approval binds the same journey identity and exact scope digest;
- a clean scanner result is not treated as design approval.

## 6. Preserve standalone explicit antislop

Open a separate fresh thread with no active KillSlopRouter state and invoke
antislop explicitly:

```text
$antislop 이 문구만 독립적으로 비평해.
```

That standalone explicit request remains valid. It does not permit implicit
antislop activation, and it must not attach its output to an existing
KillSlopRouter receipt unless routed again as a digest-bound internal child.

## Acceptance record

Attach to PR #6:

- exact candidate commit;
- installer dry-run JSON and any migration receipt/backup digest;
- the KSR state and final receipt digests;
- Playwright report/trace and required screenshots;
- transcript excerpts for initial invocation, Korean correction, and resume;
- the separate standalone antislop result;
- reviewer identity and review decision.

Do not merge until an independent reviewer approves the PR and this Sidefy UAT
has no parent-identity, browser-evidence, integrity, or owner-gate failure.
