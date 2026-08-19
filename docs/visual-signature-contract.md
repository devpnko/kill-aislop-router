# Visual Signature Contract

The surface contract answers **what the artifact is for**. The visual-intent
contract answers **which direction and editorial boundary are approved**. The
visual-signature contract answers **what the approved interface actually looks
and behaves like**. All three are independent, digest-bound boundaries.

KillSlopRouter does not pick `editorial` or any other house style. It carries an
approved signature into creation and independent review. When the repository
does not contain enough authority to identify that signature, visual work stays
blocked instead of receiving guessed colors, spacing, shadows, or typography.

## What is bound

One `visual_signatures` entry is required for every allowed surface when a
visual task runs. An approved entry records:

- primary, accent, background, surface, text, and semantic color references;
- font families, hierarchy, weights, and text treatments;
- information-density mode and observable characteristics;
- radii, geometry, and strokes;
- elevation strategy, shadows, and separation methods;
- imagery strategy and characteristics;
- motion intensity and characteristics;
- project-specific style keywords; and
- transformations that creators and critics must not make.

Color references carry a value, an optional source token, and a usage. A logo
color is not automatically the UI primary. The most frequent color in source or
screenshots is only a discovery candidate. Neither becomes authority unless an
approved project, brand, design-system, reference, or owner source assigns that
role.

## Evidence order

Inspect the closest authoritative sources for the routed surface:

1. approved design tokens, theme configuration, and brand-system mappings;
2. project or design-system contracts that name roles and behavior;
3. approved production artifacts and reference screens for the same surface;
4. explicit owner direction or approval.

Existing CSS variables, Tailwind theme values, font declarations, radii,
shadows, spacing density, imagery, and motion help locate candidate facts. They
do not prove that every common value is intentional. Cross-surface evidence is
not merged automatically: a marketing campaign palette cannot silently replace
an operator product palette in the same repository.

If sources conflict, remain unresolved and request a decision. Do not average
colors, select the most common token, or let a critic's preference become the
new signature.

## Profile example

```json
{
  "visual_signatures": {
    "operator-product-ui": {
      "visual_signature_version": 1,
      "status": "approved",
      "palette": {
        "primary": [
          {
            "value": "#175CD3",
            "token": "--color-brand-600",
            "usage": "primary actions and active selection"
          }
        ],
        "accent": [],
        "background": [{"value": "#F8FAFC", "usage": "application canvas"}],
        "surface": [{"value": "#FFFFFF", "usage": "panels and controls"}],
        "text": [{"value": "#101828", "usage": "primary labels and values"}],
        "semantic": []
      },
      "typography": {
        "families": [{"family": "Inter", "role": "operator labels and data"}],
        "scale": "compact operator hierarchy",
        "weights": ["400", "500", "600"],
        "treatments": ["tabular numerals", "compact labels"]
      },
      "density": {
        "mode": "compact",
        "characteristics": ["same-screen comparison", "short control rows"]
      },
      "shape": {
        "radii": ["4px controls", "8px panels"],
        "geometry": ["restrained rectangles"],
        "strokes": ["1px neutral panel strokes"]
      },
      "elevation": {
        "strategy": "layered",
        "shadows": ["single low-elevation overlay shadow"],
        "separation": ["surface contrast", "panel strokes"]
      },
      "imagery": {
        "strategy": "functional",
        "characteristics": ["status and data imagery only"]
      },
      "motion": {
        "intensity": "restrained",
        "characteristics": ["state confirmation", "focus transitions"]
      },
      "style_keywords": ["operational", "data-dense", "high-clarity"],
      "forbidden_transformations": [
        "replace brand blue with neutral gray or paper beige",
        "replace compact density with spacious consumer cards",
        "remove all depth or shadows globally"
      ],
      "authority_receipt": "planning/visual-signature.json",
      "authority_digest": "sha256:replace-with-exact-digest"
    }
  }
}
```

Bootstrap creates an `unresolved` signature with empty evidence values,
`preserve` sentinels, and explicit no-guess boundaries. It does not prefill a
neutral palette. `doctor` stays non-zero and visual routes remain blocked until
the signature is approved and verified. Copy-only and PR-hygiene routes retain
their non-visual compatibility.

## Authority receipt and coverage

Validate the receipt against
`../schemas/visual-signature-receipt.schema.json`. It repeats the exact
signature and binds evidence for each of these nine aspects:

```text
palette, typography, density, shape, elevation, imagery, motion,
style_keywords, forbidden_transformations
```

Every aspect must appear exactly once in `coverage`, every coverage path must
name declared evidence, and every evidence item must be used. This prevents a
single palette screenshot from being laundered into authority for typography,
motion, and product density.

Allowed authority kinds are `project-contract`, `brand-system`,
`design-system`, `owner-direction`, and `approved-reference`. Evidence may be a
project, brand, or design-system contract, design tokens, owner direction,
approved reference or artifact, or explicit owner approval. The authority kind
must have matching evidence. Owner approval must be an explicit approved
decision with an owner ID.

Generate evidence digests first, then the receipt digest:

```bash
killsloprouter digest --target planning/design-tokens.json
killsloprouter digest --target planning/visual-signature.json
```

See the complete fixture at
`../examples/planning-evidence/visual-signature-approval.json`.

## Style names are descriptors, not presets

`editorial` is only one possible descriptor. Projects may be operational and
data-dense, utilitarian or industrial, warm consumer, brand-expressive,
cinematic or immersive, playful, luxury, technical, campaign-led, or combine
several traits. These names are useful as `style_keywords`, but they never
select a palette or component system by themselves. The concrete signature
fields remain the enforceable contract.

The router checks visual-intent compatibility. For example, editorial imagery
cannot accompany an intent that forbids editorial treatment, and a `flat`
elevation signature cannot satisfy a `layered` depth intent. A conflict causes
an owner replan; the router does not choose one side.

## Dispatch and approval

For visual routes, the exact signature is included in the plan, audit ledger,
approval scope, and every dispatch packet. The independent strength-4
`visual-intent-review` stage must cover palette, typography, density, shape,
elevation, imagery, motion, and forbidden transformations in addition to the
visual-intent contract.

`visual-signature-contract-violation`, `brand-token-substitution`, and
`unapproved-style-normalization` are hard blockers. Scanner zero hits, a craft
score, an agent preference, or a browser screenshot cannot override the
signature. Audit finalization re-hashes the receipt and every evidence source;
any change invalidates the approval scope.
