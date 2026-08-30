# Automation Lifecycle

`killsloprouter run` is a resumable coordinator over the existing planner and
audit ledger. It does not replace either receipt contract.

Run `doctor` first. It validates the surface contract against the real project
and binding directories and verifies each visual-intent and visual-signature
authority chain. A fresh bootstrap intentionally reports
`configuration_required` until both are approved and digest-bound; the plan
phase then resolves the exact artifacts.

For compatibility, a successful doctor still says `automation-ready`, but it
also says execution readiness was not evaluated and completion is ineligible.
Doctor does not accept a host manifest. Always follow it with integrated
`run --dry-run`; that is the command that builds packets and inspects the exact
planned host adapters.

## State files

`--out PATH` creates one automation state file and a sibling directory. The
state file contains the request, current status, adapter attempts, phase
receipt references, blockers, pending manual work, and a canonical state
digest. The sibling directory contains:

- `plan.json`
- `audit-run.json`
- immutable dispatch packets
- one result file per adapter attempt
- adapter-produced evidence under a packet and attempt directory
- the retained physical output/grant identity for each result-bearing automated
  attempt, so resume can bind audit source and evidence back to the child grant
- nine phase receipts
- `audit-receipt.json` after finalization is attempted

An atomic state-specific lease lives at `<state path>.lease/lease.json` only
while a mutating start, resume, migration, or recovery owns the state. Its
digest binds the owner token, PID, acquisition/update times, operation, current
and pending state digests, child phase, recovery deadline, and packet attempt.
The directory rename that publishes the lease is the exclusive acquisition
point; routing and child spawn occur only after it succeeds.

Parent JSON writes use a guarded atomic replacement. Missing directory
components are created one at a time under a verified parent inode; the parent
and temporary-file identities are rechecked after preflight, before data write,
before rename, and after commit. A detected ancestor swap leaves the redirect
target untouched and fails closed.

Before that lease is created, KillSlopRouter resolves the state path against a
trusted physical filesystem boundary and rejects every project-controlled
symlink ancestor. A fresh start also verifies the complete router/profile
authority paths before the first state or lease write. Platform aliases such
as macOS `/var` and `/private/var` still converge on the same physical lease
target without authorizing project-controlled aliases.

The declarative router JSON is the one bounded packaged-asset exception: a
global or content-addressed install may make it root-owned or hard-linked.
Start, resume, stale-lease recovery, and verified legacy migration all accept
that layout only while the original content digest and complete physical
identity still match. Project profiles, approvals, manual evidence, and custom
executable adapters remain caller-owned single-link inputs.

After the lease is acquired and before the first state write, a modern start
writes `<state>.authorities/<run-id>.json`. This durable version-1 receipt
contains the version-5 `resume_authority_digest` over the original route
request, router/profile sources, artifact digests, parent identity, initial
canonical plan-authority digest, and full parent-owned path contract. The
version-5 authority therefore freezes the selected planning receipt and optional
parent/slice lineage before the first state write. A normal result prints its path and authority
digest. If the process dies before printing them, the receipt remains the
caller-visible recovery evidence.

Initialization has its own monotonic authority. Once dispatch is complete, and
before any child request is built, KillSlopRouter writes
`<state>.authorities/<run-id>.initialization.json`. The file is outside the
mutable state tree and binds the canonical initialization graph. A stale-lease
recovery may issue or adopt this commitment and records that act in its recovery
receipt; normal resume may only verify an already cross-bound commitment.

The state begins with a `journey_identity` whose digest binds the run ID,
KillSlopRouter version, namespaced entrypoint, invocation origin, and
parent-versus-participant presentation rule. The same complete object is copied
into the audit, packets, phase receipts, owner approval, final receipt, design
decisions, and every host-adapter request. Provider provenance is separate:
each packet/request records an internal `participant` role while preserving its
exact `provider_id`.

If a reviewed artifact is a directory, place the state outside that directory
or below its `.killsloprouter/` directory. KillSlopRouter rejects other nested
state locations because writing results there would change the artifact being
reviewed.

Each phase receipt has its own canonical receipt digest. The state stores both
that digest and the SHA-256 digest of the receipt file. See
`schemas/automation-run.schema.json` and
`schemas/automation-step-receipt.schema.json`.

Resume never rewrites the parent identity to a child name or changes its
invocation field. It verifies the state, every existing step receipt, audit,
packet digest, and approval identity before another child can run.

### Concurrent execution and crash recovery

Only one process may mutate one exact automation state. Concurrent `start`,
`resume`, direct API continuation, `--migrate-identity`, and recovery attempts
fail closed with exit `5` before a child process is started. Different state
paths have independent leases.

State writes use a two-phase lease binding: the lease first records the next
state digest as pending, the state file is atomically replaced, and the lease
then promotes that digest. Explicit recovery accepts the actual state digest
only when it is one of those two bound values, so a crash between the two
writes does not authorize an unrelated state. Normal release also refuses any
`state-write` phase or non-null pending digest; only explicit stale recovery can
resolve that interrupted transition.

Use this read-only command to inspect the exact recovery tuple:

```bash
killsloprouter lease status --state .killsloprouter/v1-run.json --json
```

Recovery is permitted only when the owner process is no longer alive, the
three lease-tuple values match, and a modern state also matches the original
caller-retained resume authority. An in-flight child also keeps the lease
unrecoverable until its adapter timeout plus recovery grace has elapsed:

```bash
killsloprouter lease recover \
  --state .killsloprouter/v1-run.json \
  --owner-token '<lease status owner_token>' \
  --acquired-at '<lease status acquired_at>' \
  --state-digest '<lease status state_digest>' \
  --authority-digest '<original start resume_authority_digest>' \
  --json
```

The token, timestamp, and state digest are independent recovery checks. PID is
bound to an OS process-start identity, so an unrelated process that later
reuses the number cannot impersonate the owner; PID alone never authorizes or
blocks recovery. POSIX `ps` identity reads use a fixed C locale and UTC timezone
so caller environment cannot change the marker. If the OS cannot identify a PID
that is in use, recovery fails closed. Recovery writes a digest-bound receipt. When the state contains a
sealed `in_flight` intent, it is converted to an `abandoned_after_crash`
attempt. KillSlopRouter does not claim the child did or did not finish. A later
resume leaves that packet blocked until `--retry PACKET|PROVIDER|STAGE` is
explicit.

The stale claim is internal to the authorized automation recovery path; it is
not exported by `killsloprouter/state-lease`. A controller copied from
`lease status` is not a valid process-issued controller. If the recovery
process fails after claiming but before both receipt and state checkpoint are
committed, phase `recovery` or `state-write` remains exclusively locked. After
that failed process exits, inspect the new tuple and run the same authorized
recovery again; never delete the lease directory manually.
If the crash falls after the recovery lease replacement but before claim-file
cleanup, the next recovery adopts only the exact dead claimant bound by token,
process-start identity, timestamps, state digest, and recovery origin. A
different or modified orphan claim remains fail-closed.

If a crash occurs after the first state but before plan, planning verification,
audit initialization, or packet dispatch is committed, recover the lease with
the receipt's original authority digest and resume the same run. The recovery
operation itself revalidates the original artifact authority and seals any
unbound canonical plan/audit/packet sidecar or fixed initialization receipt;
normal resume is never allowed to adopt those files. Recovery receipt version 3
binds the root stale lease, prior state digest, deterministic reconciled anchor
IDs, every reconciled step, and the durable initialization graph digest. It does
not claim the final state digest because that would be circular: the final state
itself binds the recovery receipt. It first requires replanning
to reproduce the start receipt's exact plan-authority digest, including lineage,
and it never starts a reviewer. A prior unrelated recovery receipt cannot
authorize a later state rollback because normal resume rejects every currently
unbound initialization anchor regardless of receipt history. The child boundary
opens only after the canonical plan, audit, packet, and initialization-receipt
graph is sealed. Reconciliation builds sidecars and fixed receipts first but
commits every recovered binding in one state checkpoint together with the
version-3 recovery receipt. Receipt paths are deterministic from the root stale
lease. A process crash before that checkpoint leaves the prior state
byte-identical; the next authorized recovery validates and adopts the same
orphan bytes. A crash after the state write recognizes that already-bound receipt
and completes the same transaction instead of creating another recovery.
If the crash occurred after the authority receipt but before the first state,
`lease status` reports `state_digest: "absent"`. Recover that absent-state lease
without inventing a state, then start a fresh run at the same output path; the
abandoned receipt is retained and the new run writes a different receipt.

For a supported pre-identity state, recovery must verify the same external
backup authority before it claims the stale lease:

```bash
killsloprouter lease recover \
  --state .killsloprouter/legacy.json \
  --owner-token '<lease status owner_token>' \
  --acquired-at '<lease status acquired_at>' \
  --state-digest '<lease status state_digest>' \
  --legacy-backup ../killsloprouter-authority/legacy.pre-recovery.json \
  --authority-digest 'sha256:<SHA-256 of that backup file>' \
  --json
```

If recovery changes the legacy state, make a fresh byte-identical external
backup before `--migrate-identity`. Authority validation happens before the
stale lease is claimed, so failure leaves the original lease untouched. An
unresolved two-phase write remains locked and recovery-only.

This gives one active child start per state and prevents concurrent ledger
overwrites. It does not claim transactional exactly-once side effects across
an operating-system crash; unknown external outcomes remain an operator gate.

### Pre-identity state migration

Use `--migrate-identity` only for a verified legacy automation state that has
no adapter attempts, accepted review/triage evidence, final receipt, owner
approval, or observation binding:

```bash
killsloprouter run --resume .killsloprouter/legacy.json \
  --migrate-identity \
  --legacy-backup ../killsloprouter-authority/legacy.pre-migration.json \
  --authority-digest 'sha256:<SHA-256 of that backup file>' \
  --host-config .killsloprouter/host-adapters.json --json
```

Before migration, copy the active state byte-for-byte to a regular,
single-link file outside the mutable state directory. Pass that file with
`--legacy-backup` and pass its SHA-256 with `--authority-digest`. Keep the
backup durably after migration: later reads and resumes revalidate the
migration receipt against its path and digest. The command accepts only an
explicitly supported historical router digest and matching captured state,
plan, and audit serialization fingerprints. It rejects stripped modern states and modern-only plan, audit, packet,
or receipt markers; requires canonical plan and audit sources; replans through
the current router; rebinds the evidence-free audit and phase receipts in a
new copy-on-write transaction; and emits
`00-identity-migration-receipt.json`. It preserves the old plan and phase
receipt files without overwriting them. The state pointer is the only commit,
so a pre-commit crash leaves the active legacy graph byte-identical. The new
`resume_authority_digest` binds the external backup path/digest, retained
legacy sidecars, historical fingerprints, and transaction directory, and is mandatory
on every later resume. If any child execution evidence already exists, or the
source plan/audit is missing, start a new journey instead—the CLI will not
relabel it.

Before the transaction directory is created, every component below
`<state>.d/identity-migrations/` is physically preflighted against the canonical
state directory. A pre-existing symlink migration root exits with integrity
code 4 before any staged plan, audit, packet, or receipt is written.

## Phase behavior

1. **Plan**: resolve every artifact through the profile's surface contract,
   verify the separate visual-intent and visual-signature receipts and evidence, and only then
   select a creator. Stop if any authority, route, capability, strength, or
   independence requirement is unresolved.
2. **Planning verification**: verify the external planning receipt and required evidence when the route enforces it. If `baseline_lineage` is declared, add G7 as a mandatory effective requirement, verify both the immutable parent and the exact owner-bound slice candidate, and refuse version-based parent promotion.
3. **Audit init**: require and snapshot the persisted canonical plan, both visual authority chains, optional parent/slice lineage, and artifacts, bind the creator identity, and calculate the owner approval scope plus caller-retained `audit_authority_digest`. The public `initializeAudit()` API has the same source-plan requirement; a source-less audit cannot dispatch, record, execute, or finalize.
4. **Dispatch**: write one immutable packet per selected provider. Every packet carries the exact parent identity, internal participant role, visual-intent and visual-signature contracts, and any verified baseline lineage. Public standalone dispatch/record/triage/status/finalize calls require the original audit authority, and every result must repeat the exact run, packet digest, journey, participant, and optional lineage digest.
5. **Execution**: inspect the host allowlist, then re-read the planning receipt,
   parent, candidate, route-plan source, profile/visual authorities, and exact
   routed artifacts at the final pre-spawn boundary. Compare content and
   physical identity. Execute only a compatible adapter from its sealed
   manifest-time entrypoint bytes; missing or manual adapters stay pending.
   The official Codex bridge clones its complete runtime root into a private
   directory and executes the cloned binary. The official Playwright bridge
   clones only its pinned `playwright-core` and `axe-core` package trees, sends
   that seal's physical identity to the child, and loads it before any network
   request or browser launch.
6. **Result ingest**: revalidate the child output grant, persist that physical
   grant/output identity on the attempt and execution receipt, rebind the audit
   source to the latest recorded attempt, and require every automated evidence
   snapshot to remain inside the same grant on finalize and resume. The
   complete parent-owned state/sidecar tree outside that grant and each
   evidence file are checked around the digest snapshot. A root, sidecar,
   source, or evidence swap blocks ingestion; an unresolved child boundary
   keeps the lease held for explicit recovery.
7. **Scanner triage**: stop until every scanner candidate has a non-open decision and rationale.
8. **Conflict adjudication**: run adjudication after other critics and block unresolved finding pairs.
9. **Finalize**: re-hash the audit boundary and require the exact owner decision
   where the route has an approval stage. The approval source remains bound by
   both digest and physical identity on later resume.

For a lineage-bound run, every phase receipt repeats the lineage digest and the
owner template must repeat it alongside `scope_digest`. A changed parent,
candidate, planning receipt, state copy, or packet stops resume before another
child starts. See [Parent baseline and slice lineage](baseline-lineage.md).
The initial modern run first writes its authority receipt and normally emits
its path plus `resume_authority_digest`. Keep both outside the state and state
directory. Resume requires the exact original value as `--authority-digest`,
then requires the route plan at the deterministic state-directory path,
reconstructs the complete canonical parent-owned path contract, recomputes
routing from the digest-bound router/profile and original request, and compares
the complete planning-authority and audit enforcement graph. The initial
version-5 authority binds the request, artifact digests, and initial canonical
plan authority, including the planning receipt and optional lineage. Later
persisted plan and audit facts are additionally bound by phase/audit receipts.
After dispatch and before any child starts, the Router writes the separate
caller-retained `<state>.authorities/<run-id>.initialization.json` commitment
and cross-binds it into state. It fixes the plan, packet directory, audit path,
and four immutable initialization receipts, so deleting both state bindings and
all mutable anchors cannot replay reviewers. Plan, audit,
packets, automated results/evidence, phase receipts, and the final receipt
cannot be redirected outside `<state>.d/`; a verified legacy migration may use
only its authority-bound transaction subdirectory. External
approval, triage, and manual-result files must be single-link regular files
owned by the invoking user, outside both the parent state file and `<state>.d/`,
and not group/world writable; symlink ancestors are rejected before a fresh
start creates its ledger and before resume mutates the ledger or starts another
child. Integrated and standalone audit commands open one read-only descriptor,
pin device/inode/size/mtime/ctime across the read, and consume that parsed snapshot
rather than reopening the path. Its normalized decision and stored audit source
come from the same pinned bytes. Integrity verification then pins and reparses
the recorded source and reconstructs result, triage, and approval normalization;
a swapped path blocks instead of yielding a mismatched approval receipt. They
are not writable sidecars. A completed no-op resume still
revalidates the final receipt, retained attempt/evidence boundary, and any owner
approval against the audit scope and lineage before returning `complete`.

Adjudication deliberately runs after scanner triage. This keeps an unclassified
source pattern from being silently absorbed into a later aesthetic decision.
A zero-hit scanner result is still only discovery output. It cannot satisfy the
independent visual-intent/signature review or any later visual, browser, or owner gate.

## Existing UI before/after binding

A runtime `redesign` is a post-change audit. It therefore requires
`--observation-run` pointing to a pre-change `task audit` state with the exact
same routed profile digest, artifact paths, and `evidence.required_scenarios`
inventory. The profile digest locks the project, resolved surface, visual
authorities, and official browser route across both runs. Official browser
configuration also writes a `browser_contract_digest` that covers the exact
scenario file, viewport dimensions, allowed origins, browser channel, locale,
runtime content, color schemes, and interaction limits. This profile authority
is portable across installations: inode, owner, and timestamp identity stay in
the host manifest and are revalidated locally rather than entering the profile
digest. A substituted runtime or host remains `manual_pending`.

The observation state must have reached all of these stages:

- adapter execution;
- result ingestion;
- scanner triage;
- conflict adjudication;
- finalization with a written final receipt.

It may have a blocking final verdict because the purpose of the first run is to
capture defects. Missing/manual browser evidence is different: it is incomplete
and cannot authorize implementation. The browser packet must route to
`official:playwright-browser-v1`, run across a real child-process boundary, and
return the official `official-playwright-json-v1` transport with every required
scenario represented in accepted evidence.

The post-change state binds the observation state file, state digest, profile
digest, audit and final receipts, browser result, scenario IDs, and pre-change
artifact digests. Resume re-verifies that entire chain. The artifact paths stay
fixed while the implementation bytes are allowed to change.

Use this order:

```bash
# 1. Collect the current UI before editing.
killsloprouter run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task audit --direction none \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src --scope runtime \
  --out .killsloprouter/pre-change-ui.json --json

# 2. After the authorized creator implements the fixes, audit the result.
killsloprouter run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task redesign --direction approved \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src --scope runtime \
  --creator-id <creator-session-id> \
  --observation-run .killsloprouter/pre-change-ui.json \
  --out .killsloprouter/post-change-ui.json --json
```

`--observation-run` is immutable after the post-change state starts. Use
`run --dry-run` with the same flag before implementation to verify route and
host readiness. `plan --dry-run` is rejected because planning alone cannot
inspect adapters or collect browser evidence. See
[Existing UI anti-slop closed loop](existing-ui-closed-loop.md).

## Resume and retry

`--resume STATE` verifies the automation digest, the routed profile digest,
every phase receipt, and every tracked plan, audit, packet, and final receipt
path before continuing. Changing a surface contract after planning starts is a
new route, not a resume; the old state blocks.

For every modern state, export the value printed by its original start. The
value is an integrity assertion, not a credential, but it must come from a
caller-controlled record rather than the state being checked:

```bash
export KSR_RESUME_AUTHORITY='sha256:<value printed by the original run>'
```

Changing either visual authority receipt or any bound evidence is also a new route.
The old run blocks at audit initialization or finalization rather than silently
accepting a new aesthetic direction.

A missing or manual adapter is retried automatically if a newly supplied host
manifest makes it ready. A child execution error needs explicit authorization:

```bash
killsloprouter run --resume run.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config host.json --retry anti-slop
```

`abandoned_after_crash` uses the same explicit retry rule and is never replayed
merely because a stale lease was recovered.

To complete an explicitly manual packet, use the packet's result template and
ingest the completed file on resume:

```bash
killsloprouter run --resume run.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config host.json --result manual-result.json
```

Manual ingestion is recorded as `manual_recorded`, not `ran`, and applies the
same audit validation as a child result. `--result` may be repeated.

Selectors may name a packet ID, provider ID, or stage ID. `--retry all` retries
failed or pending packets, but does not replace already recorded successful
results. Naming an already successful provider or stage explicitly replaces
that result and invalidates its prior scanner triage decisions.

The official Playwright adapter uses the same mechanism for baseline approval.
An absent baseline or any pixel difference remaining after Playwright's
antialias-aware comparison returns an ingested `block` result and, for a
changed image, a diff PNG. Review the candidate screenshots, place only
approved files in the configured baseline directory, and rerun
`browser configure` so the host manifest binds the new directory digest. Then
replace the blocked result:

```bash
killsloprouter run \
  --resume .killsloprouter/v1-run.json \
  --authority-digest "$KSR_RESUME_AUTHORITY" \
  --host-config .killsloprouter/host-adapters.json \
  --retry browser-evidence \
  --json
```

Do not change an audited artifact while doing this. An artifact change is a new
audit scope, not a browser retry. See
[Playwright browser evidence](playwright-browser.md).

## Status and exit behavior

`complete` means the audit receipt is `approved` or the route did not require an
owner and reached `critic_pass`. `manual_pending` means a precise external
action is required. `blocked` means a hard gate, integrity check, adapter
execution, rejection, or conflict prevents approval.

Integrated dry-run keeps the JSON status `dry_run` for receipt compatibility,
but returns `6` when `pending` contains a non-executable adapter, `0` when every
planned adapter is ready, and `5` when planning or verification is blocked.

The integrated command never treats `routable`, process exit zero, or a child
JSON response by itself as a completed review. The result becomes `ran` only
after audit ingestion accepts the provider identity, capabilities, artifact
digests, findings, and required evidence.
