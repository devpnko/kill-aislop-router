# Service Planning Bridge

KillSlopRouter can consume a receipt from an external service-planning process.
It does not own, rewrite, or replace that process.

## Responsibility Boundary

The planning authority owns discovery, evidence, interviews, PRD, UAC, IA,
data authority, mockup scope, and owner decisions. KillSlopRouter owns the late
design-quality and implementation bridge:

Planning, product, brand, reference, or owner evidence must also establish the
visual-intent receipt consumed by KillSlopRouter. The router does not invent
that direction from anti-slop rules. Surface classification and visual style
remain separate, so a planning receipt for `marketing-editorial` alone does not
authorize editorial treatment.

| Planning gate | Planning meaning | KillSlopRouter action |
|---|---|---|
| G6 | Versioned all-scope mockup exists | Allow a mockup audit |
| G6T | Task, accessibility, and gap tests passed | Accept the quality evidence needed for systemization |
| G7 | Owner approved an exact artifact version | Allow `systemize` |
| G8 | Final implementation contracts are fixed | Allow `runtime-handoff` |
| G9A | Runtime implementation exists | Allow a runtime audit |

An anti-slop pass is not G7 approval. A design-system extraction is not G8
unless its final data, API, event, migration, and implementation contracts are
also approved by the planning authority.

## Profile Link

Configure one default receipt or one receipt per surface:

```json
{
  "planning": {
    "required": true,
    "surface_receipts": {
      "operator-product-ui": "planning/operator-gates.json",
      "consumer-product-ui": "planning/consumer-gates.json"
    }
  }
}
```

Relative paths resolve from `.killsloprouter/profile.json`. The receipt must
match `schemas/service-planning-gate.schema.json`. Every gate used as a release
condition needs evidence paths and SHA-256 digests. The router checks both the
receipt digest and the evidence files, so editing a previously approved mockup
or approval record forces a new route plan.

An `approved` `design_system` profile entry likewise needs an
`authority_receipt` and `authority_digest`. The router verifies that authority
before allowing `project-design-system` to create an artifact.

An approved `visual_intents` entry needs its own authority receipt and digest.
That receipt repeats the exact intent and binds the underlying planning,
project, brand, reference, artifact, or owner evidence. See
[Visual intent contract](visual-intent-contract.md).

If `planning.required` is `false`, findings are reported as warnings for normal
tasks. `systemize` always requires G6T and exact G7 evidence, regardless of that
setting.

## Commands

Audit a complete mockup after G6:

```bash
killsloprouter plan \
  --surface operator-product-ui \
  --task audit \
  --scope mockup \
  --profile .killsloprouter/profile.json \
  --out .killsloprouter/mockup-plan.json
```

Extract a design system after G6T and G7:

```bash
killsloprouter plan \
  --surface operator-product-ui \
  --task systemize \
  --direction approved \
  --changes source,style,layout,interaction,state \
  --profile .killsloprouter/profile.json \
  --out .killsloprouter/systemize-plan.json
```

The `systemize` route requires a configured `project-systemizer` creator and an
independent `design-system-contract-review` adapter. Its output remains a
candidate until its own audit and owner approval are complete.
