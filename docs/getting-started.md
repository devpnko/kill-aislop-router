# Start a KillSlopRouter journey

KillSlopRouter is the parent workflow. Its CLI records the route, authorized child execution, evidence, and receipts; the Codex plugin makes that workflow easy to invoke in each project. `anti-slop` is an internal critic, not an alternative name for the journey. The plugin is local; it is not an MCP server.

## Install once

Use a reviewed, exact 40-character commit from this repository. Replace the
placeholder before running these commands; do not use an unreviewed moving
branch for unattended installation.

```bash
KSR_REVIEWED_COMMIT=REPLACE_WITH_REVIEWED_40_CHARACTER_COMMIT
npx --yes "github:devpnko/kill-aislop-router#${KSR_REVIEWED_COMMIT}" plugin install --dry-run
npx --yes "github:devpnko/kill-aislop-router#${KSR_REVIEWED_COMMIT}" plugin install
```

If the preview reports `identity_conflict` for the old local `kill-slop-router` skill, inspect it and use the explicit, backup-producing `--migrate-legacy-entry` option only for the verified entry. A verified existing plugin refresh requires `--force`; changed or unverified payloads are not silently replaced. See [installation and migration](codex-plugin.md#install). Start a new Codex thread after installation so it discovers the current plugin.

## Start in a project

Open the target repository in Codex and say:

```text
Use $killsloprouter:kill-slop-router to inspect this project's current UI, preserve its approved product and visual character, and continue the safest eligible journey. Report the current gate and exact next action.
```

For a project without an existing UI, say `plan the new UI` instead of `inspect this project's current UI`. If your request concerns only one artifact, name its path. A later `KillSlopRouter로 이어서 진행해` should continue the same eligible journey, not start a separate `antislop` workflow. State resume still requires the original caller-held authority digest; a missing digest is a stop, not permission to derive a replacement from mutable state.

The first pass reads the project contract and existing evidence. It may bootstrap a manual-only `.killsloprouter/` configuration when the product surface is unambiguous. This is **not** an instant approval: visual intent and exact visual signature need real authority; reviewers and browser providers need authorized, digest-locked adapters. An existing UI redesign needs a finalized official Playwright pre-change observation before editing. KSR does not invent an Owner decision, execute arbitrary project commands, or treat scanner zero hits as design approval.

## Read the result

Ask KSR to report four things after each pass: **current stage and status**, **what actually ran versus `manual_pending`**, **the exact next action or Owner choice**, and **state/receipt hashes**. Typical stops are:

| Status | What to do |
| --- | --- |
| `configuration_required` | Bind the missing project surface, visual authority, or signature from real evidence; rerun `doctor`. |
| `manual_pending` | Provide the named authorized adapter or a genuinely independent manual result. A routable packet was not executed. |
| Browser evidence missing | Review the local URL, artifact attestation, scenarios, and browser adapter; do not claim a screenshot-only review as official evidence. |
| Owner approval pending | Inspect exact candidates, evidence, and scope; only the Owner can supply the decision. |
| Active state lease | Do not start another run. Inspect `lease status`; recover a stale lease only with the exact recovery authority. |

The plugin should state these in plain language alongside the exact files or commands for the current project. It should not bury the next step in a full receipt dump.

For the first project, use the [setup and continuation checklist](project-setup.md).
`doctor` now returns ordered `next_actions` with required inputs and references;
text run output distinguishes actual attempts from pending work and shows how
to resume after the stop is resolved. The hints do not replace evidence or
grant execution permission.

## Direct CLI / troubleshooting

Running the bundled CLI with no arguments or `--help` prints the short start path and full command reference. For a configured project:

```bash
killsloprouter doctor --profile .killsloprouter/profile.json --format json
killsloprouter run --task audit --artifact ./src --scope runtime --out .killsloprouter/ui-audit.json --dry-run --json
```

These are checks, not evidence that an adapter ran. `doctor` may exit non-zero while project authority is unresolved. The direct `run` form requires the project's actual task, artifact, surface binding, scope, host configuration, and any required planning evidence; do not copy the example unchanged into a different project. For the complete integrated commands and resume rules, see [automation run](automation-run.md). For existing UIs and official browser setup, see [closed-loop UI review](existing-ui-closed-loop.md) and [Playwright evidence](playwright-browser.md).

When invoked outside the target project, use `--root /absolute/project`.
Explicit `--root` discovers only that root's `.killsloprouter/profile.json`,
not the caller's or an ancestor's profile. Pass `--profile` explicitly for an
intentionally separate configuration.
