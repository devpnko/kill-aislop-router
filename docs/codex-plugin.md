# Codex Plugin

The KillSlopRouter plugin packages the workflow skill, V1 CLI, and exact
Playwright/axe runtime libraries together.
Install it once into the personal Codex marketplace, then invoke the skill from
any repository. It contains no MCP server, requests no external app access,
and does not bundle or download a browser binary.

## Install

Install from the default branch without a checkout:

```bash
npx --yes github:devpnko/kill-aislop-router plugin install
```

For unattended use, append an exact reviewed commit to the package spec. The
same entrypoint supports a non-mutating preview and a marked-install refresh:

```bash
npx --yes github:devpnko/kill-aislop-router plugin install --dry-run
npx --yes github:devpnko/kill-aislop-router plugin install --force
```

From an existing V1 checkout, the original script remains supported:

```bash
node scripts/install-codex-plugin.mjs --dry-run
node scripts/install-codex-plugin.mjs
```

The installer copies an allowlisted source bundle to
`~/plugins/killsloprouter`, preserves the existing personal marketplace,
creates a backup before changing that marketplace, registers
`killsloprouter@personal`, and activates it with the Codex CLI. It refuses to
replace an existing directory unless that directory contains its installation
marker and `--force` is explicit.

After installation, start a new Codex thread so the skill is discovered.

## Invoke

The shortest request uses implicit skill discovery:

```text
KillSlopRouter로 이 프로젝트의 ./src 전체 여정을 진행해.
```

`전체 여정` means continue from existing repository evidence: resume a matching
run, consume but never invent planning authority, route the anti-slop change and
independent audit, and enter `systemize` only after exact G6T and G7 evidence.
Missing creator integrations, reviews, browser evidence, or owner approval remain
explicitly pending.

Use the namespaced invocation when an explicit skill reference is preferred:

```text
Use $killsloprouter:kill-slop-router to bootstrap this project and run a fail-closed audit of ./src.
```

Or resume an existing state:

```text
Use $killsloprouter:kill-slop-router to resume .killsloprouter/audit-run.json, complete every available gate, and report exact pending actions and receipt hashes.
```

The skill resolves the bundled CLI from its plugin root. It does not substitute
prompt claims for audit results.

## Project bootstrap

When a profile is absent, the skill runs:

```bash
killsloprouter bootstrap \
  --root /absolute/project/path \
  --project-id stable-project-id \
  --locale ko-KR \
  --json
```

Bootstrap writes:

- `.killsloprouter/profile.json`
- `.killsloprouter/host-adapters.json`
- `.killsloprouter/bootstrap-receipt.json`

The generated profile preserves all hard gates, does not claim an approved
design system, and routes providers to explicit manual contracts. The host
manifest contains only `manual-v1` declarations with no permissions. Therefore
the first execution remains `manual_pending` until an operator supplies valid
manual results or replaces declarations with digest-locked adapters.

Bootstrap never overwrites any of these files. Existing projects must be
inspected and migrated deliberately.

When the artifact has a UI and the project exposes a reviewed local URL, use
`browser attest` and `browser configure` to replace only the manual
`browser-evidence` declaration. The skill must not invent or execute a project
server command. See [Playwright browser evidence](playwright-browser.md).

## Why this is not MCP

The plugin solves discovery and repeatable agent behavior. The CLI remains the
local deterministic authority for filesystem snapshots, child-process
execution, and receipts. An MCP server would add a network or daemon trust
boundary without removing the need for project profiles, local artifacts,
browser access, adapter allowlists, or owner approval.

Add MCP only when a centrally operated service must serve multiple machines or
agent products. In that design, expose narrow `doctor`, `plan`, `run`, `resume`,
and `status` tools while retaining the same host manifest and digest checks.

## Update

Refresh from a reviewed checkout:

```bash
node scripts/install-codex-plugin.mjs --force
```

The previous marked plugin copy is moved under
`~/plugins/.killsloprouter-backups/`; it is not deleted. Start a new Codex
thread after the refresh. Projects using the official Playwright provider must
rerun `browser configure` with the refreshed CLI so their host manifest binds
the new adapter and runtime paths and digests.
