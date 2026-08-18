# Design System Systemization Contract

`systemize` converts one exact, owner-approved artifact version into a reusable
implementation contract. It is not a visual redesign pass.

## Inputs

- G6T audit receipt and exact G7 owner approval
- approved artifact digest and surface identity
- project object, state, authority, and terminology contracts
- representative desktop and mobile states
- current source inventory and runtime constraints

## Required Outputs

1. **Artifact inventory**: repeated styles, structures, controls, states, and
   deliberately unique patterns with source locations.
2. **Token contract**: semantic color, typography, spacing, radius, border,
   elevation, motion, density, and breakpoint tokens. Raw-value aliases are not
   sufficient.
3. **Component contract**: ownership, anatomy, slots, variants, states,
   accessibility behavior, and prohibited uses for each shared component.
4. **Surface profiles**: explicit differences between operator, consumer, and
   editorial products. Shared primitives must not flatten their task density or
   trust model.
5. **Reference implementation**: framework-level primitives and a rendered
   fixture that exercises every supported variant and state.
6. **Migration map**: old selector or component to new primitive, ordered by
   risk and bounded by representative workflows.
7. **Drift controls**: token linting, component tests, visual regression,
   accessibility checks, and exceptions with owners.

## Non-Goals

- changing product semantics after G7;
- treating every repeated DOM fragment as a component;
- forcing operator and consumer surfaces into one presentation profile;
- removing purposeful exceptions merely to reduce line count;
- claiming runtime parity before G9 evidence.

## Release Rule

The extracted system starts as `candidate`. It becomes `approved` only after
independent system-contract review, functional review, rendered review, browser
evidence, domain adjudication, and explicit owner approval. Record the release
as a versioned `design_system` object in the project profile.
