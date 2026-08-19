# Visual Intent Contract

The surface contract answers **what kind of product artifact this is**. The
visual-intent contract answers **which approved direction and editorial
boundary apply**. The separate [visual-signature contract](visual-signature-contract.md)
binds the actual palette, typography, density, shape, elevation, imagery, and
motion. These are separate security boundaries.

`marketing-editorial` is a semantic surface for public acquisition or content.
It does not authorize a paper canvas, editorial typography, muted neutrals,
flatness, or any other visual treatment. Likewise, `operator-product-ui` does
not require a gray dashboard. A creator or critic must not turn an anti-slop
heuristic into a style preset.

## Fail-closed profile contract

Add one contract for every surface in `surface_contract.allowed`:

```json
{
  "visual_intents": {
    "operator-product-ui": {
      "visual_intent_version": 1,
      "status": "approved",
      "mode": "product-native",
      "editorial_treatment": "forbidden",
      "editorial_scope": [],
      "energy": "balanced",
      "depth": "layered",
      "preserve": [
        "operator task density",
        "action hierarchy",
        "existing brand contrast"
      ],
      "avoid": [
        "paper-like neutralization",
        "universal flatness",
        "consumer-service restyling"
      ],
      "authority_receipt": "planning/visual-intent.json",
      "authority_digest": "sha256:replace-with-exact-digest"
    }
  }
}
```

Bootstrap writes an `unresolved` contract that preserves the existing product
character and forbids editorial treatment. `doctor` exits non-zero and visual
tasks remain blocked until an approved authority receipt replaces it. Copy-only
and PR-hygiene routes keep their existing compatibility boundary.

Modes describe provenance and intent, not a component library:

- `product-native`: optimize for the product's tasks and existing character.
- `brand-expressive`: make approved brand expression prominent.
- `editorial`: use an editorial visual treatment across its declared scope.
- `campaign`: follow an approved campaign direction.
- `reference-led`: follow exact approved references without copying unrelated style.

`editorial_treatment` is enforced separately:

- `forbidden`: no editorial or paper-neutral default; `editorial_scope` is empty.
- `bounded`: editorial treatment is allowed only in each named scope.
- `required`: the mode must be `editorial`; omission is a contract failure.

An approved contract must state non-empty `preserve` and `avoid` lists. These
are project evidence, not KillSlopRouter defaults. Energy and depth may be
`quiet`, `balanced`, or `high`, and `flat`, `layered`, or `immersive`.

## Authority receipt

Validate the receipt against
`../schemas/visual-intent-receipt.schema.json`. It repeats the exact intent,
names the authority, and binds at least one source file:

```json
{
  "visual_intent_receipt_version": 1,
  "project_id": "my-erp",
  "surface": "operator-product-ui",
  "status": "approved",
  "intent": {
    "mode": "product-native",
    "editorial_treatment": "forbidden",
    "editorial_scope": [],
    "energy": "balanced",
    "depth": "layered",
    "preserve": ["task density", "brand contrast", "visual energy"],
    "avoid": ["paper-like neutralization", "universal flatness"]
  },
  "authority": {
    "kind": "project-contract",
    "authority_id": "product-contract-v3",
    "basis": "The approved product contract defines this visual direction.",
    "decided_at": "2026-08-19T00:00:00.000Z"
  },
  "evidence": [
    {
      "kind": "project-contract",
      "path": "product-contract.md",
      "digest": "sha256:replace-with-exact-digest"
    }
  ]
}
```

Allowed authority kinds are `project-contract`, `brand-system`,
`owner-direction`, and `approved-reference`. The receipt may bind project or
brand contracts, owner direction, approved references or artifacts, and owner
approval.

The evidence must match the authority kind: project and brand authorities need
their corresponding contract, owner direction needs owner-direction or explicit
approved owner evidence, and an approved reference needs the reference or its
approved artifact. Owner-approval JSON must contain `status: approved` and an
owner ID.

Generate every digest after the referenced file is final:

```bash
killsloprouter digest --target planning/product-contract.md
killsloprouter digest --target planning/visual-intent.json
```

The planner verifies the profile-to-receipt digest, exact intent equality,
project and surface identity, authority metadata, and every evidence digest.
Audit initialization snapshots the same chain. Finalization fails if the
receipt or any evidence changes afterward.

## Routing behavior

For `build`, `redesign`, `systemize`, `runtime-handoff`, and `audit`:

1. Resolve the artifact surface.
2. Verify the surface's visual-intent authority chain.
3. Verify the surface's visual-signature authority and compatibility.
4. Put both exact contracts in the plan and every dispatch packet.
5. Require an independent `visual-intent-review` provider at strength 4 with
   the complete intent and signature capability union.
6. Treat `visual-intent-contract-violation` and
   `unapproved-editorial-treatment` as hard blockers.

The creator receives the contract as direction. Anti-slop tools remain
post-creation critics. A scanner result with zero hits means only that its
configured source patterns were absent; it is never visual approval and cannot
replace the visual-intent reviewer, browser evidence, adjudication, or owner
approval.

When evidence is ambiguous, keep the contract unresolved and request a real
project or owner decision. Do not infer editorial treatment from the word
"editorial", from an anti-slop score, or from a critic's preference.
Do not infer palette roles or a complete style from color frequency; bind those
facts through the visual-signature contract.
