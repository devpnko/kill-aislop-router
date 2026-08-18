# Host Adapter Authoring

Host adapters connect real scanners, agent runners, skill runners, and browser
harnesses to the audit ledger. A project profile can select a provider, but it
cannot supply executable code. The host manifest is a separate operator-owned
file passed explicitly with `--host-config`.

## Adapter types

| Adapter | Purpose | Required permissions |
|---|---|---|
| `kill-ai-slop-v1` | Built-in invocation of the locked read-only scanner protocol | `artifact:read` |
| `agent-json-v1` | Local agent reviewer over JSON stdin/stdout | `artifact:read` |
| `skill-json-v1` | Local skill reviewer over JSON stdin/stdout | `artifact:read` |
| `browser-json-v1` | Browser review with screenshots and test reports | `artifact:read`, `evidence:write`, `browser:control` |
| `manual-v1` | Explicitly leave the provider for manual completion | none |

The `agent-json-v1` and `skill-json-v1` transports are identical. Their
different names preserve provenance and make the host's intended execution
boundary reviewable.

## Manifest contract

Validate host manifests against `schemas/host-adapter.schema.json`. A process
adapter declaration looks like this:

```json
{
  "host_adapter_version": 1,
  "allowed_providers": ["anti-slop"],
  "granted_permissions": ["artifact:read"],
  "providers": {
    "anti-slop": {
      "adapter": "skill-json-v1",
      "entrypoint": "./adapters/anti-slop-review.mjs",
      "entrypoint_digest": "sha256:replace-with-exact-digest",
      "strength": 3,
      "capabilities": [
        "task-fit",
        "state-completeness",
        "responsive-review",
        "accessibility-review",
        "interaction-review"
      ],
      "permissions": ["artifact:read"],
      "timeout_ms": 120000
    }
  }
}
```

Calculate the digest after every entrypoint change:

```bash
killsloprouter digest --target ./adapters/anti-slop-review.mjs
```

The provider ID must appear in `allowed_providers`, its permission scopes must
be a subset of `granted_permissions`, its strength must meet the packet minimum,
and its capabilities must cover every capability assigned to that packet.

`command`, `cmd`, `shell`, `args`, `executable`, and profile entrypoints are not
accepted execution fields. Process adapters always run as:

```text
current-node-executable <digest-verified-entrypoint>
```

The host uses `shell:false` and does not append profile data to the argument
list.

## Request protocol

The adapter reads one JSON object from stdin. The machine-readable contracts
are `schemas/host-adapter-request.schema.json` and
`schemas/host-adapter-response.schema.json`. Important request fields are:

- `host_adapter_request_version`: currently `1`
- `run_id` and `attempt`
- `packet`: provider identity, stage question, capability assignment, visual-intent contract, evidence contract, and artifact digests
- `packets`: the complete dispatch set, useful to form conflict references
- `creator`: creator provider and actor identity
- `scope`
- `artifacts`: exact local snapshots and resolved paths
- `prior_results`: normalized results already accepted into the ledger
- `output_directory`: the only directory from which returned evidence is accepted
- `permission_scopes`
- `settings`: adapter-specific JSON data from the host manifest

The adapter must perform the review described by `packet.stage_question`. It
must not emit `pass` merely because the transport succeeded.

### Visual-intent reviewer

Implement `visual-intent-review` as an independent `agent-json-v1` or explicit
manual provider at strength 4. It must cover:

- `visual-intent-fidelity`
- `editorial-boundary`
- `character-preservation`
- `energy-preservation`
- `depth-preservation`

Read `packet.visual_intent_contract` as authority. Compare the rendered
artifact with its mode, editorial scope, energy, depth, `preserve`, and `avoid`
claims. Report `visual-intent-contract-violation` or
`unapproved-editorial-treatment` as a blocker. Do not choose a quieter style,
turn craft restraint into flatness, or approve merely because the scanner found
nothing. The reviewer actor and provider must remain distinct from the creator.

## Response protocol

Write one JSON response to stdout and diagnostics to stderr:

```json
{
  "host_adapter_response_version": 1,
  "result": {
    "audit_result_version": 1,
    "packet_id": "copy-review--independent-copy-agent--1",
    "provider_id": "independent-copy-agent",
    "reviewer": {"actor_id": "agent:review-session-42", "kind": "agent"},
    "verdict": "pass_with_findings",
    "capabilities_checked": ["copy-specificity", "copy-honesty", "copy-concision"],
    "artifact_digests": {"src": "sha256:replace-with-packet-value"},
    "findings": [],
    "evidence": [],
    "resolutions": [],
    "started_at": "2026-08-18T00:00:00.000Z",
    "finished_at": "2026-08-18T00:01:00.000Z"
  },
  "metadata": {"child_pid": 1234, "transport": "local-agent-runner"}
}
```

The result must copy `packet_id`, `provider_id`, `artifact_digests`, and the
assigned capability set from the request. The audit ledger rejects creator
self-review and incomplete capability reports even if the child exits zero.

## Browser evidence

A browser adapter must create evidence files inside `output_directory` and
return paths relative to that directory. KillSlopRouter resolves and confines
those paths before audit ingestion.

Each required viewport needs a `screenshot`. Every required browser check needs
non-screenshot proof such as a `test-report`. An evidence item must list the
capabilities, viewports, and checks it actually covers. A smoke-test label does
not satisfy keyboard, state, overflow, contrast, zoom, visual regression, or
screen-reader requirements.

### Official Playwright adapter

Prefer the bundled adapter for normal UI audits. Configure it through the CLI;
do not hand-author its entrypoint or runtime paths:

```bash
killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --channel chrome \
  --scenario .killsloprouter/playwright-scenarios.json \
  --baseline-dir .killsloprouter/playwright-baselines \
  --json
```

Configuration binds the bundled entrypoint, the complete `playwright-core` and
`axe-core` runtime directories, the scenario file, and the baseline directory
to SHA-256 digests. Localhost is the default network boundary. External base
URLs or resource origins require both `--allow-external` at configuration time
and `network:external` in the resulting provider permission set.

The adapter connects only to a server the operator already started. It never
accepts a start command, package script, shell, arbitrary executable, or
profile-supplied argument. It also blocks page requests outside the configured
origin set and requires the server to attest the exact audit artifact digest
map before opening a browser. See
[Official Playwright browser evidence](playwright-browser.md) for scenarios,
baseline approval, evidence files, and the screen-reader scope boundary.

## Scanner adapter

`kill-ai-slop-v1` takes `adapter_root` instead of an arbitrary entrypoint. The
host locates one of the documented scanner paths under that root and verifies
its `entrypoint_digest` before invocation. Scanner findings enter the ledger as
`candidate` findings and always stop at the triage gate.
Zero findings mean only that the locked scanner patterns were absent. A scanner
cannot emit or substitute the visual-intent, craft, browser, adjudication, or
owner verdict.

## Manual fallback

Use `manual-v1` when the provider has a valid route contract but no authorized
host integration. It records `manual_pending`; it never creates an audit
result. Complete the generated packet template, then pass the result with
`run --resume STATE --result FILE`. Manual ingestion is recorded separately and
still enforces reviewer identity, capability, digest, and evidence checks. This
is the correct public default for example manifests and partially integrated
projects.
