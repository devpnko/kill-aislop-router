import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { hashArtifact } from "../src/integrity.mjs";
import {
  createSealedEntrypointAuthority,
  MAX_SEALED_ENTRYPOINT_BYTES,
  sealedEntrypointGraphDigest,
  spawnSealedNodeEntrypoint
} from "../src/sealed-entrypoint.mjs";

for (const [extension, source] of [
  ["mjs", 'process.stdout.write(JSON.stringify({format:"module"}));\n'],
  ["cjs", 'process.stdout.write(JSON.stringify({format:"commonjs"}));\n']
]) {
  test(`sealed ${extension} entrypoint executes its manifest-bound source`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-entrypoint-"));
    try {
      const entrypoint = path.join(directory, `adapter.${extension}`);
      fs.writeFileSync(entrypoint, source);
      const authority = createSealedEntrypointAuthority(
        entrypoint,
        hashArtifact(entrypoint)
      );
      const child = spawnSealedNodeEntrypoint(authority, [], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH || "" },
        timeout: 5_000
      });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      assert.equal(JSON.parse(child.stdout).format,
        extension === "mjs" ? "module" : "commonjs");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("sealed entrypoint authority rejects source above its bounded handoff size", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-limit-"));
  try {
    const entrypoint = path.join(directory, "oversized.mjs");
    fs.writeFileSync(entrypoint, Buffer.alloc(MAX_SEALED_ENTRYPOINT_BYTES + 1, 0x20));
    assert.throws(() => createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint)
    ), /sealed execution limit/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("module graph extraction ignores dependency syntax inside comments, strings, templates, and regexes", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-lexer-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    fs.writeFileSync(entrypoint, [
      "// require('./missing-comment.cjs')",
      "/* import './missing-block.mjs'; */",
      "const note = \"require('./missing-string.cjs')\";",
      "const template = `import './missing-template.mjs'`;",
      "const pattern = /require\\(\"\\.\\/missing-regex\\.cjs\"\\)/;",
      "process.stdout.write(note.includes('require') && template.length && pattern.test('none') === false ? 'lexed' : 'bad');"
    ].join("\n"));
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint)
    );
    assert.equal(authority.module_graph.modules.length, 1);
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "lexed");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const extension of ["mjs", "cjs"]) {
  test(`sealed ${extension} adapters ignore a locally declared require function`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-shadowed-require-"));
    try {
      const entrypoint = path.join(directory, `adapter.${extension}`);
      fs.writeFileSync(entrypoint, [
        "function require(value) { return value; }",
        'process.stdout.write(require("./not-a-module"));'
      ].join("\n"));
      const authority = createSealedEntrypointAuthority(
        entrypoint,
        hashArtifact(entrypoint)
      );
      assert.equal(authority.module_graph.modules.length, 1);
      const child = spawnSealedNodeEntrypoint(authority, [], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH || "" },
        timeout: 5_000
      });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      assert.equal(child.stdout, "./not-a-module");
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("CJS sealing distinguishes a parameter-shadowed require from the outer loader", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-scoped-require-"));
  try {
    const entrypoint = path.join(directory, "adapter.cjs");
    const helper = path.join(directory, "helper.cjs");
    fs.writeFileSync(helper, 'module.exports = "sealed";\n');
    fs.writeFileSync(entrypoint, [
      'const value = require("./helper.cjs");',
      "function echo(require) { return require(\"./not-a-module\"); }",
      "process.stdout.write(`${value}:${echo((input) => input)}`);"
    ].join("\n"));
    const graphDigest = sealedEntrypointGraphDigest(entrypoint);
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint),
      { expectedGraphDigest: graphDigest }
    );
    assert.deepEqual(
      authority.module_graph.modules.map((module) => path.basename(module.path)).sort(),
      ["adapter.cjs", "helper.cjs"]
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "sealed:./not-a-module");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("CJS sealing respects block, arrow, catch, and named-function require bindings", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-require-bindings-"));
  try {
    const entrypoint = path.join(directory, "adapter.cjs");
    const helper = path.join(directory, "helper.cjs");
    fs.writeFileSync(helper, 'module.exports = "sealed";\n');
    fs.writeFileSync(entrypoint, [
      'const value = require("./helper.cjs");',
      "let blockValue;",
      '{ const require = (input) => input; blockValue = require("./not-a-block-module"); }',
      'const arrowValue = ((require) => require("./not-an-arrow-module"))((input) => input);',
      "let catchValue;",
      "try { throw ((input) => input); } catch (require) { catchValue = require(\"./not-a-catch-module\"); }",
      'const namedValue = (function require(input) { return input; })("./not-a-named-module");',
      "process.stdout.write([value, blockValue, arrowValue, catchValue, namedValue].join(':'));"
    ].join("\n"));
    const graphDigest = sealedEntrypointGraphDigest(entrypoint);
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint),
      { expectedGraphDigest: graphDigest }
    );
    assert.deepEqual(
      authority.module_graph.modules.map((module) => path.basename(module.path)).sort(),
      ["adapter.cjs", "helper.cjs"]
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, [
      "sealed",
      "./not-a-block-module",
      "./not-an-arrow-module",
      "./not-a-catch-module",
      "./not-a-named-module"
    ].join(":"));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sealed module graphs capture literal imports inside nested template expressions", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-template-expression-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    const helper = path.join(directory, "helper.mjs");
    fs.writeFileSync(helper, 'export const value = "sealed-template";\n');
    fs.writeFileSync(entrypoint, [
      'const rendered = `outer:${`${(await import("./helper.mjs")).value}`}`;',
      "process.stdout.write(rendered);"
    ].join("\n"));
    const graphDigest = sealedEntrypointGraphDigest(entrypoint);
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint),
      { expectedGraphDigest: graphDigest }
    );
    assert.deepEqual(
      authority.module_graph.modules.map((module) => path.basename(module.path)).sort(),
      ["adapter.mjs", "helper.mjs"]
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "outer:sealed-template");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("sealed module graphs scan through long named import and export clauses", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-wide-import-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    const helper = path.join(directory, "helper.mjs");
    const names = Array.from({ length: 96 }, (_, index) => `v${index}`);
    fs.writeFileSync(helper,
      `${names.map((name, index) => `export const ${name} = ${index};`).join("\n")}\n`);
    fs.writeFileSync(entrypoint, [
      `export { ${names.join(", ")} } from "./helper.mjs";`,
      `import { ${names.join(", ")} } from "./helper.mjs";`,
      "process.stdout.write(String(v95));"
    ].join("\n"));
    const graphDigest = sealedEntrypointGraphDigest(entrypoint);
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint),
      { expectedGraphDigest: graphDigest }
    );
    assert.equal(authority.module_graph.modules.length, 2);
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "95");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("mixed ESM and CJS adapters use static import while createRequire remains fail closed", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-mixed-"));
  try {
    const helper = path.join(directory, "helper.cjs");
    const staticEntrypoint = path.join(directory, "static-adapter.mjs");
    const createRequireEntrypoint = path.join(directory, "create-require-adapter.mjs");
    fs.writeFileSync(helper, 'module.exports = "mixed-sealed";\n');
    fs.writeFileSync(staticEntrypoint,
      'import value from "./helper.cjs"; process.stdout.write(value);\n');
    const graphDigest = sealedEntrypointGraphDigest(staticEntrypoint);
    const authority = createSealedEntrypointAuthority(
      staticEntrypoint,
      hashArtifact(staticEntrypoint),
      { expectedGraphDigest: graphDigest }
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "mixed-sealed");

    fs.writeFileSync(createRequireEntrypoint, [
      'import { createRequire } from "node:module";',
      "const require = createRequire(import.meta.url);",
      'process.stdout.write(require("./helper.cjs"));'
    ].join("\n"));
    assert.throws(
      () => sealedEntrypointGraphDigest(createRequireEntrypoint),
      /cannot use createRequire outside the official Playwright runtime boundary/
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("trusted bundled module graphs support content-addressed hardlinks without weakening custom adapters", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-bundled-hardlink-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    const helper = path.join(directory, "helper.mjs");
    fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}\n');
    fs.writeFileSync(entrypoint,
      'import value from "./helper.mjs"; process.stdout.write(value);\n');
    fs.writeFileSync(helper, 'export default "hardlink-sealed";\n');
    fs.linkSync(entrypoint, path.join(directory, "adapter.store-link.mjs"));
    fs.linkSync(helper, path.join(directory, "helper.store-link.mjs"));

    assert.throws(() => sealedEntrypointGraphDigest(entrypoint), /single-link/);
    const graphDigest = sealedEntrypointGraphDigest(entrypoint, {
      trustedPackageRoot: directory
    });
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint),
      {
        expectedGraphDigest: graphDigest,
        trustedPackageRoot: directory
      }
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    assert.equal(child.stdout, "hardlink-sealed");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

for (const [extension, entrySource, helperSource] of [[
  "mjs",
  'import value from "./helper.mjs"; process.stdout.write(value);\n',
  'export default "sealed-esm";\n'
], [
  "cjs",
  'const value = require("./helper.cjs"); process.stdout.write(value);\n',
  'module.exports = "sealed-cjs";\n'
]]) {
  test(`sealed ${extension} module graph executes bound dependencies and rejects same-byte dependency replacement`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-graph-"));
    try {
      const entrypoint = path.join(directory, `adapter.${extension}`);
      const helper = path.join(directory, `helper.${extension}`);
      fs.writeFileSync(entrypoint, entrySource);
      fs.writeFileSync(helper, helperSource);
      const graphDigest = sealedEntrypointGraphDigest(entrypoint);
      assert.throws(() => createSealedEntrypointAuthority(
        entrypoint,
        hashArtifact(entrypoint)
      ), /requires entrypoint_graph_digest/);
      const authority = createSealedEntrypointAuthority(
        entrypoint,
        hashArtifact(entrypoint),
        { expectedGraphDigest: graphDigest }
      );
      const child = spawnSealedNodeEntrypoint(authority, [], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH || "" },
        timeout: 5_000
      });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      assert.equal(child.stdout, extension === "mjs" ? "sealed-esm" : "sealed-cjs");

      const replacement = path.join(directory, `replacement.${extension}`);
      fs.writeFileSync(replacement, helperSource);
      fs.renameSync(replacement, helper);
      assert.throws(() => spawnSealedNodeEntrypoint(authority, [], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH || "" },
        timeout: 5_000
      }), /imported module changed after manifest verification/);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

for (const [extension, entrySource, helperSource, expected] of [[
  "mjs",
  [
    'import fs from "node:fs";',
    'fs.writeFileSync(new URL("./helper.mjs", import.meta.url), \'export default "tampered-esm";\\n\');',
    'const { default: value } = await import("./helper.mjs");',
    'process.stdout.write(value);'
  ].join("\n"),
  'export default "sealed-esm";\n',
  "sealed-esm"
], [
  "cjs",
  [
    'const fs = require("node:fs");',
    'fs.writeFileSync("./helper.cjs", \'module.exports = "tampered-cjs";\\n\');',
    'const value = require("./helper.cjs");',
    'process.stdout.write(value);'
  ].join("\n"),
  'module.exports = "sealed-cjs";\n',
  "sealed-cjs"
]]) {
  test(`sealed ${extension} graph cannot reopen a helper mutated after child start`, () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-runtime-graph-"));
    try {
      const entrypoint = path.join(directory, `adapter.${extension}`);
      fs.writeFileSync(entrypoint, entrySource);
      fs.writeFileSync(path.join(directory, `helper.${extension}`), helperSource);
      const authority = createSealedEntrypointAuthority(
        entrypoint,
        hashArtifact(entrypoint),
        { expectedGraphDigest: sealedEntrypointGraphDigest(entrypoint) }
      );
      const child = spawnSealedNodeEntrypoint(authority, [], {
        cwd: directory,
        encoding: "utf8",
        env: { PATH: process.env.PATH || "" },
        timeout: 5_000
      });
      assert.equal(child.status, 0, child.stderr || child.error?.message);
      assert.equal(child.stdout, expected);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("sealed module loader rejects a computed local dependency omitted from graph authority", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-sealed-dynamic-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    fs.writeFileSync(entrypoint,
      'const dependency = "./helper.mjs"; await import(dependency);\n');
    fs.writeFileSync(path.join(directory, "helper.mjs"),
      'process.stdout.write("unsealed");\n');
    const authority = createSealedEntrypointAuthority(
      entrypoint,
      hashArtifact(entrypoint)
    );
    const child = spawnSealedNodeEntrypoint(authority, [], {
      cwd: directory,
      encoding: "utf8",
      env: { PATH: process.env.PATH || "" },
      timeout: 5_000
    });
    assert.notEqual(child.status, 0);
    assert.match(child.stderr, /unsealed local dependency/);
    assert.equal(child.stdout, "");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("digest --module-graph emits the manifest-ready graph authority digest", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-graph-digest-"));
  try {
    const entrypoint = path.join(directory, "adapter.mjs");
    const helper = path.join(directory, "helper.mjs");
    fs.writeFileSync(entrypoint, 'import "./helper.mjs";\n');
    fs.writeFileSync(helper, 'export const value = "sealed";\n');
    const child = spawnSync(process.execPath, [
      path.resolve("bin/killsloprouter.mjs"),
      "digest",
      "--target", entrypoint,
      "--module-graph",
      "--json"
    ], { encoding: "utf8", timeout: 5_000 });
    assert.equal(child.status, 0, child.stderr || child.error?.message);
    const receipt = JSON.parse(child.stdout);
    assert.equal(receipt.kind, "sealed-entrypoint-module-graph");
    assert.equal(receipt.digest, sealedEntrypointGraphDigest(entrypoint));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
