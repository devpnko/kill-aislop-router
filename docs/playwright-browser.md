# Official Playwright Browser Evidence

KillSlopRouter's official browser adapter drives a real Chromium browser through
Playwright across the same JSON child-process boundary as other host adapters.
It is the preferred browser provider for UI artifacts. Generic
`browser-json-v1` adapters remain supported.

The adapter does not start the application, run a package script, discover a
shell command, or accept executable fields from a project profile. Start the
project with its own reviewed operational procedure, then give KillSlopRouter
the resulting URL.

## Browser installation

The npm package and Codex plugin contain exact `playwright-core` and `axe-core`
versions. They do not contain a browser binary. Local runs default to the
installed Google Chrome channel:

```bash
killsloprouter browser configure --base-url http://127.0.0.1:3000 --channel chrome
```

For a reproducible CI Chromium build, install it explicitly and select the
`bundled` channel:

```bash
npx playwright-core install chromium
killsloprouter browser configure --base-url http://127.0.0.1:3000 --channel bundled
```

Supported channel values are `chrome`, `msedge`, `chromium`, and `bundled`.

## 1. Bind the served application to the audit artifact

Generate the exact digest map before starting the audit. Use the same root and
artifact list that the later `run` command will use:

```bash
killsloprouter browser attest \
  --root "$PWD" \
  --artifact ./src \
  --out .killsloprouter/browser-attestation.json \
  --json
```

Make the already-running application return that file as JSON at:

```text
/.well-known/killsloprouter-artifact.json
```

The response contract is `schemas/browser-attestation.schema.json`:

```json
{
  "killsloprouter_browser_attestation_version": 1,
  "artifact_digests": {
    "src": "sha256:replace-with-generated-value"
  }
}
```

The adapter verifies exact keys and digest values before launching a browser.
A missing, redirected, malformed, stale, or different response blocks
execution. Do not regenerate this file to conceal an artifact change after a
run starts; changed artifact bytes require a new audit scope.

For a directory artifact, the CLI permits the generated file inside that
artifact only below its ignored `.killsloprouter/` directory. This prevents the
attestation action from changing the digest it just recorded.

## 2. Define deterministic scenarios

The first `browser configure` creates
`.killsloprouter/playwright-scenarios.json` when it is absent. Edit it before
configuration if the project needs stateful coverage:

```json
{
  "playwright_scenario_version": 1,
  "scenarios": [
    {
      "id": "settings-save",
      "path": "/settings",
      "actions": [
        {"type": "fill", "locator": "#display-name", "value": "Ada"},
        {"type": "click", "locator": "#save"}
      ],
      "assertions": [
        {"type": "visible", "locator": "[role=status]"},
        {"type": "text", "locator": "[role=status]", "value": "Saved"}
      ]
    }
  ]
}
```

Supported actions are `click`, `fill`, `press`, `check`, `uncheck`, `select`,
`hover`, and `wait-for`. Supported assertions are `visible`, `hidden`, `text`,
`value`, `checked`, `url`, and `count`. Locators use Playwright locator syntax.
The complete shape is in `schemas/playwright-scenarios.schema.json`.
Because the default browser contract requires state evidence, configuration
also requires at least one explicit assertion. The generated root scenario
starts with a minimal visible-body assertion; replace or extend it with the
project's real critical states.

The scenario file is digest-locked. Reconfigure after an intentional scenario
change; an unacknowledged change blocks host-manifest loading.

## 3. Configure the official provider

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

This command backs up both configuration files and replaces only the
`browser-evidence` provider with the bundled adapter. It binds these inputs:

- adapter entrypoint digest;
- complete `playwright-core` and `axe-core` package-directory digest;
- scenario file digest;
- visual-baseline directory digest;
- base URL, allowed origins, browser channel, locale, viewport dimensions,
  color schemes, and timeouts;
- the minimum browser permission set.

Rerun configuration after an intentional plugin/package update. An older host
manifest remains fail-closed because its adapter path or runtime digest no
longer matches the CLI version performing validation.

Loopback URLs are accepted by default. An external URL or resource origin
requires `--allow-external`; the provider then records `network:external`.
Page requests outside the configured origins are aborted and reported.

## 4. Doctor, dry-run, and execute

Run the normal preflight before execution:

```bash
killsloprouter doctor --profile .killsloprouter/profile.json --format json

killsloprouter run \
  --dry-run \
  --root "$PWD" \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --surface consumer-product-ui \
  --task audit \
  --direction none \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --json
```

Then start the resumable `run` with the same root, artifacts, and route input.
The adapter records a distinct child PID; a routable or ready declaration is
not reported as execution.

## 5. Approve the first visual baseline

The first run produces candidate screenshots and returns a blocking
`visual-regression` finding because no approved pixels exist yet. This is
intentional.

1. Inspect every candidate at mobile, tablet, and desktop sizes.
2. Confirm the state, copy, accessibility, overflow, and interaction evidence.
3. Copy only approved candidate PNGs into the configured baseline directory,
   preserving each filename.
4. Rerun `browser configure` to bind the new baseline-directory digest.
5. Resume and explicitly replace the browser result:

   ```bash
   killsloprouter run \
     --resume .killsloprouter/v1-run.json \
     --host-config .killsloprouter/host-adapters.json \
     --retry browser-evidence \
     --json
   ```

A missing screenshot blocks. A byte-different PNG is evaluated by Playwright's
pixelmatch comparator with its standard `0.2` color threshold and zero allowed
non-antialiased pixel differences. Any remaining changed pixel blocks and emits
a `.diff.png` artifact. Baselines are never updated automatically.

## Evidence produced

For every scenario, required viewport, and configured color scheme, the adapter
records:

- full-page screenshot and zero-tolerance, antialias-aware Playwright baseline
  comparison;
- visual diff PNG when the approved rendering materially changes;
- Playwright trace;
- scenario action and assertion outcomes;
- ARIA snapshot;
- axe WCAG violations and incomplete checks;
- keyboard focus traversal;
- document and element overflow inspection;
- a half-width 200% zoom/reflow proxy;
- console errors, page errors, failed responses, and blocked requests;
- browser engine, channel, version, origin policy, and served-artifact attestation.

The consolidated `browser-report.json` is the non-screenshot proof covering the
packet's required checks. The audit ledger still verifies its artifact digest,
evidence location, capability set, viewports, and check coverage.

## Screen-reader scope

ARIA snapshots and axe are valuable automated semantic checks, but they are not
a real assistive-technology session. Every report records
`automated-aria-and-axe-semantic-proxy-not-real-assistive-technology` and adds
an informational finding. When the project contract or risk requires VoiceOver,
NVDA, JAWS, TalkBack, or another actual screen reader, obtain an independent
manual result and keep approval pending until that evidence is accepted.

Playwright reference material:

- [Browsers and channels](https://playwright.dev/docs/browsers)
- [Trace Viewer](https://playwright.dev/docs/trace-viewer)
- [Accessibility testing](https://playwright.dev/docs/accessibility-testing)
- [ARIA snapshots](https://playwright.dev/docs/aria-snapshots)
