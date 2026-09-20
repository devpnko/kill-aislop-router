# Parent Baseline And Slice Lineage

KillSlopRouter can preserve an immutable all-product parent baseline while a
newer, narrower workflow evolves as a separately approved slice. The version
number is descriptive only. It never changes which artifact is the parent.

This contract belongs to the external service-planning receipt. KillSlopRouter
does not choose the parent, invent a slice boundary, or author an owner decision.

## Contract

Add `baseline_lineage` to the receipt selected by the project profile:

```json
{
  "baseline_lineage": {
    "baseline_lineage_version": 1,
    "lineage_id": "operator-product/policy",
    "relationship": "slice-of",
    "parent_baseline": {
      "id": "operator-product-parent",
      "version": "2.2.39",
      "artifacts": [
        {"path": "parent.html", "digest": "sha256:<exact>"}
      ]
    },
    "candidate": {
      "id": "operator-product-policy-slice",
      "version": "2.2.84",
      "slice_id": "policy-source-to-setting",
      "artifacts": [
        {"path": "policy.html", "digest": "sha256:<exact>"}
      ]
    },
    "inheritance": {
      "inherits": ["global shell", "navigation", "visual language"],
      "slice_owned": ["policy workflow", "policy state model"],
      "forbidden_parent_changes": ["implicit parent promotion"]
    },
    "promotion": {
      "authority": "explicit-owner-only",
      "supersedes_parent": false
    }
  }
}
```

See `examples/service-planning-lineage.example.json` for a runnable fixture and
`schemas/baseline-lineage-declaration.schema.json` for the external declaration
contract. Propagated runtime copies use `schemas/baseline-lineage.schema.json`,
which additionally requires the normalized `lineage_digest`.

Paths resolve from the planning receipt. Every parent and candidate artifact
must exist and match its SHA-256 digest. The candidate artifact set must also
match the integrated command's exact `--artifact` set; a route cannot quietly
substitute the parent, omit a candidate dependency, or add an unrelated file.
The receipt and both artifact sets must remain inside the real project root;
the root itself and controlled descendants cannot be symlinks. Parent and
candidate paths must be physically separate and non-nested. The router
canonicalizes real paths (including operating-system aliases such as macOS
`/var` and `/private/var`), rejects controlled symlink components, and compares
filesystem identities recursively. A path alias, hard link, or shared file
inside two directory artifacts therefore cannot make one mutable byte set
masquerade as both authorities.

## Authority rules

- `relationship` is exactly `slice-of`.
- `promotion.authority` is exactly `explicit-owner-only`.
- `promotion.supersedes_parent` is exactly `false`.
- A value such as `999.0.0` remains a slice version and has no precedence over
  a parent such as `2.2.39`.
- A slice may change only the named `slice_owned` dimensions. Global changes
  must return to the external planning authority as a separate all-scope parent
  proposal.
- Declaring lineage automatically adds G7 to the effective planning
  requirements, including a mockup audit that would otherwise require only
  G6. A candidate cannot become route-ready merely because it is newer or has
  mockup evidence.

For a lineaged G7, `approved-artifact` evidence must be exactly the candidate
artifact set—no parent substitution, omission, duplicate, or extra path. Its
`owner-approval` evidence must validate against
`schemas/baseline-lineage-owner-approval.schema.json` and bind the exact
`lineage_id`, normalized `baseline_lineage_digest`, and complete candidate
object. It must also state `decision_scope: candidate-slice-binding` and
`parent_promotion: false`. This owner decision authorizes only the exact slice
to enter the routed journey; it does not replace or promote the immutable
parent. The packaged example includes both evidence kinds in
`examples/service-planning-lineage.example.json` and the separate owner record
in `examples/planning-evidence/policy-slice-owner-approval.json`.

To replace a parent, do not edit a slice receipt or set a Boolean override.
Create a new all-scope planning candidate, audit it, and obtain exact owner
approval through the existing G7 process. Preserve the old parent as immutable
history.

## Runtime binding

When present and valid, the normalized `baseline_lineage` and its
`lineage_digest` are copied into the route plan, automation state, audit run,
every dispatch packet, every JSON child request, and the final audit receipt.
Every automation step receipt repeats `baseline_lineage_digest`. The generated
owner-approval template also requires that digest in addition to the existing
approval scope digest.

Planning evidence and both artifact sets are reverified before audit
initialization, at the last execution boundary before every built-in or JSON
child can start, on resume, and during finalization. The persisted audit lineage
is also compared with the digest-bound route-plan source and the original
planning receipt; removing the field and recalculating local state hashes does
not downgrade the authority. Resume reconstructs the route from the persisted
router/profile/request authority, requires the canonical `plan.json`, and
compares the reconstructed planning contract before it trusts any state copy.
It also verifies the final receipt's own digest and compares final/owner
lineage with the audit even when the state is already complete.
Parent tamper, candidate tamper, a re-signed state conflict, or a changed
planning receipt fails closed before another reviewer can start.

The first modern run writes `<state>.authorities/<run-id>.json` before state and
normally prints its `resume_authority_digest`. Retain the receipt outside the
mutable state and `.d/` directory, and present that original value on every
integrated resume:

```bash
killsloprouter run --resume .killsloprouter/run.json \
  --authority-digest 'sha256:<original value>' \
  --host-config .killsloprouter/host-adapters.json --json
```

The durable start receipt and caller-held assertion anchor the original router,
profile, request, project root, artifact digests, scope, journey identity, and
parent-owned paths before the first state write. Its version-5 authority also
binds the initial canonical plan-authority digest, including the selected
planning receipt and exact lineage. The plan file is persisted afterward and
is additionally bound by phase and audit receipts. Before the first child, the
separate caller-retained `<run-id>.initialization.json` commitment fixes those
initialization anchors without promoting the candidate or changing the parent.
Copies inside state and phase receipts are
cross-checks, not a substitute for retaining the original external receipt and
value.

## Compatibility

`baseline_lineage` is optional. Existing version-1 external planning receipts
remain valid when their live source and gate evidence can be pinned by the
current router. Pre-release modern automation states that lack the current
planning authority-source inventory remain diagnostic only and must restart;
physical identity cannot be safely inferred later. Once a
receipt declares lineage, G7 and all lineage checks are mandatory even when
`planning.required` was previously `false`; an invalid lineage is never exposed
as verified authority. Lineage-only boundary strings and receipt fields are
omitted—not serialized as `null`—for legacy no-lineage runs.

Modern pre-release states created before the durable version-5 start authority
and separate initialization commitment are still readable for diagnosis but
cannot be resumed. Start a new
journey from the same verified sources; deriving or backfilling an authority
value from the mutable old state would defeat the trust boundary. Verified evidence-free pre-identity
states continue to use the explicit `--migrate-identity` path, with the
byte-identical external legacy backup and its caller-retained file digest,
documented in
[Migration](migration-v1.md).
