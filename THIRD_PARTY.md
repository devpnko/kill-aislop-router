# Third-Party Tools

KillSlopRouter references these reviewer projects but does not bundle their source code:

| Tool | Repository | Reviewed license |
|---|---|---|
| Taste Skill | https://github.com/Leonxlnx/taste-skill | MIT |
| Hallmark | https://github.com/Nutlope/hallmark | MIT |
| anti-slop | https://github.com/miqdadbadjuber/anti-slop | MIT |
| kill-ai-slop | https://github.com/yetone/kill-ai-slop | Apache-2.0 |
| no-ai-slop | https://github.com/petergyang/no-ai-slop | MIT |
| stop-slop | https://github.com/hardikpandya/stop-slop | MIT |
| PeakOSS anti-slop | https://github.com/peakoss/anti-slop | AGPL-3.0 |

Exact reviewed commits live in `registry/tool-lock.json`. Users install and run
third-party tools under their own licenses and security policies.

The Codex plugin installer bundles these pinned browser-runtime dependencies
from npm into its private `.runtime` directory:

| Package | Version | License | Purpose |
|---|---:|---|---|
| `playwright-core` | 1.62.1 | Apache-2.0 | Browser control without an implicit browser download |
| `axe-core` | 4.13.0 | MPL-2.0 | Automated accessibility and contrast evidence |

Their package license files remain in the copied runtime directories. Browser
binaries are not bundled or downloaded during plugin installation.
