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
killsloprouter browser configure --base-url http://127.0.0.1:3000 --required-scenarios root --channel chrome
```

For a reproducible CI Chromium build, install it explicitly and select the
`bundled` channel:

```bash
npx playwright-core install chromium
killsloprouter browser configure --base-url http://127.0.0.1:3000 --required-scenarios root --channel bundled
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

The first `browser configure` can create a minimal root scenario when the file
is absent, but configuration also requires an explicit reviewed inventory via
profile `evidence.required_scenarios` or CLI `--required-scenarios`. Edit the
scenario file before configuration for a real existing UI:

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
`value`, `checked`, `url`, `count`, `no-overlap`, `no-clipping`, and
`computed-style`. Locators use Playwright locator syntax. `no-overlap` compares
the visible elements selected by the locator and requires at least two. `no-clipping` checks
selected elements and their descendants for hidden or clamped text overflow
and requires at least one visible match. Use an exact `count` assertion to lock
project-specific copy repetition, such as a time label that should appear only
once. `computed-style` compares one normalized `getComputedStyle()` property on
every visible match. It lets a project lock an approved visual invariant without
adding executable JavaScript to the profile or scenario:

```json
{
  "assertions": [
    {"type": "count", "locator": ".ranking-window-label", "value": 1},
    {"type": "no-overlap", "locator": ".ranking-item > .rank, .ranking-item > .title, .ranking-item > .metric"},
    {"type": "no-clipping", "locator": ".ranking-item .title"},
    {"type": "computed-style", "locator": ".sponsor-slot", "property": "border-top-style", "value": "dashed"},
    {"type": "computed-style", "locator": ".sponsor-slot", "property": "border-top-width", "value": "2px"},
    {"type": "computed-style", "locator": ".sponsor-slot", "property": "background-color", "value": "rgb(255, 255, 255)"}
  ]
}
```

The built-in overflow gate also checks direct children of visible flex and grid
containers for geometric overlap, and headings and interactive controls for
actual text clipping. Intentional truncation must be explicit on the clipping
element or an ancestor:

```html
<span data-killsloprouter-clipping="allow">Intentionally truncated label</span>
```

Intentional layout overlays can use `data-killsloprouter-overlap="allow"` on
their container. These markers are reviewable exceptions, not automatic proof
that the design is acceptable. Standard visually hidden assistive text using a
one-pixel `clip` or `clip-path` pattern is excluded from visible clipping
findings; it remains covered by the ARIA and axe evidence.
The complete shape is in `schemas/playwright-scenarios.schema.json`.

Keyboard evidence follows sequential focus semantics: controls with
`tabindex="-1"`, descendants of closed `details`, and descendants of hidden or
inert ancestors are excluded. The walker continues through browser-internal
date/time focus stops until every declared sequential target is reached or the
configured safety cap is exhausted.

Every required scenario needs at least one explicit state assertion. The
generated root scenario starts with a minimal visible-body assertion; that is a
bootstrap aid, not evidence that account tabs, dialogs, permission states, or
other critical paths were inventoried. Replace or extend it with the project's
real critical states.

Select the reviewed IDs in the profile or during configuration:

```bash
killsloprouter browser configure \
  --base-url http://127.0.0.1:3000 \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios account-overview,account-tabs,settings-permissions \
  --channel chrome
```

The selected IDs are stored in the profile and setup receipt. Configuration
also stores the scenario digest and a browser verification digest covering the
scenario bytes, viewport dimensions, allowed origins, browser channel, locale,
runtime, color schemes, and interaction limits. A scoped UI plan blocks when
the inventory is empty, and an official route remains `manual_pending` when its
host does not match that profile-bound verification contract. The audit ledger
requires non-screenshot proof plus a screenshot for every required scenario ×
required viewport, so a single root capture cannot silently stand in for
untested interaction states.

The scenario file is digest-locked. Reconfigure after an intentional scenario
change; an unacknowledged change blocks host-manifest loading.
Start from the [scenario example](../examples/playwright-scenarios.example.json)
when a product needs layout, repetition, or visual-property invariants in
addition to interaction states.

## 3. Configure the official provider

```bash
killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --channel chrome \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios account-overview,account-tabs,settings-permissions \
  --baseline-dir .killsloprouter/playwright-baselines \
  --json
```

This command backs up both configuration files and replaces only the
`browser-evidence` provider with the bundled adapter. It binds these inputs:

- adapter entrypoint digest;
- complete `playwright-core` and `axe-core` package-directory digest;
- scenario file digest;
- reviewed required-scenario inventory;
- visual-baseline directory digest;
- base URL, allowed origins, browser channel, locale, viewport dimensions,
  color schemes, and timeouts;
- a profile-bound verification-contract digest for the stable before/after
  subset (runtime, scenario, allowed origins, channel, locale, viewports,
  schemes, and limits);
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
  --task audit \
  --direction none \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --json
```

The artifact's surface comes from the profile binding. Add `--surface` only as
an assertion when a script wants to fail on an unexpected contract value.

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
- document overflow, flex/grid child overlap, and required-text clipping inspection;
- a half-width 200% zoom/reflow proxy;
- console errors, page errors, failed responses, and blocked requests;
- browser engine, channel, version, origin policy, and served-artifact attestation.

The consolidated `browser-report.json` is the non-screenshot proof covering the
packet's required checks and scenarios. The audit ledger still verifies its
artifact digest, evidence location, capability set, viewports, checks, and the
scenario × viewport screenshot matrix.

A `manual-v1` browser provider remains a reviewer attestation: KillSlopRouter
does not claim that it executed or semantically interpreted that project's
custom report. Use the official digest-locked adapter and scenario assertions
when overlap, clipping, repetition, or computed styles must be machine-enforced
through the child-process boundary.

For the existing-UI closed loop, a manual or custom browser adapter cannot act
as the pre-change `--observation-run` even if it emits schema-valid screenshots.
That authority requires the bundled official Playwright child transport. See
[Existing UI anti-slop closed loop](existing-ui-closed-loop.md).

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
