# Security Policy

## Supported Version

Security fixes target the latest released minor version.

## Execution Boundary

KillSlopRouter `0.3.x` plans routes, runs the explicitly allowlisted read-only
`kill-ai-slop` scanner adapter, and ingests structured critic and evidence
files. It does not execute arbitrary commands from project profiles. Treat any
host adapter that accepts shell strings, remote prompts, credentials, browser
sessions, production URLs, repository writes, or pull-request mutations as a
separate privileged component.

Audit hashes detect accidental or post-review changes; they are not digital
signatures. A person with write access to the run and all evidence can replace
the ledger. Reviewer and owner IDs are asserted provenance, not authenticated
identities. Keep CI artifacts immutable when stronger provenance is required.

Before sending artifacts to an external service:

- remove credentials, secrets, PII, payment data, and private source material;
- verify the adapter version and license;
- require explicit approval for writes, publishing, deployment, comments, or closes;
- preserve raw evidence and mark unavailable adapters as blocked.

Report suspected vulnerabilities privately to the repository owner before
opening a public issue containing exploit details.
