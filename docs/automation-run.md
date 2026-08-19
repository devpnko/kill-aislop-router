# Automation Lifecycle

`killsloprouter run` is a resumable coordinator over the existing planner and
audit ledger. It does not replace either receipt contract.

Run `doctor` first. It validates the surface contract against the real project
and binding directories and verifies each visual-intent and visual-signature
authority chain. A fresh bootstrap intentionally reports
`configuration_required` until both are approved and digest-bound; the plan
phase then resolves the exact artifacts.

## State files

`--out PATH` creates one automation state file and a sibling directory. The
state file contains the request, current status, adapter attempts, phase
receipt references, blockers, pending manual work, and a canonical state
digest. The sibling directory contains:

- `plan.json`
- `audit-run.json`
- immutable dispatch packets
- one result file per adapter attempt
- adapter-produced evidence under a packet and attempt directory
- nine phase receipts
- `audit-receipt.json` after finalization is attempted

If a reviewed artifact is a directory, place the state outside that directory
or below its `.killsloprouter/` directory. KillSlopRouter rejects other nested
state locations because writing results there would change the artifact being
reviewed.

Each phase receipt has its own canonical receipt digest. The state stores both
that digest and the SHA-256 digest of the receipt file. See
`schemas/automation-run.schema.json` and
`schemas/automation-step-receipt.schema.json`.

## Phase behavior

1. **Plan**: resolve every artifact through the profile's surface contract,
   verify the separate visual-intent and visual-signature receipts and evidence, and only then
   select a creator. Stop if any authority, route, capability, strength, or
   independence requirement is unresolved.
2. **Planning verification**: verify the external planning receipt and required evidence when the route enforces it.
3. **Audit init**: snapshot the exact plan, both visual authority chains, and artifacts, bind the creator identity, and calculate the owner approval scope.
4. **Dispatch**: write one immutable packet per selected provider. Every packet carries the exact visual-intent and visual-signature contracts.
5. **Execution**: inspect the host allowlist and execute only a compatible adapter. Missing or manual adapters stay pending.
6. **Result ingest**: apply existing provider, identity, capability, artifact digest, evidence, and timestamp validation.
7. **Scanner triage**: stop until every scanner candidate has a non-open decision and rationale.
8. **Conflict adjudication**: run adjudication after other critics and block unresolved finding pairs.
9. **Finalize**: re-hash the audit boundary and require the exact owner decision where the route has an approval stage.

Adjudication deliberately runs after scanner triage. This keeps an unclassified
source pattern from being silently absorbed into a later aesthetic decision.
A zero-hit scanner result is still only discovery output. It cannot satisfy the
independent visual-intent/signature review or any later visual, browser, or owner gate.

## Resume and retry

`--resume STATE` verifies the automation digest, the routed profile digest,
every phase receipt, and every tracked plan, audit, packet, and final receipt
path before continuing. Changing a surface contract after planning starts is a
new route, not a resume; the old state blocks.

Changing either visual authority receipt or any bound evidence is also a new route.
The old run blocks at audit initialization or finalization rather than silently
accepting a new aesthetic direction.

A missing or manual adapter is retried automatically if a newly supplied host
manifest makes it ready. A child execution error needs explicit authorization:

```bash
killsloprouter run --resume run.json --host-config host.json --retry anti-slop
```

To complete an explicitly manual packet, use the packet's result template and
ingest the completed file on resume:

```bash
killsloprouter run --resume run.json --host-config host.json --result manual-result.json
```

Manual ingestion is recorded as `manual_recorded`, not `ran`, and applies the
same audit validation as a child result. `--result` may be repeated.

Selectors may name a packet ID, provider ID, or stage ID. `--retry all` retries
failed or pending packets, but does not replace already recorded successful
results. Naming an already successful provider or stage explicitly replaces
that result and invalidates its prior scanner triage decisions.

The official Playwright adapter uses the same mechanism for baseline approval.
An absent baseline or any pixel difference remaining after Playwright's
antialias-aware comparison returns an ingested `block` result and, for a
changed image, a diff PNG. Review the candidate screenshots, place only
approved files in the configured baseline directory, and rerun
`browser configure` so the host manifest binds the new directory digest. Then
replace the blocked result:

```bash
killsloprouter run \
  --resume .killsloprouter/v1-run.json \
  --host-config .killsloprouter/host-adapters.json \
  --retry browser-evidence \
  --json
```

Do not change an audited artifact while doing this. An artifact change is a new
audit scope, not a browser retry. See
[Playwright browser evidence](playwright-browser.md).

## Status and exit behavior

`complete` means the audit receipt is `approved` or the route did not require an
owner and reached `critic_pass`. `manual_pending` means a precise external
action is required. `blocked` means a hard gate, integrity check, adapter
execution, rejection, or conflict prevents approval.

Integrated dry-run keeps the JSON status `dry_run` for receipt compatibility,
but returns `6` when `pending` contains a non-executable adapter, `0` when every
planned adapter is ready, and `5` when planning or verification is blocked.

The integrated command never treats `routable`, process exit zero, or a child
JSON response by itself as a completed review. The result becomes `ran` only
after audit ingestion accepts the provider identity, capabilities, artifact
digests, findings, and required evidence.
