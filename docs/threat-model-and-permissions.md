# Threat Model and Permissions

KillSlopRouter protects the transition from a route proposal to an evidence-backed
approval. It is designed to fail closed when execution authority, reviewer
independence, required proof, or artifact integrity is missing.

## Protected assets

- project source and private artifacts;
- route, planning, audit, triage, and approval receipts;
- visual-intent authority receipts and their project, brand, reference, or owner evidence;
- visual-signature receipts, per-aspect coverage, and exact palette/type/density/elevation evidence;
- reviewer and owner provenance;
- the selected KillSlopRouter parent identity and child-role boundary;
- the caller-retained modern resume authority digest;
- state leases, in-flight child intents, and crash-recovery receipts;
- screenshots, browser traces, and test reports;
- the distinction between dispatchable work and completed work.

## Trust boundaries

### Codex plugin installation

The optional installer copies an explicit source allowlist to
`~/plugins/killsloprouter` and updates only the `killsloprouter` entry in the
personal marketplace. It preserves other entries, backs up an existing
marketplace file, and refreshes only a plugin directory carrying its own
installation marker. The plugin declares no MCP server or external app.

Installing the plugin exposes the workflow skill and bundled local CLI. It does
not authorize a host adapter, grant artifact access to a reviewer, authenticate
an owner, or turn a manual provider into executed evidence. Those authorities
still require the project profile, explicit `--host-config`, and audit ledger.
The installer copies exact `playwright-core` and `axe-core` runtime packages,
but it neither downloads a browser nor starts one.

The installer and `doctor` also inspect the runtime skill catalog. The
canonical install marker is not a presence flag: its deterministic body binds
the trusted packaged payload, copied browser runtime, canonical skill bytes,
version, and entrypoint. It does not claim an authenticated local installer,
source path, or timestamp. An old unbound marker is refreshable only when its
payload/runtime/skill still exactly match the trusted package, and requires an explicit backed-up `--force`
refresh; an arbitrary marker/payload is unsafe. A full local `kill-slop-router`
entry alongside the namespaced plugin is an identity conflict. Migration is
never implicit: the operator must pass `--migrate-legacy-entry`, after which the
original directory is preserved in a digest-verified, shaped backup and only
the exact packaged implicit-disabled handoff shim remains. Its marker must bind
the actually installed canonical marker, payload, runtime, and skill digests;
an orphaned public shim and fabricated backup remain a conflict. Changing the
shim or backup fails closed. Standalone antislop is outside this migration boundary.

### Journey identity

`journey_identity` binds the KillSlopRouter ID and version, namespaced
entrypoint, run ID, invocation origin, display name, and presentation rule in a
canonical digest. It is repeated across the automation state, audit manifest,
dispatch/design packets, step and final receipts, owner decisions, and child
requests. Packet digests additionally bind the internal participant metadata.
Resume cross-checks these copies before execution, so re-signing one layer does
not switch the parent.

Participant provider IDs are provenance, not workflow selection. A creator,
critic, scanner, browser provider, or adjudicator remains
`visibility: internal`; standalone `$antislop` compatibility applies only when
there is no active KillSlopRouter identity.

Exact parent aliases are reserved across provider, result-actor, Owner, and
visual-authority fields. Comparison uses Unicode NFKC normalization, trimming,
and case folding; parent aliases additionally normalize spaces, underscores,
and hyphens. This closes full-width, case, whitespace, Korean, and separator
variants without blocking distinct participant names that merely contain a
similar substring. `owner-direction` authority IDs must exactly match the
independently verified Owner IDs after canonical comparison. Original IDs stay
visible in receipts for provenance.

### Modern resume authority

After acquiring the state lease, an identity-bound integrated start writes a
durable authority receipt to `<state>.authorities/<run-id>.json` before the
first state write. Its version-5 `resume_authority_digest` covers the state
path, run and journey identity, router/profile paths and digests, project root,
original route input, initial artifact paths and digests, scope, creator actor,
initial canonical plan-authority digest, observation-run path, and deterministic parent-owned path contract for the
canonical state directory, authority receipt, active plan/audit/packet tree,
results, evidence, phase and migration receipts, and final receipt. A later
resume must present the exact value retained by the original caller before the
state is allowed to select the router or profile that will be re-read.

The authority does not claim a canonical plan file exists before initialization,
but it freezes the complete initial plan-authority digest, including the
external planning receipt and optional lineage. The later plan file, audit, and
packet graph are additionally bound by state transitions, phase receipts, and
the audit authority. Once that graph is complete, but before child execution,
`<state>.authorities/<run-id>.initialization.json` commits its immutable plan,
packet, audit-path, and step-receipt anchors and is cross-bound into state. This
second caller-retained file is a monotonic progress floor: a fully deleted
mutable state tree cannot silently become a fresh initialization. Initialization
is idempotent across a verified crash only
when replanning reproduces that exact digest:
the explicit stale-lease recovery revalidates and seals orphan sidecars written
before their state transition, while committed steps are not replayed. Normal
resume rejects every unbound canonical initialization sidecar and fixed receipt,
even when state retains an older unrelated recovery receipt. Recovery receipt
version 3 binds the root stale lease, recovered state digest, deterministic
reconciled anchor IDs and steps, and the durable initialization graph digest.
The state binds that receipt, avoiding a circular final-state digest claim. A crash after authority issue
but before the first state leaves the receipt and stale absent-state lease; the
operator recovers that lease and starts a fresh journey without overwriting the
abandoned receipt.

Resume reconstructs that path contract from the requested state path. Normal
runs may use only the fixed sibling `.d/` layout. Verified legacy migrations
may use only their digest-bound, direct-child transaction for the rebound
plan/audit/packet tree and migrated phase receipts. A coherently re-signed
state that points a parent-owned sidecar or phase receipt elsewhere is rejected
before a child or ledger write. Approval, triage, and manual-result files are
caller-supplied read-only inputs. They must be single-link regular files owned
by the invoking user, outside both the state file and its `.d/` directory, not
group/world writable, and have no symlink ancestor. The Router opens them with
a read-only non-following descriptor, pins device, inode, link count, size,
mtime, and ctime across the read, parses that exact snapshot, and never treats
their paths as writable state sidecars. The normalized manual result, scanner
decision, or owner decision and the stored source digest are constructed from
the same descriptor bytes. Final integrity verification pins and reparses the
recorded source and reconstructs triage and approval normalization. A path
replacement between preflight and consumption therefore blocks rather than
sealing different bytes as authority. Fresh starts perform this before
state/lease creation; resumes perform it before ledger write or child spawn.
The same descriptor rule applies to every parsed parent authority: routed
router/profile JSON, canonical route plans, visual intent/signature receipts,
phase and migration receipts, start/initialization authorities, recovery and
final receipts, and Playwright scenarios. In particular, the last planning
check before a reviewer process opens the same digest-bound bytes; it cannot
hash one path image and parse a replacement.

The declarative router JSON alone may be root-owned or hard-linked when it is a
global/content-addressed package asset. Its exact descriptor bytes and physical
identity are still bound at start and revalidated on resume, recovery, and
legacy migration. The exception does not extend to the project profile,
approvals, manual evidence, or executable authority.

The digest is an integrity assertion, not an authentication secret. Copies in
the state and phase receipts allow cross-checking but are not an independent
trust root. The operator or CI caller must retain the original start authority,
the initialization authority once issued, and the digest outside the mutable
state boundary. If normal start output
is lost in a crash, the digest is read from that receipt, not recomputed from
state. If an adversary controls both every local artifact and the resume
invocation or its caller-held record, V1 cannot distinguish the forgery. An
identity-bound pre-release state without the durable version-5 start receipt
must restart; locally deriving a new digest would simply trust the compromised
inputs.

Standalone audit initialization similarly emits an
`audit_authority_digest` over its source plan, journey identity, creator actor,
artifact and packet scope, and optional baseline lineage. Dispatch, result
recording, triage, status, and finalization require the original caller-retained value.
Standalone result, triage, and approval sources use the same single pinned
descriptor for parsing and provenance; a path replacement between the pinned
read and provenance binding blocks rather than allowing two reads to disagree.
Finalization reconstructs every result from its immutable source and reruns
reviewer/provider independence checks, preventing a coordinated run/result
rewrite from making the creator its own reviewer.

Pre-identity migration uses a separate one-time anchor: a byte-identical
pre-mutation state backup outside the mutable state directory and the
caller-retained SHA-256 of that backup file. It accepts only an allowlisted
historical router digest and exact serialized old shape with canonical
plan/audit sources, replans under the current router, and emits a new modern
resume authority. The backup remains a durable migration-receipt dependency.
This still is not authentication; an attacker who also controls the caller-held
record and backup remains outside V1's local integrity model.

### Automation state lease

Mutating start, resume, direct API continuation, identity migration, and
recovery acquire one atomic directory lease for the exact automation state
before routing or child spawn.
The digest-bound record carries a random owner token, PID plus OS process-start
identity, timestamps, the current/pending state-digest transition, operation,
and active packet attempt. A second process cannot treat a readable state as
available while the first reviewer is still running.

No stale lease is removed automatically. Explicit recovery requires the exact
owner token, acquisition timestamp, and current lease-bound state digest,
refuses while the owner PID is alive, and waits beyond the bound child timeout.
For a modern state it also requires the original caller-retained
`resume_authority_digest`, and verifies the state and authority before claiming
the stale lease.
The exact recorded process identity must no longer be live; an unrelated
process that reused its PID does not keep the lease stuck. If liveness cannot
be distinguished, recovery fails closed. A recovery claimant is itself
exclusive, carries the same process-start binding, and writes a receipt before
releasing the lease. A post-claim failure leaves phase `recovery`, `state-write`,
or its pending digest locked; only a later authorized recovery may resolve it.
If a process dies after atomically installing its recovery lease but before
removing `recovery-claim.json`, the next recovery adopts that orphan only when
the dead claimant token, PID/process-start identity, timestamps, state digest,
recovery origin, and committed replacement lease match exactly. A modified or
unrelated claim remains an exclusive conflict instead of being deleted.
The public package facade omits the internal stale-claim and recovery-completion
primitives, and an issued controller is process-local rather than reproducible
from the status tuple. POSIX process-start queries force `LC_ALL=C`, `LANG=C`,
and `TZ=UTC`, preventing caller locale or timezone from changing the marker.

If termination happens after child spawn but before result ingestion, external
completion cannot be proven transactionally. The sealed in-flight intent is
recorded as `abandoned_after_crash`, never `ran`; retry remains a separate
operator authorization. V1 guarantees non-overlapping starts and ledger
serialization, not exactly-once effects in an external provider.

Design approval output uses a separate state-bound publication transaction.
The four files are written to a private staging directory, bound by name,
length, digest, receipt digest, destination, and one transaction digest in
`pending_finalization`, and checkpointed before the directory rename. Recovery
or resume may finish only when exactly one of the bound staging or published
directories exists and every regular file still matches. It rejects two
directories, missing files, symlinks, changed bytes, redirected destinations,
or an unbound legacy output directory. The transaction prevents a crash after
publication from causing a duplicate publication or an unverifiable output
adoption; it does not turn old orphan output into current authority.

Parent/slice lineage treats filesystem aliases as hostile input. Receipt and
route paths are canonicalized, symlink components inside the controlled
authority roots and hard-linked files are rejected, and recursive device/inode
identity overlap is blocked. Both artifact sets and the planning authority are
re-hashed and compared by physical identity at the last child-execution
boundary, so an automation preflight alone cannot create a time-of-check/time-of-use
permission gap.
The resume boundary additionally reconstructs the route from the bound
router/profile/request, requires its plan at the deterministic state path, and
rechecks final and owner receipts even for an already-complete run. Deleting or
re-signing local lineage copies cannot turn an externally lineaged journey into
a legacy no-lineage journey.

### Project profile

The profile is routing data. It may declare availability, an executor label,
target metadata, versions, strengths, and capabilities. KillSlopRouter never
executes a profile field. Execution-like fields such as `command`, `args`,
`shell`, `entrypoint`, and `executable` are rejected.

The profile also owns the product-surface contract. Artifact bindings are
resolved from a real project root before route and creator selection. The
optional CLI surface is an assertion, not an override. The plan snapshots the
profile digest; audit initialization, finalization, and automation resume reject
a later profile replacement. Library callers that provide both a parsed profile
and `profilePath` must provide the same canonical JSON; object/file substitution
is rejected before routing.

The profile's visual-intent map is a separate boundary. A surface name cannot
authorize a visual style. Approved visual intent must match a regular,
non-symlink authority receipt by digest; that receipt must repeat the exact
intent and bind at least one evidence file. The plan and every dispatch packet
carry the verified contract, and audit initialization snapshots the authority
chain for final integrity checks. An unresolved bootstrap contract forbids
editorial treatment and blocks visual work.

The profile's visual-signature map is another boundary. It binds concrete
palette roles, typography, density, shape, elevation, imagery, motion, style
keywords, and forbidden transformations. Every aspect requires declared
evidence coverage. Color frequency, logo presence, semantic surface, scanner
output, and critic preference are not authority. The complete signature chain
is included in dispatch and approval scope and re-hashed at finalization.

### Host adapter manifest

The host manifest is executable authority. Passing it with `--host-config`
means the operator trusts the allowlisted provider IDs and the exact
digest-locked entrypoints. The manifest cannot lower the route's capability or
strength requirements.

Each custom Node entrypoint and every explicit local dependency must be a
caller-owned, single-link regular file no larger than 512 KiB per module.
KillSlopRouter pins the complete graph's bytes, digests, and physical identities
when loading the manifest, rechecks them at the final child boundary, and starts
Node through a descriptor-fed sealed-graph loader. Replacement bytes at the
original paths are therefore never selected. Exact bundled package assets are a
bounded exception because global and content-addressed installers may make them
root-owned or hard-linked. They remain restricted to the packaged root and are
still content/graph-digest locked with their observed physical identity. This
exception never applies to project profiles, approvals, manual evidence, or
custom executable adapters.

### CI workflow

Pull-request code executes in CI, but the workflow has read-only repository
permission and receives no publication or release authority. Dependency
installation uses the committed lockfile with lifecycle scripts disabled.
Official GitHub Actions are pinned to reviewed full commit SHAs so a moved tag
cannot substitute checkout or Node setup code. The explicitly pinned Playwright
package then installs the bundled Chromium build used by browser tests. Feature
branches run through the pull-request event only, and concurrency cancellation
prevents superseded commits from duplicating browser installs. Dependabot
monitors npm and GitHub Actions weekly, while CI blocks high-severity production
dependency advisories. Automated dependency pull requests receive no merge,
publication, or release authority.

### Adapter child

The child is trusted code running with the operating-system privileges of the
KillSlopRouter process. The host fixes the Node executable, disables shell
interpretation, removes profile arguments, reduces the environment, enforces a
timeout, rechecks the complete local module graph, and executes its
manifest-time bytes through a descriptor-fed sealed loader. It confines
accepted evidence paths and snapshots the output root's
real path and filesystem identity across execution and rejects symlink
components, hard-linked regular evidence, special files, root replacement, and
physical escape. It does not provide an OS or network sandbox. Run third-party
adapters in a container, VM, or restricted CI worker when the entrypoint itself
is not fully trusted.

The official Playwright private seal covers `playwright-core` and `axe-core`,
not the selected browser executable or its shared libraries. Channel and
observed version are provenance only. A threat model that includes browser
binary substitution requires a pinned image or external binary attestation.

### Official Codex review boundary

The optional Codex host is configured only through an explicit CLI operation.
It digest-locks the bundled Node bridge, structured-output schema, exact Codex
executable, complete runtime root, and any skill root. The project profile
cannot select a runtime, command, argument, model credential, or auth store.
The host manifest records an explicit model name and `network:external`
permission but no credential contents.

Each packet uses a new ephemeral Codex thread under a fixed read-only,
non-interactive invocation. User configuration, project `AGENTS.md`, plugins,
automatic skill instructions, MCP/apps, browser, web search, computer use,
image generation, and delegation are disabled. Authentication is exposed only
through a temporary private `CODEX_HOME` containing a link to the host's
regular `auth.json`; the directory is removed after the probe or review. The
wrapper rejects forbidden event types, binds the returned
actor to the JSONL thread ID, and rechecks artifact and runtime locks before
execution. It rechecks artifact locks after execution before result ingestion.
Authentication/runtime/skill absence is `manual_pending`; changed locked bytes
or invalid output block.

Authentication readiness cache keys bind the pinned auth content and stable
file identity, but those internal digests and the credential-store pathname are
never public receipt fields. Filesystem failures use fixed non-path-bearing
reasons. The router detects persistent auth changes across a probe; a hostile
same-UID process that momentarily replaces and restores the auth pathname is an
ABA race outside this in-process boundary. Use a dedicated OS account,
restricted worker, VM, or container when same-user interference is in scope.

Only successful authenticated readiness is cached. Transient negative runtime
status is retried under the same auth identity, and failed cleanup is an
uncached `manual_pending` result. The official adapter and outer execution
boundary never publish nested Codex stdout/stderr or JSON parser input on an
abnormal path; they record fixed errors, and thread identifiers must satisfy a
bounded safe pattern before entering provenance.

Manifest validation does not create a private runtime copy per provider. It
checks the configured source identities and caches only the resulting readiness
probe under those identities. The private clone is deferred to the actual
adapter child, where it is created and reverified for that execution.

This is not a container boundary. The nested runtime uses Codex's platform
read-only sandbox, which prevents writes but may permit reads outside the
artifact root depending on OS implementation. The Codex process also needs
access to its host authentication store and model service. Use a container,
VM, restricted CI worker, or dedicated OS account when unrelated readable
files, stronger egress isolation, or authenticated remote-model identity are
in scope. The integration is audit-only and cannot satisfy scanner,
Playwright, design creation, or owner packets.

Reviewed artifacts are also untrusted model input. Embedded instructions can
influence a reviewer even when they cannot expand its tool permissions. A
digest-bound structured response proves provenance and schema conformance, not
the truth of its findings. Separate critics, adjudication, deterministic
evidence, and owner authority remain required by the route.

### Reviewer and owner identity

Actor IDs are asserted provenance, not authenticated human identities. Owner
approval is bound to an exact scope digest and cannot come from the creator,
but V1 does not cryptographically sign identities. Use signed CI attestations
or an identity service when impersonation is in scope.

### Official Playwright browser boundary

The official adapter does not start a project server. The operator supplies an
already running HTTP(S) base URL. Loopback is required unless external network
authority is explicit. Page requests are restricted to the configured origin
set, redirects are subject to the same restriction, and service workers are
disabled for the evidence context.

Before browser launch, the server must return the exact audit packet artifact
digest map from `/.well-known/killsloprouter-artifact.json`. This binds the
server's build attestation to the packet and blocks accidental or stale-build
mixups. It does not cryptographically prove that an actively malicious server
derived every response byte from that artifact; use a signed build attestation
when that attacker is in scope. The adapter entrypoint, complete npm runtime
package directories, scenario file, and visual baseline directory are bound by
content and physical identity. The executable runtime is restricted to the
bundled trust boundary. Immediately before child spawn the parent copies only
the pinned `playwright-core` and `axe-core` trees to a private mode-`0700`
runtime, rechecks the source, and binds the seal identity in child authority.
The child hashes and loads that seal before network access or browser launch.
Parent-pinned scenario and baseline bytes are sealed in
the child request, confirmed once more before spawn, and consumed from memory
instead of mutable project paths. Baselines are flat safe PNG files with a
64 MiB aggregate handoff cap. A mismatch blocks before evidence ingestion.

Visual baselines are compared byte-for-byte first. A byte mismatch then uses
Playwright's antialias-aware pixelmatch comparator with its standard `0.2`
threshold and zero allowed remaining pixels. This removes cross-process font
raster noise without accepting a detected layout, copy, state, or color change.
Material changes block and produce a diff PNG; owner review is still required
before replacing and digest-locking any baseline.

The built-in overflow gate measures viewport escape, direct flex/grid child
overlap, and required-text clipping. Typed, digest-locked scenario assertions
can further bind component overlap, required text fit, exact repetition counts,
and computed CSS properties. Intentional overlap or truncation needs an explicit
reviewable opt-out marker. A manual browser result remains an asserted review,
not proof that the official child adapter executed or interpreted its report.

Scoped UI runs also bind a non-empty reviewed `required_scenarios` inventory.
The ledger requires non-screenshot report coverage and a screenshot for every
required scenario × required viewport. Runtime redesign additionally binds a
finalized pre-change audit whose browser attempt reports the bundled official
Playwright transport. This prevents a root-only screenshot, manual report, or
generic browser child from being promoted into observed-current-UI authority.

Playwright's ARIA snapshot and axe checks are automated semantic proxies. They
are not evidence that VoiceOver, NVDA, JAWS, TalkBack, or another real
assistive technology was operated by a person. The report states this scope
explicitly. Require a separate independent assistive-technology result when
the project risk or accessibility contract demands it.

## Permission scopes

| Scope | Meaning | Notes |
|---|---|---|
| `artifact:read` | Adapter may receive local artifact paths and review them | Required by executable adapters |
| `evidence:write` | Adapter may create files in its assigned evidence directory | Accepted evidence cannot escape that directory |
| `browser:control` | Adapter may drive a browser harness | Required only by `browser-json-v1` |
| `reference-evidence:read` | An independent design reviewer may receive the exact digest-bound source captures needed for the two approved anti-copy checks | Reference-backed creator and browser packets explicitly forbid it; this is a protocol grant, not an OS sandbox |
| `network:external` | Operator acknowledges that the adapter may send data outside the machine | Declaration only; enforce isolation outside this process |

Provider permissions must be a subset of the manifest's granted permissions.
Browser execution cannot be disguised as a generic agent adapter.

## Fail-closed controls

| Threat | Control |
|---|---|
| Child critic is presented as the selected workflow | Digest-bound parent identity stays KillSlopRouter; exact English, namespaced, separator, full-width, and Korean parent aliases are forbidden as provider, result actor, Owner, or visual authority. Child provider metadata is internal-only and presentation regressions cover correction and resume wording. |
| Forged plugin or legacy-shim marker claims the parent identity | Canonical readiness requires trusted payload/runtime/skill digests and a deterministic marker with no self-asserted provenance fields; legacy readiness additionally binds the exact shim and shaped backup to the actually installed canonical marker/payload/runtime/skill digests. Orphaned or self-consistent arbitrary markers remain conflicts. |
| Legacy local router wins catalog precedence | Installer and doctor detect the duplicate; only an explicit backup-bound, implicit-disabled shim migration clears the conflict |
| State is re-signed with another parent before resume | Step receipts, audit, packets, approval, and migration receipt must all match the same identity before another child runs |
| State and its local anchors are coherently re-signed to another route | Resume requires the caller-retained original authority digest before trusting state-selected router/profile paths, then reconstructs and compares the complete route and audit enforcement graph |
| A lineaged run crashes after its first state but before `plan.json` | The version-5 start receipt binds the full initial plan-authority digest, including planning receipt and lineage; recovery refuses a changed replan before plan, ledger, or child commit |
| A re-signed state deletes completed initialization pointers to replay children | Normal resume always rejects unbound canonical plan/audit/packet sidecars and fixed initialization receipts. Only the current stale-lease recovery may revalidate and seal them, and its version-3 receipt binds the root stale lease, recovered state, deterministic anchor IDs, and initialization graph digest; an older unrelated receipt grants nothing. |
| State bindings and every mutable initialization anchor are deleted together | Before any child starts, `<run-id>.initialization.json` commits the immutable initialization graph outside `<state>.d/`. Resume requires the caller-retained file and exact state cross-binding; only the active stale lease may adopt an orphan created by a crash. |
| A child deletes or replaces caller-visible start/initialization authority | The entire `<state>.authorities/` tree is recursively snapshotted before spawn and reverified after exit. Any change leaves `in_flight` unresolved and the lease held; no attempt/result is accepted. |
| A parsed router, profile, plan, owner, visual, phase, migration, recovery, final, or browser-scenario JSON path is replaced between digest and parse | One read-only descriptor supplies both parsed bytes and SHA-256; inode/path revalidation rejects replacement before a gate, resume, recovery, or reviewer child can proceed. |
| Profile, visual authority/evidence, or reviewed artifact changes after audit initialization | The parent re-pins every file authority and artifact immediately before each reviewer spawn; changed content or inode/path identity blocks without starting the child. Historical completed observations retain their sealed receipts instead of requiring the old live artifact to remain at its former path. |
| Playwright settings validate relative to one directory but the child resolves them from another | Host-relative paths are normalized in the parent; the runtime must be bundled, and exact parent-pinned scenario/baseline bytes cross in a digest-bound child authority. The child never reopens those project paths. |
| Standalone audit creator actor and ledger are coherently re-signed | Dispatch, record, triage, status, and finalization require the caller-retained audit authority; finalization reconstructs source results and revalidates reviewer independence |
| A valid child result is replayed into another run or parent baseline | Result schema and ingestion require the exact run ID, packet digest, journey identity, internal participant, and optional lineage digest from the dispatch packet |
| Modern state strips identity fields to enter legacy migration | Migration requires a byte-identical external backup, a positively supported historical router digest, and matching captured state/plan/audit fingerprints; an allowlisted router digest alone is insufficient |
| Migration crashes after writing rebound sidecars | Migration is copy-on-write: new plan/audit/packet/receipt files are staged under a bound transaction directory and only the state pointer commits; active legacy sources remain byte-identical before commit |
| Migration receipt or backup provenance is redirected | The caller-retained resume authority includes the migration authority, external backup path/digest, retained legacy sidecar digests, capture fingerprints, and transaction directory |
| Re-signed state redirects plan, audit, packets, final, or a phase receipt outside `<state>.d/` | Resume reconstructs the authority-bound canonical parent path contract, rejects the redirect before child spawn or ledger write, and independently includes the active audit ledger in the child-boundary snapshot |
| A newer feature version silently becomes the product parent | Optional planning lineage fixes the relationship to `slice-of`; version strings have no precedence and `supersedes_parent` must remain `false` |
| Parent or slice bytes change after lineage planning | Both artifact sets, the exact routed candidate set, state, packets, child requests, phase receipts, and owner scope share one lineage digest and are reverified before child execution |
| Lineage bypasses G7, or G7 approves/promotes a different slice | Declaring lineage adds G7 to every effective route requirement; `approved-artifact` evidence must exactly equal the candidate set, and separate owner evidence binds the lineage ID, digest, complete candidate, candidate-only decision scope, and `parent_promotion: false` |
| Two start/resume/migrate calls use one state | Atomic state-path lease acquisition precedes every mutation and child spawn; the loser exits `5` |
| Dead or reused PID causes the wrong lease decision | No automatic deletion; recovery requires the exact token, timestamp, bound state digest, recovery deadline, and PID-bound OS process-start identity |
| Orchestrator dies while a child is running | Sealed in-flight intent becomes a receipt-bound `abandoned_after_crash` attempt and requires explicit retry |
| Crash lands between lease and state-file digest writes | Current and pending digests bind the two-phase transition; recovery accepts only the actual bound value |
| State prepare succeeds but file replacement or lease commit fails | Normal release refuses `state-write` and every non-null pending digest, preserving the recovery boundary |
| Recovery tuple is copied from `lease status` without journey authority | A modern state is fully verified against the original caller-retained `resume_authority_digest` before the stale lease can be claimed or the ledger changed |
| Initial `--out`, router, or profile path crosses a pre-existing symlink ancestor | Trusted-root physical resolution and component checks run before lease/state creation; the run writes no parent state through the redirected path |
| An ancestor is swapped after writable-path preflight | Secure directory creation and atomic JSON replacement bind parent and temp-file device/inode identities and recheck at every write/commit boundary; deterministic after-preflight and pre-commit fault injections leave redirect targets empty |
| Standalone audit ledger, packet, or receipt `--out` path crosses a symlink ancestor | Initialization preflights both ledger and packet roots; dispatch rechecks the root and each generated file; ledger mutations require a real single-link run file; symlink targets remain untouched; stdout remains an intentionally pipeable caller-controlled transport |
| `run --dry-run --out` or `digest --out` crosses a pre-existing symlink ancestor | The common explicit-output preflight rejects the path before writing and leaves the redirected target empty; stdout remains caller-controlled transport |
| Child swaps its evidence root after returning success | Execution binds physical grant/output identities; audit ingestion rechecks them and every evidence tree immediately around the digest snapshot |
| A pre-existing symlink ancestor redirects evidence writes | Every component from the automation-state grant to packet output is checked before and after directory creation; symlink ancestors block before child spawn |
| Operator/ERP artifact routed as a consumer product | Required artifact-root surface contract resolves before creator selection; ambiguity, CLI mismatch, and mixed-surface runs block |
| Surface contract changed after planning | Plan records the profile digest; audit and resume re-hash the same profile source |
| Anti-slop critique laundered into a paper/editorial house style | Surface and visual intent are separate; editorial treatment requires a verified `bounded` or `required` contract and an independent intent review |
| `marketing-editorial` misread as visual permission | Surface is semantic only; the visual-intent contract defaults to no permission and must explicitly authorize editorial treatment |
| Visual-intent receipt or basis replaced | Profile locks the receipt digest; the receipt locks evidence digests; audit snapshots and rechecks the complete chain |
| Main color or style guessed from source frequency | Visual-signature roles require matching digest-bound evidence and per-aspect coverage; frequency is discovery only |
| Critic replaces approved tokens or globally flattens depth | Exact signature reaches every packet; token substitution and unapproved normalization are hard blockers |
| Missing direction silently becomes one fashionable house style | Missing direction has no creator fallback; the design workflow requires three project-specific theses across three redesign depths and an owner shortlist |
| Nine candidates are cosmetic variants of one template | The brief binds distinct theses, subject worlds, signature elements, anti-references, and baseline rules; the independent comparison scores distinctiveness and project fit |
| Popularity turns one fashionable screen into a universal answer | Eligibility and product-fit band are evaluated first; weighted popularity orders only references inside the same band and cannot override hard gates or owner authority |
| Popularity becomes a hard sampling quota | Required coverage cohorts describe reasoning value (`task-fit`, `cross-domain`, `competent-baseline`), never reach or bookmarks; popularity remains optional rank metadata |
| Two UI Bowl records report incompatible popularity | Every signal binds product-or-screen subject kind, subject record ID, scope, metric, snapshot time, and evidence; declared conflicts cannot be critic-verified and rank last inside the fit band without changing eligibility |
| One product-level popularity claim is repeated across several screen records to inflate weight | Repeated product-subject signals must be canonically identical across those screens or explicitly conflicted; KSR treats the claim as shared provenance rather than independent votes |
| Provider inflates product-fit or normalized popularity numbers | KSR deterministically recomputes fit score/band from six fixed dimensions and normalized popularity from brief-fixed scope/category/bounds/metric direction before ranking |
| Manual discovery invents a product, screen, frame, URI, popularity record, or evidence file | KSR schema-validates the digest-bound export manifest and requires exact membership for every returned record and source-evidence file before accepting discovery; evidence paths stay inside the manifest directory and their bytes, declared content kind, digest, and physical identity are pinned |
| Evidence from one product, screen, frame, or popularity subject is relabelled as another | Every evidence record remains closed over its enclosing product and screen, enumerated frames, and explicit subject bindings; observations require the bound screen/frame and popularity records require evidence carrying the exact product-or-screen subject |
| A visually close reference with material cloning risk reaches Owner selection | Only independently verified `copy_risk: low` references are eligible; medium or high risk cannot be rescued by fit, popularity, or an otherwise clean review |
| Promotional splash art is mistaken for product hierarchy | Promotional and single/no-task screen families are weak evidence; they cannot verify operational hierarchy, navigation, comparison, evidence, interaction, or responsive grammar, and their eligible corpus ratio is capped |
| UI Bowl screenshot or source asset becomes a clone prompt | Internal reference evidence may retain the authorized capture. The full pack retains source identities, links, verified text observations, reasoning, grammar, and only a path-free digest/kind manifest for source material; it strips capture paths, encoded bytes, inline images, and pixels and remains `discovery-evidence-only`. A separate creator-safe projection strips source identities and observations as well |
| One source screen is relabelled as several products | Canonical source URL and screen record identity must be unique; product/category/ecosystem counts are normalized, critic-verified, and Owner support crosses product, category, and ecosystem boundaries |
| A generic principle hides arbitrary aesthetic preference | Every grammar item binds visible priority to a user decision, likely constraint, flattening consequence, application conditions, tradeoff, harmful context, and anti-copy boundary; the critic verifies every cited ID |
| Bundled reasoning lenses silently become visual authority | The registry is copied into the state and digest/physical-identity bound as `non-authoritative-research-aid`; state and packets preserve that scope and the downstream pack explicitly denies authority |
| A malformed, cross-target, changed, or detached reference pack injects creator direction | The optional design bridge runs the shared strict pack validator, checks file/internal digests and physical identity, current registry, exact project/surface/screen/product frame, evidence graph, anti-copy text, fixed checks, false authority flags, pixel exclusion, the exact completed producer state/output/result/selection lineage, and the explicit version-1 `reviewer_source_access` contract before any creator packet is emitted |
| Metadata-only research completion is mistaken for design readiness | The pack separately records router-recomputed `reviewer_source_capture_readiness`; only `ready_at_compilation` with every selected reference and verified observation frame covered can enter design, while `manual_pending` remains a valid research outcome and is revalidated at design start |
| Reviewer-only source pixels leak into a creator or browser child | The brief limits access to `digest-bound-internal-critic`, the two named firewall/composition purposes, and `source-capture`; redistribution, creator, browser, and network flags are false. Only an `independent-reviewer` packet may carry `review_source_authority` and require `reference-evidence:read`. Creator/browser packets forbid that permission, omit the authority, and keep `source_pixels_exposed_to_downstream_creator: false`; actual source paths exist only in reviewer run artifacts |
| A source-privileged reference participant is recycled as a creator or browser under a later run | `review_source_authority` binds sorted unique source-recipient provider IDs from accepted results and all executable attempts, including failed attempts, plus actor IDs from accepted normalized results. The consuming design run rejects their reuse as direction/color creators or browser participants before state creation or result acceptance; independent reviewer reuse remains allowed |
| A source-recipient provider is renamed or its adapter is replaced to evade cross-run separation | The derived reviewer authority binds a canonical per-attempt execution lineage: provider, adapter and declaration, execution authority, and entrypoint content, physical-identity, and graph digests. KSR re-derives it from the producer state; an entirely manual run records no executable attempts rather than synthetic authority |
| Source identities or composition become a clone prompt | KSR gives creators only aliased causal reasoning and transferable grammar, strips source names/URLs/observations/pixels, forbids external network access for every reference-carrying design participant, requires low copy risk, and rejects affirmative source-composition reuse. Reviewer source captures are aliased and digest-bound through `capture_set_digest` and cannot be forwarded to a creator |
| Final design provenance republishes reviewer source paths | The final binding keeps only `review_source_capture_set_digest` and the direction/color source-composition-analysis digests; source paths and pixels remain outside the decision and profile bindings |
| A design creator ignores the reference reasoning | When a pack is bound, each selected dimension needs an applied or target-specific not-applicable trace preserving the exact grammar-to-causal edge; each independent direction/color review must disposition its stage checks and bind `reference-capture-set` to `reference-authority/source-capture-set` and `source-composition-analysis` to a schema-valid `review-evidence/source-composition-analysis`, in addition to every other required typed artifact |
| Critic verifies grammar but not its source observations | Verified fit, inference, hierarchy reasoning, and grammar must close over critic-verified source observations and source-evidence IDs; the pack retains a path-free, frame-bound digest manifest needed to audit that graph |
| English-first evidence is silently transferred to Korean UI | Every reference records locale, grammar declares transferability and risk for all target locales, coverage requires direct target-locale evidence, and later font/browser gates remain mandatory |
| Reference researcher approves its own interpretation | Discovery, grammar, and critic providers are distinct; returned critic actor cannot equal either research actor; the real owner still selects the anchor, supports, and grammar |
| Researcher labels inflate component or pattern coverage | Coverage counts only source-declared component families and patterns explicitly repeated by the independent critic; an undeclared critic claim blocks the result |
| Reference recovery repeats a completed researcher child | A post-child checkpoint must exactly match packet, provider, attempt, packet digest, and result digest; recovery records one idempotent receipt and resume skips the immutable result |
| A local process re-seals reference state during a stale lease | Recovery accepts only the current or pending state digest already bound by that lease; another internally consistent digest remains a conflict |
| A host manifest or adapter is replaced after an automated reference/design child ran | Each automated attempt retains the exact host-manifest and provider-declaration digest plus the adapter entrypoint's content, physical identity, and module graph; reference attempts additionally bind a pinned authority sidecar. Read/resume reverify that historical grant, and a legacy automated attempt without it must restart rather than be backfilled from current files |
| A caller-supplied result points KSR at unrelated local files | Manual evidence must remain under the submitted result file's directory and is opened through the same caller-owned, single-link pinned-descriptor boundary |
| Manual-export research silently reaches the network | At least one caller-owned export manifest is schema-valid and digest/membership-bound; discovery explicitly forbids `network:external`, grammar/review and downstream reference-carrying design participants always forbid it, and automated retrieval requires the separate allowlisted read-only mode plus explicit permission and verified rights/retention scope |
| Reference research silently replaces the canonical design route | The pack explicitly grants no visual intent/signature authority and records that the exact-three 3×3 route, Playwright, and owner gates remain unchanged |
| Design creator supplies its own screenshots or review | Candidate, browser, comparison, and owner actor identities are checked separately; self-review and self-approval block |
| Color generator asserts fabricated accessibility ratios | The router recomputes contrast from normalized sRGB roles and requires non-color meaning before color review or approval |
| Palette harmony is treated as owner approval | OKLCH/HCT and harmony metadata are generation evidence only; independent color review and exact owner approval remain required |
| Marketing palette leaks into an operator product | Signatures are keyed and verified per routed surface; cross-surface evidence is not merged implicitly |
| Visual-signature receipt or evidence replaced | Profile, audit, approval scope, and final receipt bind and re-hash the complete signature chain |
| Final receipt points only to a display path | The final audit receipt retains the canonical plan `resolved_path` and digest; receipts are local security artifacts, so publish a separately redacted, non-authoritative report instead of rewriting the signed receipt |
| Child redirects parent `results/`, `receipts/`, plan, audit, or state paths before ingestion | The parent snapshots the complete state/sidecar tree outside the one attempt output grant, rechecks physical identities and digests immediately after the child exits, writes nothing through a changed tree, and keeps the state lease unresolved for explicit recovery |
| Re-signed audit redirects an automated result or evidence to an external copy | Every result-bearing automated attempt retains its physical grant/output identity; resume requires the audit source to equal the latest recorded result and re-snapshots every evidence item through that exact boundary before any child or ledger write |
| Approval, scanner triage, or manual review is supplied from child-writable state | Integrated start/resume accepts only an invoking-user-owned, non-group/world-writable, symlink-free, single-link regular file outside the state file and `.d/` tree; a pinned read-only descriptor must retain one identity through parse, or the input exits with integrity code 4 before initial state creation, acceptance, or another child start |
| Legacy migration stages through a pre-existing `identity-migrations` symlink | The transaction path is physically preflighted against the canonical state directory before its first directory or sidecar write |
| Profile command injection | Execution fields are rejected; the executor never reads a profile command |
| CI action tag substitution | Checkout and Node setup actions use immutable full commit SHAs under read-only workflow permissions |
| Vulnerable or stale dependency silently lands | Dependabot proposes npm and Actions updates; production high-severity advisories fail CI; every proposal still requires normal review |
| Unapproved provider execution | Provider ID must be in the explicit host allowlist |
| Entrypoint or imported-helper substitution | Exact entrypoint and module-graph digests; every explicit local module is content/physical-identity checked immediately before spawn and loaded from descriptor-fed sealed bytes |
| Shell injection | Fixed Node executable, fixed single entrypoint argument, `shell:false` |
| Project selects a nested Codex command | Only `host configure-codex` can bind the bundled bridge; runtime, root, model, schema, and skill settings are strictly validated and digest-locked |
| Codex reviewer reuses the creator session | Every packet starts one fresh ephemeral thread; result actor identity is derived from its JSONL thread ID and the ledger still checks provider/actor independence |
| Missing Codex auth or runtime reported as execution | Readiness and nested preflight return explicit `manual_pending`; no result is ingested and no attempt is labeled `ran` |
| Codex runtime, skill, schema, or adapter dependency substitution | Complete roots and individual executable/schema files plus the full local adapter module graph are content- and physical-identity checked. The runtime root is privately cloned, rechecked around the copy and immediately before spawn, and only the sealed binary and sealed adapter graph execute. |
| Codex reviewer mutates or expands authority | Read-only sandbox, fixed capability set, forbidden event rejection, and separate scanner/browser/design/owner gates |
| Artifact prompt injection biases a model verdict | Treat the response as a bounded critic claim; retain independent stages, conflict adjudication, deterministic evidence, and owner authority |
| Capability downgrade | Runtime declaration must cover the packet assignment and minimum strength |
| Creator self-review | Provider and actor identity checks during audit ingestion |
| `routable` reported as `ran` | Only an ingested result gets execution status `ran`; otherwise `manual_pending` or blocked |
| Scanner false verdict or zero-hit approval | Findings remain candidates until explicit triage; zero hits never satisfy visual-intent, craft, browser, or owner gates |
| Reviewer averaging | Conflicting finding references require an adjudication resolution |
| Fake browser proof | Viewport screenshots and non-screenshot check coverage are validated separately |
| Critical tabs, dialogs, or permission states omitted from a root screenshot | A non-empty reviewed scenario inventory is bound in profile/plan, and the ledger requires non-screenshot proof plus every scenario × viewport screenshot |
| Manual or generic browser child presented as the observed current UI | Runtime redesign accepts only a finalized pre-change audit routed to and executed by the official Playwright child transport |
| Official Playwright route executed by a substituted generic host | An official route is executable only when the digest-locked host declaration has the official Playwright contract; otherwise the packet remains `manual_pending` |
| Visual authority or browser route changed between observation and redesign | The before/after pair requires the exact same routed profile digest and rechecks it on resume |
| UI is changed before its defects and visual character are observed | Runtime redesign requires `--observation-run`; the state binds pre-change artifacts, browser result, scenarios, audit, and final receipt and rechecks them on resume |
| Browser points at another build | Served endpoint must attest the packet's exact artifact digest map before launch |
| Design prototype or candidate evidence is replaced between shortlist and approval | Every candidate result, prototype, Playwright screenshot/report, shortlist scope, color scope, and final owner decision is digest-bound and rechecked on resume |
| Browser runtime, scenario, viewport, or allowed-origin substitution | Bundled entrypoint and runtime packages are digest-locked; the profile-bound browser verification digest must also match the exact scenario bytes, viewport dimensions, allowed origins, browser channel, locale, color schemes, and interaction limits |
| Material visual baseline change | Playwright comparator permits zero non-antialiased differing pixels and writes a reviewable diff PNG |
| Browser data exfiltration | Loopback default, explicit external-network authority, and per-request origin blocking |
| Static design prototype reads mutable or unrelated resources | Official design Playwright requires one self-contained digest-bound HTML file; only that exact `file:` URL plus `data:`, `blob:`, and `about:` are allowed, while all other local and network requests are blocked |
| Artifact or evidence replacement | SHA-256 snapshots are rechecked at finalization and resume |
| Lexically in-root evidence escapes through a symlink or hard link | The child output root, its implicit or explicit grant, every ancestor, and every evidence component are checked by real path plus lossless device/inode identity; only verified root-owned macOS `/tmp` and `/var` aliases are canonicalized, while other symlinks, multi-link regular files, special files, and root replacement are rejected |
| Automation output mutates a directory artifact | Nested state is rejected unless it is under the ignored `.killsloprouter/` boundary |
| Approval reuse | Approval must match the run ID, journey identity, and exact approval-scope digest |
| Privacy or authority bypass | Required locale, domain, privacy, browser, and owner packets remain required |

The strict pack validator proves internal consistency, current bundled-registry
binding, and unchanged caller-supplied bytes. It does not authenticate an
adversary who controls the reference results, Owner selection, design brief,
pack file, and caller-retained digests together. That remains outside V1's
local integrity model. The pack is therefore never visual authority, and fresh
independent design review, Playwright evidence, and Owner approval remain
mandatory even when every reference check passes.

## Integrity limitations

SHA-256 snapshots detect a changed file relative to the ledger. They are not
digital signatures. A writer who can replace the artifact, all evidence, every
receipt, and the ledger can construct a new internally consistent run. Store CI
evidence immutably and sign final receipts when that attacker is in scope.

Visual-intent and visual-signature authority IDs are asserted provenance under
the same limit. A digest proves that the reviewed project, brand, design-system,
reference, or owner evidence did not change within the run; it does not
authenticate who authored that evidence.

Directory artifacts ignore `.git`, `node_modules`, and `.killsloprouter` by
default. Symlink artifacts and adapter entrypoints are rejected so changing a
link target cannot silently change the reviewed bytes.

## Privacy guidance

Before granting `artifact:read` or `network:external`:

- remove credentials, secrets, payment data, personal data, and unrelated private source;
- verify the adapter version, license, data retention, and destination;
- use a privacy-authority stage for high-risk routes;
- keep external network access off unless the review genuinely requires it;
- do not place credentials in the profile, host manifest, adapter settings, or result JSON.

Repository writes, pull-request mutation, publishing, deployment, production
access, and credential use are outside the V1 host adapter permission model.
