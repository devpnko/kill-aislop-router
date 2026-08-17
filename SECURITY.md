# Security Policy

## Supported Version

Security fixes target the latest released minor version.

## Execution Boundary

KillSlopRouter `0.1.x` plans routes and may execute explicitly allowlisted,
read-only adapters. It does not execute arbitrary commands from project
profiles. Treat any adapter runner that accepts shell strings, remote
prompts, credentials, browser sessions, production URLs, repository writes, or
pull-request mutations as a separate privileged component.

Before sending artifacts to an external service:

- remove credentials, secrets, PII, payment data, and private source material;
- verify the adapter version and license;
- require explicit approval for writes, publishing, deployment, comments, or closes;
- preserve raw evidence and mark unavailable adapters as blocked.

Report suspected vulnerabilities privately to the repository owner before
opening a public issue containing exploit details.
