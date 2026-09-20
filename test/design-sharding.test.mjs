import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { DESIGN_SHARD_COUNT, selectDesignTests } from "./design-suite.mjs";

const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(directory);
const expectedNames = JSON.parse(fs.readFileSync(
  path.join(directory, "fixtures", "design-test-inventory.json"), "utf8"
));

test("design inventory retains every named pre-sharding regression", () => {
  const names = selectDesignTests().map(([name]) => name);
  assert.deepEqual(names, expectedNames);
  assert.equal(new Set(names).size, names.length);
});

test("design shards execute a complete disjoint partition with original callbacks and options", () => {
  const complete = selectDesignTests();
  const assigned = [];
  for (let shard = 0; shard < DESIGN_SHARD_COUNT; shard += 1) {
    const selected = selectDesignTests({ shard, shards: DESIGN_SHARD_COUNT });
    assert.ok(selected.length > 0);
    assert.ok(selected.length <= Math.ceil(complete.length / DESIGN_SHARD_COUNT));
    assert.deepEqual(selected, selectDesignTests({ shard, shards: DESIGN_SHARD_COUNT }));
    selected.forEach((args, index) => {
      assert.equal(args, complete[index * DESIGN_SHARD_COUNT + shard]);
      assert.equal(typeof args.at(-1), "function");
    });
    assigned.push(...selected.map(([name]) => name));
  }
  assert.equal(assigned.length, complete.length);
  assert.equal(new Set(assigned).size, complete.length);
  assert.deepEqual(assigned.sort(), [...expectedNames].sort());
});

test("invalid design shard selectors fail rather than silently running an incomplete suite", () => {
  for (const selection of [
    { shard: -1 }, { shard: 1 }, { shard: 8, shards: 8 },
    { shard: 0.5, shards: 8 }, { shard: "0", shards: 8 },
    { shard: NaN, shards: 8 }, { shard: Infinity, shards: 8 },
    { shards: 0 }, { shards: -1 }, { shards: 2 }, { shards: 8.5 },
    { shards: "8" }, { shards: NaN }, { shards: Infinity }
  ]) assert.throws(() => selectDesignTests(selection), /invalid .* shard selection/);
});

test("every declared design shard has exactly one executable entrypoint", () => {
  const wrappers = fs.readdirSync(directory).filter((name) => /^design-shard-.*\.test\.mjs$/.test(name)).sort();
  assert.deepEqual(wrappers, Array.from({ length: DESIGN_SHARD_COUNT },
    (_, shard) => `design-shard-${shard + 1}.test.mjs`));
  wrappers.forEach((name, shard) => {
    assert.equal(fs.readFileSync(path.join(directory, name), "utf8"),
      'import { registerDesignTests } from "./design-suite.mjs";\n' +
      `registerDesignTests({ shard: ${shard}, shards: ${DESIGN_SHARD_COUNT} });\n`);
  });
});

test("the historical design test entrypoint still registers the complete inventory", () => {
  assert.equal(fs.readFileSync(path.join(directory, "design.test.mjs"), "utf8"),
    "// Backwards-compatible standalone entrypoint: executes the complete suite.\n" +
    'import { registerDesignTests } from "./design-suite.mjs";\n' +
    "registerDesignTests();\n");
});

test("design shard registration introduces no skipped or exclusive cases", () => {
  for (const [name, optionsOrCallback] of selectDesignTests()) {
    if (typeof optionsOrCallback !== "object") continue;
    assert.ok(!optionsOrCallback.skip, name);
    assert.ok(!optionsOrCallback.only, name);
    assert.ok(!optionsOrCallback.todo, name);
  }
});

test("default scripts retain two E2E workers and run the full design inventory once", () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const args = scripts["test:e2e"].split(/\s+/);
  assert.deepEqual(args.slice(0, 3), ["node", "--test", "--test-concurrency=2"]);
  assert.equal(args.filter((arg) => arg === "test/design-shard-*.test.mjs").length, 1);
  assert.ok(!args.includes("test/design.test.mjs"));
  assert.ok(!args.some((arg) => /--test-(?:name|skip)-pattern|--test-only|--test-shard/.test(arg)));
  for (const script of ["test", "test:e2e"]) {
    assert.ok(scripts[script].includes("test/design-sharding.test.mjs"));
  }
});

test("standalone and sharded Node entrypoints both execute a selected real case", () => {
  const name = "contrast ratios are recomputed locally instead of trusting adapter claims";
  const ordinal = expectedNames.indexOf(name);
  assert.ok(ordinal >= 0);
  // This is a fresh runner, not a child reporting into this runner's IPC lane.
  const { NODE_TEST_CONTEXT: _parentTestContext, ...childEnvironment } = process.env;
  for (const entrypoint of ["design.test.mjs", `design-shard-${ordinal % DESIGN_SHARD_COUNT + 1}.test.mjs`]) {
    const result = spawnSync(process.execPath, [
      "--test", "--test-reporter=tap", `--test-name-pattern=^${name}$`, path.join(directory, entrypoint)
    ], { cwd: root, env: childEnvironment, encoding: "utf8", timeout: 30_000 });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, new RegExp(`ok [0-9]+ - ${name}`));
    assert.match(result.stdout, /# pass 1\b/);
    assert.match(result.stdout, /# fail 0\b/);
  }
});
