# Official Codex Review Host

The opt-in Codex host runs audit-only `agent-json-v1` and `skill-json-v1`
reviewers without asking each project to author an executable adapter. It is a
local host integration, not an MCP server. The deterministic CLI still owns
routing, capability and strength checks, result ingestion, tamper detection,
scanner triage, conflict adjudication, browser proof, and owner approval.

This integration is optional. A manual host manifest remains the safe bootstrap
default.

## What the configure command locks

`host configure-codex` is the only supported way to create an official Codex
review declaration. It writes no executable data to the project profile. For
every selected provider it binds:

- the bundled `src/adapters/codex-review.mjs` entrypoint, its SHA-256 digest,
  and the complete explicit local module-graph digest;
- the exact Codex executable and its digest;
- the complete operator-selected runtime root and directory digest;
- the bundled structured-output schema and digest;
- an explicit model name;
- the route's existing strength and complete capability contract;
- `artifact:read` and explicitly granted `network:external` permissions;
- for `skill-json-v1`, the complete skill root and directory digest;
- fixed runtime and output limits.

The command backs up the previous host manifest and writes
`.killsloprouter/codex-host-setup-receipt.json`. It refuses to replace an
existing non-manual, non-official provider unless `--replace` is explicit.

## Configure

First verify the selected runtime and its authentication outside the router:

```bash
codex --version
codex login status
```

The official bridge requires `codex-cli` 0.144.0 or newer. Configuration binds
the exact installed version and bytes; meeting the minimum alone never bypasses
the digest lock.

Then bind agent reviewers and any installed skill reviewers. The standalone
Codex installation below is an example; pass the real reviewed locations on
the host. Prefer a Router-owned provider directory outside Codex's automatically
discovered skill roots, such as `~/.killsloprouter/providers/anti-slop`:

```bash
killsloprouter host configure-codex \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --runtime "$HOME/.codex/packages/standalone/current/bin/codex" \
  --runtime-root "$HOME/.codex/packages/standalone/current" \
  --model gpt-5.4 \
  --agent-providers project-contract,visual-intent-review,locale-copy-review,domain-authority-review,privacy-authority-review \
  --skill-provider "anti-slop=$HOME/.killsloprouter/providers/anti-slop" \
  --allow-external \
  --json
```

`anti-slop` is deliberately skill-only. Do not include it in
`--agent-providers` and do not invoke the standalone antislop workflow in the
parent or creator session. The command above locks the selected skill directory
and the Router invokes it only for its `functional-human-review` packet. The
child treats that packet as the already-selected AFTER/audit mode, skips the
skill's installation wizard and usage-mode question, remains read-only, and
returns only the Router result schema.

An older or hand-written host manifest that maps `anti-slop` to
`agent-json-v1` remains readable, but execution stays `manual_pending`. Rerun
the command with `--skill-provider anti-slop=/absolute/skill/root` to migrate.
If the same skill is globally discoverable by Codex, set
`policy.allow_implicit_invocation: false` in its `agents/openai.yaml`. This
prevents a duplicate parent-session workflow without disabling explicit use or
the digest-locked Router child.

`--skill-provider PROVIDER_ID=DIR` is repeatable. The directory must contain
`SKILL.md`; the whole directory is locked so a linked reference cannot change
silently. `--agent-providers` is a comma-separated list. The provider must have
a strength and capability contract in the router or project fallback profile.
KillSlopRouter does not fetch or bundle third-party reviewer instructions;
the operator must place the reviewed antislop version in that provider
directory before configuration.

`--model` is required so the host does not silently inherit a changing model
choice. The host records that fixed argument as provenance. Codex JSONL does
not independently report the effective model, so this is a configuration claim
bound to the exact runtime and invocation rather than remote model attestation.

The router requires `--allow-external` because a Codex review can transmit
artifact content to the configured model service. It adds
`network:external` only to the separate host manifest. No API key, access
token, auth file contents, or credential-store path is copied into the profile,
manifest, request, result, setup receipt, or audit receipt. Authentication stays
in the Codex runtime's normal host store.

After configuration, rerun the normal readiness and lifecycle commands:

```bash
killsloprouter doctor --profile .killsloprouter/profile.json --json

killsloprouter run \
  --dry-run \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task redesign \
  --direction approved \
  --changes source,copy,layout,interaction \
  --artifact ./src \
  --scope runtime \
  --creator-id codex:creator-session-id \
  --json
```

## Execution boundary

For each eligible packet, KillSlopRouter rechecks the content and physical
identity of every module in its configured adapter graph and starts that graph
from descriptor-fed sealed bytes with `shell:false`. The adapter rechecks the
runtime, runtime-root, schema, skill, and artifact digests immediately before
starting the nested Codex process, then rechecks artifact digests again before
accepting its output. The
nested invocation has a fixed argument list:

Loading or dry-running a host manifest validates the source runtime and reuses
a cache keyed by its content and physical identities; it does not clone the
complete runtime once per configured provider. This readiness optimization
does not cross the execution boundary: every actual reviewer adapter creates,
verifies, uses, and removes its own private runtime seal.

- one new `codex exec --json --ephemeral` thread per packet;
- `--sandbox read-only` and non-interactive `approval_policy="never"`;
- ignored user configuration, project execution rules, and project
  `AGENTS.md` content;
- no automatic user/bundled skill instructions and no plugin, app, MCP,
  browser, web-search, computer-use, image-generation, or multi-agent
  capability;
- a reduced shell environment and no inherited secret variables;
- a digest-locked JSON output schema;
- explicit timeout and output limits.

For `anti-slop`, the wrapper additionally verifies the provider ID, routed
stage, `skill-json-v1` mode, and locked skill name before starting Codex. It
explicitly suppresses standalone installation, mode-selection, creation, and
fix behavior. Antislop remains one bounded critic and cannot select palette,
typography, density, geometry, depth, imagery, or motion.

Read-only shell commands may inspect the artifact. The wrapper rejects event
streams that show file changes, MCP calls, delegation, web search, browser-like
computer control, or image generation. It derives the reviewer actor from the
fresh JSONL `thread_id`; the model cannot choose that identity. The audit ledger
then rechecks provider identity, creator independence, the complete capability
set, artifact digests, findings, conflict resolutions, and result schema.

Artifact text is untrusted model input and can contain prompt-injection-like
instructions. Digest binding and structured output preserve provenance and
shape; they do not prove that a model finding is true. Treat each result as one
bounded critic opinion. Independent stages, conflict adjudication, deterministic
scanner and browser evidence, and exact owner approval remain authoritative in
their own scopes.

For each readiness probe and review, the wrapper creates a mode-`0700`
temporary `CODEX_HOME` containing only a symlink or hard link to the host's
regular, non-symlink `auth.json`. It sets both `HOME` and `CODEX_HOME` to that
directory and removes it after the child exits. This keeps user config,
installed skills, plugins, sessions, and unrelated Codex state out of the
reviewer context without copying credential bytes into router artifacts or
receipts. If the isolated auth link cannot be created, readiness remains
`manual_pending`. Authentication filesystem failures are reduced to stable,
non-path-bearing readiness reasons; raw filesystem errors, auth content
digests, and credential-store paths are not copied into setup output, host
inspection, dry-run output, receipts, or stderr.

Readiness cache identity includes pinned auth content plus stable file identity.
Expected hard-link creation/removal metadata does not masquerade as credential
mutation, while in-place byte changes and inode replacement invalidate the
observation. Only a successful authenticated observation is cached; transient
negative probes are retried. A change during the probe or unresolved temporary
credential-view cleanup remains `manual_pending` and cannot become execution
evidence.

The nested runtime's raw stdout and stderr are never public error text. Unknown
non-zero exits, output-boundary failures, invalid JSONL, invalid structured
review JSON, and unsafe thread identifiers become fixed adapter errors before
the outer execution ledger records them. This prevents error strings from
turning credential paths, auth digests, or input fragments into state, audit,
receipt, or terminal output.

The configured runtime has a separate execution seal. Configuration records
both content digests and filesystem identity digests for the executable and
complete runtime root. Each probe and review copies that root into a private
mode-`0700` directory, rewrites internal symlinks to remain inside the copy,
checks the configured source before and after copying, and executes only the
copied binary. The source pathname is never the nested execution target. A
same-byte inode replacement therefore blocks; changing the source after the
seal is complete cannot change the running reviewer.

The setup and runtime have three distinct failure classes:

| Condition | Result |
|---|---|
| Adapter not configured, Codex runtime absent/not executable, skill absent, or authentication unavailable | `manual_pending`, exit `6` in an incomplete run |
| Runtime, runtime root, adapter, schema, skill, artifact, state, result, or evidence content/physical identity changed | tamper/block, non-zero |
| Codex starts but fails, times out, exceeds output, emits invalid JSONL/schema, or uses a forbidden event capability | `blocked_execution_error`, non-zero |

A late authentication failure returned by the nested runtime is still
`manual_pending`; it is never rewritten as `ran`. Only a structured result that
the ledger ingests is execution evidence.

## Deliberate exclusions

The official Codex host is a read-only audit reviewer. It refuses to substitute
for:

- `kill-ai-slop-v1` scanner execution and scanner triage;
- `browser-json-v1` Playwright evidence;
- `owner-approval`;
- design-direction or color candidate creation and comparison;
- project creators and design-system generation;
- external G6T/G7 service-planning authority.

Locale, domain, and privacy reviewer providers may be bound only when the
operator selects those exact providers. Their packets and strength/capability
requirements remain separate. Owner approval is always a later, exact-scope
decision and can never be configured through this command.

## OS and container isolation

The digest lock proves which local code was selected; it does not make that
code trustworthy. The outer Node adapter has the operating-system privileges
of KillSlopRouter. The nested Codex process uses Codex's platform read-only
sandbox, which prevents artifact writes but is not an artifact-only read jail
on every supported OS. Depending on the Codex platform implementation, a
read-only process may be able to read other host files even though the prompt
and logical permission limit it to the named artifacts.

For private, regulated, or hostile repositories, run the whole router and
Codex runtime inside a container, VM, restricted CI worker, or dedicated OS
account whose readable filesystem contains only the reviewed artifact and
required tool/skill runtime. Remove secrets and unrelated personal data before
granting `artifact:read` or `network:external`. This project does not provide a
container boundary or authenticate remote model identity. A hostile process
running as the same OS user can race mutable host pathnames, including a
momentary replace-and-restore of the auth pathname; that ABA threat requires
the dedicated-account or container boundary above and is not claimed as an
in-process guarantee.

## Upgrade and removal

Changing the Codex binary, runtime root, bundled adapter, output schema, or
skill root intentionally invalidates the previous lock. Runtime locks made by a
pre-seal V1 preview also lack required physical-identity fields. Rerun the
configure command, review the backup and new receipt, then rerun `--dry-run`. To disable
the integration, restore the provider to `manual-v1`; do not leave stale
runtime paths while claiming the provider executed.
