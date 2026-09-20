#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolatedHome = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-check-home-"));

try {
  const result = spawnSync(process.execPath, [
    path.join(root, "bin", "killsloprouter.mjs"),
    "doctor",
    "--profile", path.join(root, "examples", "project-profile.example.json")
  ], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: isolatedHome,
      USERPROFILE: isolatedHome
    },
    shell: false,
    timeout: 30_000
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(isolatedHome, { recursive: true, force: true });
}
