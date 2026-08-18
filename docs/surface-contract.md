# Surface Contract

KillSlopRouter treats surface identity as a product-semantics boundary, not a
visual theme. An ERP, admin console, or staff workflow is normally
`operator-product-ui` even when it is polished or redesigned. A customer-facing
application is `consumer-product-ui`; acquisition and editorial material is
`marketing-editorial`. Choosing a surface changes eligible creators, critics,
evidence, density expectations, and domain questions, so it is resolved before
creator selection.

## Single-surface project

Bootstrap requires an explicit choice and locks the whole repository:

```bash
killsloprouter bootstrap \
  --root . \
  --project-id warehouse-erp \
  --locale ko-KR \
  --surface operator-product-ui \
  --json
```

The generated profile contains:

```json
{
  "surface_contract": {
    "surface_contract_version": 1,
    "primary": "operator-product-ui",
    "allowed": ["operator-product-ui"],
    "artifact_bindings": [
      { "root": ".", "surface": "operator-product-ui" }
    ]
  }
}
```

After that lock, `plan` and `run` can omit `--surface`. Supplying it asserts the
expected value; it never overrides the profile.

`killsloprouter doctor` verifies that the project root and every binding root
exist as real directories before reporting automation readiness.

## Multi-surface repository

Use reviewed repository-relative directory roots. A more-specific binding wins:

```json
{
  "surface_contract": {
    "surface_contract_version": 1,
    "primary": "operator-product-ui",
    "allowed": ["operator-product-ui", "consumer-product-ui"],
    "artifact_bindings": [
      { "root": ".", "surface": "operator-product-ui" },
      { "root": "apps/customer", "surface": "consumer-product-ui" }
    ]
  }
}
```

An artifact under `apps/customer` resolves to the consumer surface; other bound
artifacts resolve to operator. Multiple `--artifact` values are allowed only
when all of them resolve to the same surface. Split operator and consumer work
into separate runs so creator, critic, browser, and approval scopes stay clear.

## Fail-closed resolution

Before route selection KillSlopRouter:

1. validates that every allowed surface has a binding;
2. resolves a real, non-symlink project root and binding directory;
3. rejects missing, symlinked, escaped, unbound, or ambiguously bound artifacts;
4. chooses the most-specific matching binding;
5. blocks a run that spans multiple surfaces;
6. blocks when an optional CLI assertion disagrees; and
7. records the contract and profile digests in the plan, audit, and resumable state.

A profile that changes after planning cannot be resumed or finalized as the old
route. Review the intentional contract change and start a new run. There is no
force flag that turns an ERP into a consumer product inside an existing audit.

## Choosing safely

Repository evidence can establish the surface when audience, workflows, and
artifact roots are explicit. Examples include staff roles and operational
queues for operator UI, customer account journeys for consumer UI, or campaign
pages for editorial UI. A color palette, card layout, design trend, or the word
"redesign" is not sufficient evidence. If the audience or ownership boundary
is genuinely ambiguous, record the owner choice before bootstrap instead of
guessing.
