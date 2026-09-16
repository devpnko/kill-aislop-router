import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");

test("bare CLI and --help show the same safe project entrypoint", () => {
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: root,
    encoding: "utf8",
    timeout: 10_000
  });
  const bare = run([]);
  const help = run(["--help"]);
  assert.equal(bare.status, 0, bare.stderr);
  assert.equal(help.status, 0, help.stderr);
  assert.equal(bare.stdout, help.stdout);
  assert.match(bare.stdout, /\$killsloprouter:kill-slop-router/);
  assert.match(bare.stdout, /doctor/);
  assert.match(bare.stdout, /Missing visual authority, adapters, browser evidence, or owner approval are hard stops/);
  assert.match(bare.stdout, /docs\/getting-started\.md/);
});
