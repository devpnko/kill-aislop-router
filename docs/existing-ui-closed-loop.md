# Existing UI Anti-Slop Closed Loop

Use this workflow when the request is to inspect an application that already
has a UI, preserve its product identity, remove defects and generic design
tics, and prove the corrected result in the browser.

This is different from greenfield design exploration. Do not produce nine new
directions when the current UI already has approved visual authority. First
observe the current product, then make only the authorized change depth.

## Completion contract

An existing-UI job is not complete after `doctor`, `plan`, a scanner run, or a
set of screenshots. Completion requires two separately digest-bound runs:

```text
pre-change runtime audit
  -> official Playwright over every required scenario and viewport
  -> critic results -> scanner triage -> conflict adjudication -> final receipt
  -> authorized implementation
  -> runtime redesign audit bound to --observation-run
  -> same required scenarios and viewports rerun
  -> fixed evidence, final receipt, and owner approval
```

The pre-change audit may finish with a blocking receipt. That is expected when
it finds real defects or has no approved pixel baseline. It is eligible as an
observation only when execution, result ingestion, scanner triage, conflict
adjudication, and finalization were all reached. A missing/manual browser
packet, an external Playwright script, or a generic `browser-json-v1` child is
not an eligible observation.

## 1. Lock product and visual authority

Read the product, surface, locale, brand, design-token, and approved-reference
contracts. Bind the correct semantic surface and the current visual intent and
signature in `.killsloprouter/profile.json`.

Preserve explicit palette roles, typography, density, geometry, elevation,
imagery, motion, and forbidden transformations. Scanner rules do not own those
choices. An operator product must not become a consumer card UI, and an
existing energetic product must not be flattened into a neutral editorial
house style unless its authority actually requires that change.

## 2. Inventory critical UI states

Write deterministic scenarios in
`.killsloprouter/playwright-scenarios.json`. Include every state needed to
understand or approve the requested work: primary navigation, tabs, drawers,
dialogs, empty/error/loading states, permission states, and the narrowest
supported viewport. Every required scenario needs at least one state assertion.

Then select the reviewed inventory explicitly:

```bash
killsloprouter browser configure \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --base-url http://127.0.0.1:3000 \
  --scenario .killsloprouter/playwright-scenarios.json \
  --required-scenarios account-overview,account-tabs,settings-permissions \
  --channel chrome \
  --json
```

KillSlopRouter requires both non-screenshot proof and a screenshot for every
required scenario × required viewport. Merely declaring many scenarios in the
file is not the same as selecting the critical inventory.

## 3. Attest and observe the current UI

Start the project with its own reviewed operation. KillSlopRouter never infers
or runs a profile command. Serve the generated attestation at
`/.well-known/killsloprouter-artifact.json`, then run:

```bash
killsloprouter browser attest \
  --root "$PWD" \
  --artifact ./src \
  --out .killsloprouter/browser-attestation.json \
  --json

killsloprouter doctor \
  --profile .killsloprouter/profile.json \
  --format json

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

killsloprouter run \
  --root "$PWD" \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task audit \
  --direction none \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --out .killsloprouter/pre-change-ui.json \
  --json
```

Do not edit the product before this run has collected all required reviewer and
browser results and written its final receipt. Resolve `manual_pending`, triage,
and adjudication first. Do not approve a broken pre-change pixel baseline merely
to make the run green.

`doctor` validates project/profile authority only. Its compatibility status
`automation-ready` does not inspect a host manifest and is never completion
evidence. `run --dry-run` is the execution-readiness check. `plan --dry-run` is
rejected because `plan` cannot inspect or execute adapters.

## 4. Classify and implement

Read the bound browser report, traces, screenshots, critic findings, scanner
triage, and adjudication together. Separate:

- observable interaction/layout/accessibility defects;
- generic visual or copy tics;
- intentional project character that must be preserved;
- changes outside the owner-approved depth or authority.

Use the routed creator to implement the bounded fixes. KillSlopRouter routes
and audits this work; it does not turn a critic or scanner into the creator.

Before editing, verify that the post-change route is eligible:

```bash
killsloprouter run \
  --dry-run \
  --root "$PWD" \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task redesign \
  --direction approved \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --creator-id <creator-session-id> \
  --observation-run .killsloprouter/pre-change-ui.json \
  --json
```

The observation binding requires the exact same routed profile digest, artifact
paths, and critical scenario inventory. That profile lock preserves the
project, surface, visual authorities, official Playwright route, scenario-file
digest, viewport dimensions, allowed resource origins, browser channel, and
other verification settings across the before/after pair. It records the
pre-change artifact digests while allowing only the implementation bytes to
change.

## 5. Re-attest and prove the corrected UI

After implementation, regenerate the served-artifact attestation, restart or
refresh the reviewed server as needed, and rerun `browser configure` to lock any
intentional server, scenario, or baseline-directory change. Do not remove a
failing required scenario to make the result pass.

```bash
killsloprouter run \
  --root "$PWD" \
  --profile .killsloprouter/profile.json \
  --host-config .killsloprouter/host-adapters.json \
  --task redesign \
  --direction approved \
  --changes source,copy,style,layout,interaction,state \
  --artifact ./src \
  --scope runtime \
  --creator-id <creator-session-id> \
  --observation-run .killsloprouter/pre-change-ui.json \
  --out .killsloprouter/post-change-ui.json \
  --json
```

The post-change run repeats the official Playwright scenarios and all other
required gates. Review and approve changed pixel baselines only after the
corrected screenshots and reports are acceptable, then retry
`browser-evidence`. Supply the exact owner approval only after the technical
receipt has reached owner review.

The final report should include both state paths and digests, the before/after
artifact digests, required scenario IDs, official Playwright child transport,
final receipt digest, test commands, and any remaining blocker.
