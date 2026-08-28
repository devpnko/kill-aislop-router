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

The installer and `doctor` also inspect the runtime skill catalog. A full local
`kill-slop-router` entry alongside the namespaced plugin is an identity
conflict. Migration is never implicit: the operator must pass
`--migrate-legacy-entry`, after which the original directory is preserved in a
digest-verified backup and only an implicit-disabled handoff shim remains.
Changing the shim or backup fails closed. Standalone antislop is outside this
migration boundary.

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
The exact recorded process identity must no longer be live; an unrelated
process that reused its PID does not keep the lease stuck. If liveness cannot
be distinguished, recovery fails closed. A recovery claimant is itself
exclusive, carries the same process-start binding, and writes a receipt before
releasing the lease. POSIX process-start queries force `LC_ALL=C`, `LANG=C`,
and `TZ=UTC`, preventing caller locale or timezone from changing the marker.

If termination happens after child spawn but before result ingestion, external
completion cannot be proven transactionally. The sealed in-flight intent is
recorded as `abandoned_after_crash`, never `ran`; retry remains a separate
operator authorization. V1 guarantees non-overlapping starts and ledger
serialization, not exactly-once effects in an external provider.

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
timeout, and confines accepted evidence paths. It does not provide an OS or
network sandbox. Run third-party adapters in a container, VM, or restricted CI
worker when the entrypoint itself is not fully trusted.

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
package directories, scenario file, and visual baseline directory are
independently digest-locked. A mismatch blocks before evidence ingestion.

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
| `network:external` | Operator acknowledges that the adapter may send data outside the machine | Declaration only; enforce isolation outside this process |

Provider permissions must be a subset of the manifest's granted permissions.
Browser execution cannot be disguised as a generic agent adapter.

## Fail-closed controls

| Threat | Control |
|---|---|
| Child critic is presented as the selected workflow | Digest-bound parent identity stays KillSlopRouter; child provider metadata is internal-only and presentation regressions cover correction and resume wording |
| Legacy local router wins catalog precedence | Installer and doctor detect the duplicate; only an explicit backup-bound, implicit-disabled shim migration clears the conflict |
| State is re-signed with another parent before resume | Step receipts, audit, packets, approval, and migration receipt must all match the same identity before another child runs |
| Two start/resume/migrate calls use one state | Atomic state-path lease acquisition precedes every mutation and child spawn; the loser exits `5` |
| Dead or reused PID causes the wrong lease decision | No automatic deletion; recovery requires the exact token, timestamp, bound state digest, recovery deadline, and PID-bound OS process-start identity |
| Orchestrator dies while a child is running | Sealed in-flight intent becomes a receipt-bound `abandoned_after_crash` attempt and requires explicit retry |
| Crash lands between lease and state-file digest writes | Current and pending digests bind the two-phase transition; recovery accepts only the actual bound value |
| State prepare succeeds but file replacement or lease commit fails | Normal release refuses `state-write` and every non-null pending digest, preserving the recovery boundary |
| Operator/ERP artifact routed as a consumer product | Required artifact-root surface contract resolves before creator selection; ambiguity, CLI mismatch, and mixed-surface runs block |
| Surface contract changed after planning | Plan records the profile digest; audit and resume re-hash the same profile source |
| Anti-slop critique laundered into a paper/editorial house style | Surface and visual intent are separate; editorial treatment requires a verified `bounded` or `required` contract and an independent intent review |
| `marketing-editorial` misread as visual permission | Surface is semantic only; the visual-intent contract defaults to no permission and must explicitly authorize editorial treatment |
| Visual-intent receipt or basis replaced | Profile locks the receipt digest; the receipt locks evidence digests; audit snapshots and rechecks the complete chain |
| Main color or style guessed from source frequency | Visual-signature roles require matching digest-bound evidence and per-aspect coverage; frequency is discovery only |
| Critic replaces approved tokens or globally flattens depth | Exact signature reaches every packet; token substitution and unapproved normalization are hard blockers |
| Missing direction silently becomes one fashionable house style | Missing direction has no creator fallback; the design workflow requires three project-specific theses across three redesign depths and an owner shortlist |
| Nine candidates are cosmetic variants of one template | The brief binds distinct theses, subject worlds, signature elements, anti-references, and baseline rules; the independent comparison scores distinctiveness and project fit |
| Design creator supplies its own screenshots or review | Candidate, browser, comparison, and owner actor identities are checked separately; self-review and self-approval block |
| Color generator asserts fabricated accessibility ratios | The router recomputes contrast from normalized sRGB roles and requires non-color meaning before color review or approval |
| Palette harmony is treated as owner approval | OKLCH/HCT and harmony metadata are generation evidence only; independent color review and exact owner approval remain required |
| Marketing palette leaks into an operator product | Signatures are keyed and verified per routed surface; cross-surface evidence is not merged implicitly |
| Visual-signature receipt or evidence replaced | Profile, audit, approval scope, and final receipt bind and re-hash the complete signature chain |
| Profile command injection | Execution fields are rejected; the executor never reads a profile command |
| CI action tag substitution | Checkout and Node setup actions use immutable full commit SHAs under read-only workflow permissions |
| Vulnerable or stale dependency silently lands | Dependabot proposes npm and Actions updates; production high-severity advisories fail CI; every proposal still requires normal review |
| Unapproved provider execution | Provider ID must be in the explicit host allowlist |
| Entrypoint substitution | Regular non-symlink file plus exact SHA-256 digest |
| Shell injection | Fixed Node executable, fixed single entrypoint argument, `shell:false` |
| Project selects a nested Codex command | Only `host configure-codex` can bind the bundled bridge; runtime, root, model, schema, and skill settings are strictly validated and digest-locked |
| Codex reviewer reuses the creator session | Every packet starts one fresh ephemeral thread; result actor identity is derived from its JSONL thread ID and the ledger still checks provider/actor independence |
| Missing Codex auth or runtime reported as execution | Readiness and nested preflight return explicit `manual_pending`; no result is ingested and no attempt is labeled `ran` |
| Codex runtime, skill, or schema substitution | Complete roots and individual executable/schema/entrypoint files are digest-checked at configuration, manifest load, and child execution |
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
| Automation output mutates a directory artifact | Nested state is rejected unless it is under the ignored `.killsloprouter/` boundary |
| Approval reuse | Approval must match the run ID, journey identity, and exact approval-scope digest |
| Privacy or authority bypass | Required locale, domain, privacy, browser, and owner packets remain required |

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
