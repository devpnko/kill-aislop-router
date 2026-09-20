import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readAuditRunForCommand } from "../src/cli.mjs";
import { readJsonPinned, writeJsonAtomic } from "../src/integrity.mjs";
import { prepareExecutionOutputBoundary } from "../src/execution.mjs";
import {
  secureExistingRegularFile,
  secureWritablePath
} from "../src/path-security.mjs";
import { acquireStateLease } from "../src/state-lease.mjs";

function remove(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

test("pinned reads keep caller authority single-link while permitting explicit package-asset hardlinks", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-package-hardlink-"));
  const source = path.join(root, "router.json");
  const linked = path.join(root, "router.store-link.json");
  fs.writeFileSync(source, `${JSON.stringify({ router_id: "package-fixture" })}\n`, { mode: 0o444 });
  fs.linkSync(source, linked);
  try {
    assert.throws(() => readJsonPinned(source, { label: "caller router authority" }),
      /single-link/);
    const pinned = readJsonPinned(source, {
      label: "trusted package router asset",
      requireCallerOwned: false,
      requireSingleLink: false
    });
    assert.equal(pinned.input.router_id, "package-fixture");
    assert.equal(pinned.file_identity.links, "2");
  } finally {
    remove(root);
  }
});

test("one pinned JSON descriptor rejects a path replacement between parse and provenance binding", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-pinned-json-"));
  const source = path.join(root, "decision.json");
  const retained = path.join(root, "decision.original.json");
  fs.writeFileSync(source, `${JSON.stringify({ decision: "original" })}\n`, { mode: 0o600 });
  try {
    assert.throws(() => readJsonPinned(source, {
      label: "standalone audit decision",
      faultInjector(checkpoint) {
        if (checkpoint !== "after-read-before-path-revalidation") return;
        fs.renameSync(source, retained);
        fs.writeFileSync(source, `${JSON.stringify({ decision: "replacement" })}\n`, {
          mode: 0o600
        });
      }
    }), /path identity changed while it was being read/);
    assert.deepEqual(JSON.parse(fs.readFileSync(retained, "utf8")), {
      decision: "original"
    });
  } finally {
    remove(root);
  }
});

test("standalone audit commands keep --run parse and authority on one pinned descriptor", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-audit-run-pin-"));
  const source = path.join(root, "audit-run.json");
  const retained = path.join(root, "audit-run.original.json");
  fs.writeFileSync(source, `${JSON.stringify({
    audit_run_version: 1,
    run_id: "original-run"
  })}\n`, { mode: 0o600 });
  try {
    assert.throws(() => readAuditRunForCommand(source, {
      faultInjector(checkpoint) {
        if (checkpoint !== "after-read-before-path-revalidation") return;
        fs.renameSync(source, retained);
        fs.writeFileSync(source, `${JSON.stringify({
          audit_run_version: 1,
          run_id: "replacement-run"
        })}\n`, { mode: 0o600 });
      }
    }), /path identity changed while it was being read/);
    assert.equal(JSON.parse(fs.readFileSync(retained, "utf8")).run_id, "original-run");
    assert.equal(JSON.parse(fs.readFileSync(source, "utf8")).run_id, "replacement-run");
  } finally {
    remove(root);
  }
});

test("atomic JSON output rejects an ancestor swap after path preflight before any redirected write", {
  skip: process.platform === "win32"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-write-guard-"));
  const authority = path.join(root, "authority");
  const retained = path.join(root, "authority-retained");
  const redirected = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-write-redirect-"));
  fs.mkdirSync(authority);
  const target = path.join(authority, "nested", "receipt.json");
  try {
    assert.throws(() => writeJsonAtomic(target, { secret: "must-not-redirect" }, {
      label: "fault-injected JSON receipt",
      faultInjector(checkpoint) {
        if (checkpoint !== "after-preflight") return;
        fs.renameSync(authority, retained);
        fs.symlinkSync(redirected, authority, "dir");
      }
    }), /symlink ancestor|physical identity changed/);
    assert.deepEqual(fs.readdirSync(redirected), [],
      "the first directory or file write must not cross the swapped ancestor");
    assert.equal(fs.existsSync(path.join(retained, "nested")), false);
  } finally {
    remove(root);
    remove(redirected);
  }
});

test("atomic JSON output refuses commit when its guarded parent changes after the temp write", {
  skip: process.platform === "win32"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-commit-guard-"));
  const parent = path.join(root, "receipts");
  const retained = path.join(root, "receipts-retained");
  const redirected = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-commit-redirect-"));
  fs.mkdirSync(parent);
  const target = path.join(parent, "receipt.json");
  try {
    assert.throws(() => writeJsonAtomic(target, { secret: "must-not-commit" }, {
      label: "fault-injected JSON commit",
      faultInjector(checkpoint) {
        if (checkpoint !== "before-commit") return;
        fs.renameSync(parent, retained);
        fs.symlinkSync(redirected, parent, "dir");
      }
    }), /physical identity changed|symlink ancestor/);
    assert.deepEqual(fs.readdirSync(redirected), [],
      "a guarded commit must not rename a prepared file into the redirect target");
    assert.equal(fs.existsSync(path.join(redirected, "receipt.json")), false);
  } finally {
    remove(root);
    remove(redirected);
  }
});

test("lease acquisition rejects a state ancestor swap after preflight before staging", {
  skip: process.platform === "win32"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-guard-"));
  const stateRoot = path.join(root, ".killsloprouter");
  const retained = path.join(root, ".killsloprouter-retained");
  const redirected = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-lease-swap-"));
  fs.mkdirSync(stateRoot);
  const statePath = path.join(stateRoot, "run.json");
  try {
    assert.throws(() => acquireStateLease({
      statePath,
      operation: "fault-injected-acquire",
      faultInjector(checkpoint) {
        if (checkpoint !== "after-state-path-preflight") return;
        fs.renameSync(stateRoot, retained);
        fs.symlinkSync(redirected, stateRoot, "dir");
      }
    }), /symlink ancestor|physical identity changed/);
    assert.deepEqual(fs.readdirSync(redirected), [],
      "lease staging must not be created through the swapped state ancestor");
    assert.equal(fs.existsSync(`${statePath}.lease`), false);
  } finally {
    remove(root);
    remove(redirected);
  }
});

test("guarded JSON output preserves the root-owned macOS /tmp platform alias", {
  skip: process.platform !== "darwin"
}, () => {
  const directory = fs.mkdtempSync("/tmp/killsloprouter-platform-alias-");
  const target = path.join(directory, "receipt.json");
  try {
    writeJsonAtomic(target, { status: "ok" });
    assert.deepEqual(JSON.parse(fs.readFileSync(target, "utf8")), { status: "ok" });
    assert.equal(fs.realpathSync.native(target).startsWith("/private/tmp/"), true);
  } finally {
    remove(directory);
  }
});

test("direct secure path APIs preserve verified macOS /tmp and /var aliases", {
  skip: process.platform !== "darwin"
}, () => {
  const roots = ["/tmp", "/var/tmp"];
  const directories = [];
  try {
    for (const aliasRoot of roots) {
      const directory = fs.mkdtempSync(path.join(aliasRoot, "killsloprouter-direct-alias-"));
      directories.push(directory);
      const source = path.join(directory, "authority.json");
      const output = path.join(directory, "nested", "receipt.json");
      fs.writeFileSync(source, `${JSON.stringify({ status: "approved" })}\n`, { mode: 0o600 });

      assert.equal(
        secureExistingRegularFile(source, `${aliasRoot} authority`, { singleLink: true }),
        fs.realpathSync.native(source)
      );
      assert.equal(
        secureWritablePath(output, `${aliasRoot} output`),
        path.join(fs.realpathSync.native(directory), "nested", "receipt.json")
      );
    }
  } finally {
    for (const directory of directories) remove(directory);
  }
});

test("execution output boundaries preserve the verified root-owned macOS /tmp alias", {
  skip: process.platform !== "darwin"
}, () => {
  const directory = path.join("/tmp",
    `killsloprouter-execution-alias-${process.pid}-${Date.now()}`);
  const output = path.join(directory, "nested", "evidence");
  try {
    const boundary = prepareExecutionOutputBoundary(output);
    assert.equal(boundary.lexical_path, output);
    assert.equal(boundary.real_path, fs.realpathSync.native(output));
    assert.equal(boundary.grant.lexical_path, "/tmp");
    assert.equal(boundary.grant.real_path, fs.realpathSync.native("/tmp"));
  } finally {
    remove(directory);
  }
});

test("execution output boundaries reject a pre-existing symlink ancestor without an explicit grant", {
  skip: process.platform === "win32"
}, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-output-symlink-"));
  const realRoot = path.join(root, "real");
  const nested = path.join(realRoot, "nested");
  const alias = path.join(root, "alias");
  fs.mkdirSync(nested, { recursive: true });
  fs.symlinkSync(realRoot, alias, "dir");
  try {
    assert.throws(
      () => prepareExecutionOutputBoundary(path.join(alias, "nested", "evidence")),
      /symlink ancestor|real directory/
    );
    assert.equal(fs.existsSync(path.join(nested, "evidence")), false,
      "output preparation must not create evidence through the symlink ancestor");
  } finally {
    remove(root);
  }
});
