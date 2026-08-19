# Capability Matrix

This matrix describes the reviewed upstream versions in `../registry/tool-lock.json`.
Re-check upstream scope when a locked commit changes.

Legend: `P` primary, `S` secondary, `A` executable automation, `C` conditional,
`X` unsuitable, `-` no meaningful coverage.

| Capability | Taste | Hallmark | anti-slop | kill-ai-slop | no-ai-slop | stop-slop | PeakOSS |
|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Brief and audience inference | P | P | S | - | S | - | - |
| Visual direction | P | P | S filter | - | - | - | - |
| Marketing page creation | P | P | S filter | - | - | - | - |
| Reference study and system lock | S | P | - | - | - | - | - |
| Dense app or dashboard workflow | X | S subset | P filter | S signals | - | - | - |
| Static source-pattern scan | - | - | - | A/P | - | - | - |
| Visual anti-pattern audit | S | P | P | A/S | - | - | - |
| Component necessity and hierarchy | P | P | P | S signals | - | - | - |
| Responsive and mobile layout | C | P | P | S signals | - | - | - |
| Accessibility and contrast | S | P | P/A | - | - | - | - |
| Interaction and state completeness | P in scope | P | P | S signals | - | - | - |
| Short visible copy | S | S | S | S English scan | P | S | - |
| Long-form prose | S | S | S | S English scan | P | P | - |
| PR contribution hygiene | - | - | - | - | - | - | A/P |
| Browser interaction proof | - | - | - | - | - | - | - |

Project-local authority and evidence providers are outside the upstream table:

| Provider | Minimum strength | Required capabilities |
|---|:---:|---|
| `visual-intent-review` | 4 | visual-intent fidelity; editorial, character, energy, and depth preservation; palette, typography, density, shape, elevation, imagery, motion fidelity; transformation boundary |
| `project-contract` | 4 | task contract, object model, and state authority |
| `domain-authority-review` | 4 | domain authority and conflict adjudication |
| `browser-evidence` | 3 | responsive, keyboard, state, overflow, contrast, and zoom evidence |
| design direction creator | 3 | project-specific direction generation, baseline preservation, self-contained responsive/locale prototype, font availability and license report |
| design direction critic | 4 | product fit, distinctiveness, baseline preservation, responsive review |
| color-system creator | 3 | role-based color system, semantic separation, contrast-aware palette, self-contained prototype, exact implementation tokens |
| color-system critic | 4 | harmony, semantic roles, contrast, brand and project fit |

The visual-intent reviewer is independent from the creator. It evaluates the
verified intent and exact signature rather than choosing a preferred aesthetic.
Missing capabilities cannot be borrowed from the scanner or inferred from a
craft score.

The design exploration providers are brief-selected project integrations, not
new universal tools. Their artifacts are evaluated separately through
Playwright, comparison critics, computed color checks, and owner decisions.

Design-system extraction is deliberately outside this upstream-tool matrix.
It is a project-local creator contract, because no generic visual skill can
decide which domain states, authority boundaries, or density profiles are safe
to share. The `systemize` route uses upstream tools only as independent source,
functional, rendered, and copy critics around that local extraction.

## Overlap Resolution

### Taste, Hallmark, and anti-slop

All three discuss visual quality. Route by question:

- Taste: choose or explore a consumer or marketing visual direction.
- Hallmark: study references, lock a system, redesign, or inspect rendered craft.
- anti-slop: filter app usefulness, functional completeness, accessibility, and
  mobile behavior.

Never use all three as co-creators. Taste explicitly excludes dashboards, dense
product UI, admin panels, data tables, and multi-step forms in the reviewed
version.

### kill-ai-slop, anti-slop, and Hallmark

All can find visual tells, but they inspect different representations:

1. kill-ai-slop finds source-code candidates and can emit JSON.
2. anti-slop checks whether the interface works for real tasks and people.
3. Hallmark checks rendered hierarchy, specificity, execution, and restraint.

Run them as separate passes. A regex hit is not a verdict, and a rendered review
cannot prove interaction behavior.

Here, restraint means avoiding unjustified effects relative to the approved
direction. It does not mean gray, flat, paper-like, shadowless, or low-energy.
None of these critics may convert its anti-pattern list into creator direction.
The visual-intent contract decides the direction and editorial boundary; the
visual-signature contract fixes the actual palette, type, density, shape,
elevation, imagery, and motion. Zero scanner hits satisfy none of the
independent visual-contract, craft, browser, or owner gates.

If one provider is unavailable, route by the missing capability contract. Do
not substitute a source scanner for rendered craft or a browser smoke test for
human task review. Multiple independent fallbacks may be combined, but their
union must cover the full stage and each must meet its minimum strength.

### no-ai-slop and stop-slop

- no-ai-slop is the default copy critic because it favors minimal, voice-preserving edits.
- stop-slop is an optional stricter second pass for unresolved long-form prose.
- Do not run both over every compact UI label.
- Require a locale and domain reviewer for non-English or specialized copy.

### PeakOSS anti-slop

PeakOSS inspects pull-request and contribution hygiene. Keep it outside visual,
copy, accessibility, and product-quality verdicts. Its write or close behavior
requires separate CI and permission approval.

## Sources

- Taste Skill: https://github.com/Leonxlnx/taste-skill
- Hallmark: https://github.com/Nutlope/hallmark
- anti-slop: https://github.com/miqdadbadjuber/anti-slop
- kill-ai-slop: https://github.com/yetone/kill-ai-slop
- no-ai-slop: https://github.com/petergyang/no-ai-slop
- stop-slop: https://github.com/hardikpandya/stop-slop
- PeakOSS anti-slop: https://github.com/peakoss/anti-slop
