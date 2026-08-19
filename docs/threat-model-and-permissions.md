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

### Adapter child

The child is trusted code running with the operating-system privileges of the
KillSlopRouter process. The host fixes the Node executable, disables shell
interpretation, removes profile arguments, reduces the environment, enforces a
timeout, and confines accepted evidence paths. It does not provide an OS or
network sandbox. Run third-party adapters in a container, VM, or restricted CI
worker when the entrypoint itself is not fully trusted.

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
| Unapproved provider execution | Provider ID must be in the explicit host allowlist |
| Entrypoint substitution | Regular non-symlink file plus exact SHA-256 digest |
| Shell injection | Fixed Node executable, fixed single entrypoint argument, `shell:false` |
| Capability downgrade | Runtime declaration must cover the packet assignment and minimum strength |
| Creator self-review | Provider and actor identity checks during audit ingestion |
| `routable` reported as `ran` | Only an ingested result gets execution status `ran`; otherwise `manual_pending` or blocked |
| Scanner false verdict or zero-hit approval | Findings remain candidates until explicit triage; zero hits never satisfy visual-intent, craft, browser, or owner gates |
| Reviewer averaging | Conflicting finding references require an adjudication resolution |
| Fake browser proof | Viewport screenshots and non-screenshot check coverage are validated separately |
| Browser points at another build | Served endpoint must attest the packet's exact artifact digest map before launch |
| Design prototype or candidate evidence is replaced between shortlist and approval | Every candidate result, prototype, Playwright screenshot/report, shortlist scope, color scope, and final owner decision is digest-bound and rechecked on resume |
| Browser runtime or scenario substitution | Bundled entrypoint, runtime packages, scenario file, and baseline directory are digest-locked |
| Material visual baseline change | Playwright comparator permits zero non-antialiased differing pixels and writes a reviewable diff PNG |
| Browser data exfiltration | Loopback default, explicit external-network authority, and per-request origin blocking |
| Static design prototype reads mutable or unrelated resources | Official design Playwright requires one self-contained digest-bound HTML file; only that exact `file:` URL plus `data:`, `blob:`, and `about:` are allowed, while all other local and network requests are blocked |
| Artifact or evidence replacement | SHA-256 snapshots are rechecked at finalization and resume |
| Automation output mutates a directory artifact | Nested state is rejected unless it is under the ignored `.killsloprouter/` boundary |
| Approval reuse | Approval must match the run ID and exact approval-scope digest |
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
