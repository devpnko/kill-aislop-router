# One KSR version across Codex accounts

`killsloprouter plugin sync` provides the setting **Use the same KSR version in enrolled accounts**. It manages the KSR plugin only. Codex homes, login credentials, model preferences, conversations, and project audit files stay where they are.

| Setting | Behavior |
| --- | --- |
| ON — `shared` | Apply one verified canonical plugin version to every enrolled account, including on subsequent KSR installations. Verify each installed cache against the source payload/runtime digests. |
| OFF — `per-account` | Stop KSR's automatic fan-out and leave activation to each Codex account. This is the default for existing installations. |

Turning OFF does not downgrade or uninstall anything. Codex itself may refresh a local plugin cache when it lists or loads plugins; OFF cannot freeze a version against that behavior. Existing shared plugin-directory links also remain shared. Independent historical version pinning would require separately managed plugin sources and authority. Existing KSR integrity gates may still block a stale version, and continuing an audit follows the existing resume and digest rules.

## Toggle and apply

Install the reviewed KSR build normally, then preview account discovery:

```bash
killsloprouter plugin sync --mode shared --discover-accounts --dry-run --json
```

Discovery lists the default `~/.codex` and existing direct account homes under `~/.codex-accounts`. Preview and status read local files only and never invoke Codex, since even `plugin list` can refresh caches. They report `cached`/`cache_missing`, not verified activation. Review the list, then turn ON and synchronize:

```bash
killsloprouter plugin sync --mode shared --discover-accounts --apply --json
```

Or enroll exact homes with repeated `--account-home /absolute/account/directory` instead of `--discover-accounts`. New account directories are not silently enrolled after this step. Use discovery again when adding accounts.

Turn OFF without changing installed versions:

```bash
killsloprouter plugin sync --mode per-account --json
```

Check status and retry an interrupted/partial update:

```bash
killsloprouter plugin sync --json
killsloprouter plugin sync --apply --json
```

The setting is saved in `~/.killsloprouter/plugin-sync.json`. Policy changes preserve the prior file as a backup. `--home DIR` supports an explicit user-home root; account homes must be existing, non-overlapping directories below that root. Account-home symlinks and executable fields in settings are rejected. A pre-existing `plugins` symlink is accepted only if it belongs to the current user and points directly to another enrolled account's real plugin directory. The link is checked before and after Codex calls and reported as `cache_shared_with`; KSR never creates or rewires it.

## What gets verified

An explicit apply uses only `codex plugin list --marketplace NAME --json` and `codex plugin add killsloprouter@NAME --json`, with the enrolled home as the child process's `CODEX_HOME`. Both calls may update Codex's local plugin state. KSR never copies authentication files or starts a reviewer/browser run. The selected local marketplace must point to the verified canonical `~/plugins/killsloprouter` bundle. It does not fetch a moving GitHub branch.

Matching accounts are skipped. Disabled plugins remain disabled and appear as `disabled`; the sync is not reported complete. A failed account, conflicting source, modified cache, or changing canonical payload prevents a success report. An apply attempt records per-account results and hashes under `~/.killsloprouter/plugin-sync-receipts/`; a partial attempt can be retried after resolving its cause. Account updates are sequential, not one atomic transaction across Codex homes. Earlier successful updates remain in place if a later account fails.

Mutating sync/configuration commands use an exclusive lock. If a process crashes with the lock present, inspect `~/.killsloprouter/plugin-sync.lock` and confirm that the previous operation ended before explicitly moving that exact file to a backup path. The command never treats a PID alone as stale-lock authority or automatically deletes an existing lock.

The normal `plugin install`/installer script honors `shared` after copying and verifying the new build. Its `--dry-run` reports enrolled targets, and `--no-activate` skips activation for all accounts. Without a shared setting it retains its existing current-account behavior. Refresh the plugin cachebuster when distributing changed bytes so Codex can create a new versioned cache. After sync, start a new Codex thread to load the updated skill. Existing project adapter locks may require an explicit reconfiguration for a new runtime; receipts are never rewritten to hide a mismatch.

## Settings UI integration

A settings UI can call the command with `--json`, or import `pluginAccountSync` from `killsloprouter/plugin-sync`. Map its toggle to `mode: "shared"` or `mode: "per-account"`. Show the enrolled accounts before `apply: true`; display each account's returned status and version. `dryRun: true` previews an edit, and `mode` without `apply` saves the preference without activation. A cached version is not proof of enablement: only apply verifies Codex's installed/enabled metadata, so a matching read-only cache inventory returns `verification_required` in shared mode.

This package provides the setting and CLI/API, not an Account Palette GUI patch. A UI must keep “preference saved” (`policy_saved`) separate from “all accounts synchronized” (`status: "synced"`). JSON output includes discovered homes so newly added accounts can be offered for enrollment. The policy schema is [plugin-sync-policy.schema.json](../schemas/plugin-sync-policy.schema.json).

Exit code `0` means synchronized or per-account mode without verification errors; `5` means an unresolved shared sync or integrity/installation failure. Invalid options, account paths, or policy files produce a nonzero error before account installation. Project `doctor` readiness and Owner approval are separate from plugin synchronization.
