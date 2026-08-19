# Security Policy

## Supported Version

The release-ready source line is 1.x. This work does not publish an npm package
or create a GitHub Release; published-version support starts only after that
separate owner action.

## Execution Boundary

KillSlopRouter 1.x plans routes, runs explicitly allowlisted and digest-locked
host adapters, and ingests structured critic and evidence files. It rejects
execution fields in project profiles and never executes profile commands.

JSON host adapters run as the current Node executable plus one verified
entrypoint, with `shell:false`. They are still trusted local code with the
operating-system privileges of the parent process. Use a container, VM, or
restricted CI worker for an adapter you do not fully trust. The permission
manifest is an authorization and audit boundary, not an OS sandbox.

The official Playwright adapter uses loopback by default, blocks page requests
outside configured origins, and requires the served application to attest the
exact artifact digest map before browser launch. External URLs require explicit
`network:external` authority. Playwright/axe libraries, scenarios, and visual
baselines are digest-locked; browser binaries are installed separately by the
operator.

Audit hashes detect accidental or post-review changes; they are not digital
signatures. A person with write access to the run and all evidence can replace
the ledger. Reviewer and owner IDs are asserted provenance, not authenticated
identities. Keep CI artifacts immutable when stronger provenance is required.

Visual intent is resolved separately from the product surface. Approved intent
must match a digest-locked authority receipt and evidence chain; unresolved
intent or unapproved editorial treatment blocks visual work. These digests
protect integrity, not the real-world identity of the asserted authority.
Concrete visual signature values are separately evidence-bound per surface.
Palette frequency, logo color, scanner output, and critic preference cannot
authorize token substitution or global style normalization.

Before sending artifacts to an external service:

- remove credentials, secrets, PII, payment data, and private source material;
- verify the adapter version and license;
- require explicit approval for writes, publishing, deployment, comments, or closes;
- preserve raw evidence and report unavailable adapters as `manual_pending` or blocked according to the exact run state.

See `docs/threat-model-and-permissions.md` for the complete trust and permission
model. Repository writes, publishing, deployment, credentials, production
access, and pull-request mutation are outside the V1 host adapter contract.

Report suspected vulnerabilities privately to the repository owner before
opening a public issue containing exploit details.
