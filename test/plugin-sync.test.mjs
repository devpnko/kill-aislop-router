import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalDigest } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");

function fixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-account-sync-"));
  const accounts = [".codex", ".codex-accounts/account2", ".codex-accounts/account3"].map((p) => path.join(home, p));
  for (const account of accounts) {
    fs.mkdirSync(account, { recursive: true });
    fs.writeFileSync(path.join(account, "config.toml"), 'model = "fixture-model"\n');
    fs.writeFileSync(path.join(account, "auth.json"), "fixture-secret-not-for-sync\n");
  }
  const commands = path.join(home, "commands.jsonl");
  const bin = path.join(home, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "codex"), `#!${process.execPath}
const fs = require("node:fs"), path = require("node:path");
const home = process.env.KSR_SYNC_FIXTURE_HOME, account = process.env.CODEX_HOME;
const args = process.argv.slice(2);
fs.appendFileSync(path.join(home, "commands.jsonl"), JSON.stringify({account,args}) + "\\n");
const source = path.join(home, "plugins", "killsloprouter");
const version = JSON.parse(fs.readFileSync(path.join(source,".codex-plugin/plugin.json"))).version;
const record = path.join(account, "plugins", "sync-fixture.json");
if (args[1] === "add") {
  if (fs.existsSync(path.join(account, "fail-add"))) process.exit(7);
  const cache = path.join(account,"plugins/cache/personal/killsloprouter",version);
  fs.mkdirSync(path.dirname(cache),{recursive:true});
  fs.cpSync(source,cache,{recursive:true});
  fs.writeFileSync(record,JSON.stringify({pluginId:"killsloprouter@personal",name:"killsloprouter",version,installed:true,enabled:true,source:{source:"local",path:source}}));
  console.log(JSON.stringify({pluginId:"killsloprouter@personal",version,installedPath:cache}));
} else if (args[1] === "list") {
  if (fs.existsSync(path.join(account,"refresh-on-list"))) {
    fs.cpSync(source,path.join(account,"plugins/cache/personal/killsloprouter",version),{recursive:true});
  }
  console.log(JSON.stringify({installed:fs.existsSync(record)?[JSON.parse(fs.readFileSync(record))]:[]}));
} else process.exit(8);
`, { mode: 0o700 });
  const run = (args) => spawnSync(process.execPath, [cli, ...args], {
    cwd: home, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: accounts[2],
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, KSR_SYNC_FIXTURE_HOME: home }
  });
  const installed = run(["plugin", "install", "--no-activate"]);
  assert.equal(installed.status, 0, installed.stderr || installed.stdout);
  return {
    home, accounts, run,
    config: path.join(home,".killsloprouter/plugin-sync.json"),
    target: path.join(home,"plugins/killsloprouter"),
    calls: () => fs.existsSync(commands) ? fs.readFileSync(commands,"utf8").trim().split("\n").filter(Boolean).map(JSON.parse) : [],
    cleanup: () => fs.rmSync(home,{recursive:true,force:true})
  };
}

function output(result) { assert.notEqual(result.stdout, "", result.stderr); return JSON.parse(result.stdout); }

test("shared toggle previews without writes, syncs enrolled accounts, and is idempotent", () => {
  const f = fixture();
  try {
    const initial = output(f.run(["plugin","sync","--json"]));
    assert.equal(initial.mode,"per-account");
    assert.equal(fs.existsSync(f.config),false);
    const preview = output(f.run(["plugin","sync","--mode","shared","--discover-accounts","--dry-run","--json"]));
    assert.equal(preview.status,"sync_required");
    assert.equal(preview.policy_saved,false);
    assert.equal(preview.accounts.length,3);
    assert.equal(fs.existsSync(f.config),false);
    assert.equal(fs.existsSync(path.join(f.home,".killsloprouter/plugin-sync.lock")),false);
    assert.equal(f.calls().some((call)=>call.args[1]==="add"),false);
    assert.equal(f.calls().length,0,"preview must not invoke Codex because list may refresh caches");
    const applied = f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]);
    assert.equal(applied.status,0,applied.stderr || applied.stdout);
    const receipt = output(applied);
    assert.equal(receipt.status,"synced");
    assert.equal(receipt.accounts.filter((account)=>account.changed).length,3);
    const stored = JSON.parse(fs.readFileSync(receipt.receipt_path));
    const {receipt_digest,...body}=stored;
    assert.equal(receipt_digest,canonicalDigest(body));
    for (const account of f.accounts) {
      assert.equal(fs.readFileSync(path.join(account,"auth.json"),"utf8"),"fixture-secret-not-for-sync\n");
      assert.equal(fs.readFileSync(path.join(account,"config.toml"),"utf8"),'model = "fixture-model"\n');
    }
    const again = f.run(["plugin","sync","--apply","--json"]);
    assert.equal(again.status,0,again.stdout);
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,3);
    assert.equal(output(again).accounts.some((account)=>account.changed),false);
  } finally { f.cleanup(); }
});

test("OFF preserves each account version and re-enabling shared mode resumes sync", () => {
  const f=fixture();
  try {
    assert.equal(f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]).status,0);
    const record=path.join(f.accounts[1],"plugins/sync-fixture.json");
    const entry=JSON.parse(fs.readFileSync(record));
    entry.version="0.9.0";
    fs.writeFileSync(record,JSON.stringify(entry));
    const off=f.run(["plugin","sync","--mode","per-account","--apply","--json"]);
    assert.equal(off.status,0,off.stdout);
    assert.equal(output(off).applied,false);
    assert.equal(output(off).accounts[1].status,"cached");
    assert.equal(output(off).accounts[1].activation_verified,false);
    assert.equal(JSON.parse(fs.readFileSync(record)).version,"0.9.0");
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,3);
    const on=f.run(["plugin","sync","--mode","shared","--apply","--json"]);
    assert.equal(on.status,0,on.stdout);
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,4);
  } finally { f.cleanup(); }
});

test("a failed or disabled account prevents shared success; retry only installs pending accounts", () => {
  const f=fixture();
  try {
    fs.writeFileSync(path.join(f.accounts[1],"fail-add"),"");
    const partial=f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]);
    assert.equal(partial.status,5);
    assert.deepEqual(output(partial).accounts.map((account)=>account.status),["synced","failed","synced"]);
    fs.unlinkSync(path.join(f.accounts[1],"fail-add"));
    const retry=f.run(["plugin","sync","--apply","--json"]);
    assert.equal(retry.status,0,retry.stdout);
    assert.equal(output(retry).accounts.filter((account)=>account.changed).length,1);
    const record=path.join(f.accounts[1],"plugins/sync-fixture.json");
    const disabled=JSON.parse(fs.readFileSync(record)); disabled.enabled=false;
    fs.writeFileSync(record,JSON.stringify(disabled));
    const count=f.calls().filter((call)=>call.args[1]==="add").length;
    const next=f.run(["plugin","sync","--apply","--json"]);
    assert.equal(next.status,5);
    assert.equal(output(next).accounts[1].status,"disabled");
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,count);
  } finally { f.cleanup(); }
});

test("same-version cache tamper and canonical tamper block instead of being silently repaired", () => {
  const f=fixture();
  try {
    const synced=output(f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]));
    const cache=path.join(f.accounts[1],"plugins/cache/personal/killsloprouter",synced.target.version);
    const callsBefore=f.calls().filter((call)=>fs.realpathSync(call.account)===fs.realpathSync(f.accounts[1])).length;
    fs.writeFileSync(path.join(f.accounts[1],"refresh-on-list"),"");
    fs.appendFileSync(path.join(cache,"README.md"),"\nmodified\n");
    const tampered=f.run(["plugin","sync","--apply","--json"]);
    assert.equal(tampered.status,5);
    assert.equal(output(tampered).accounts[1].status,"failed");
    assert.match(output(tampered).accounts[1].error,/cache does not match/);
    assert.equal(f.calls().filter((call)=>fs.realpathSync(call.account)===fs.realpathSync(f.accounts[1])).length,callsBefore,
      "tampered target must block before Codex list can refresh it");
    assert.match(fs.readFileSync(path.join(cache,"README.md"),"utf8"),/modified/);
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,3);
    const before=f.calls().length;
    fs.appendFileSync(path.join(f.target,"README.md"),"\nmodified\n");
    const canonical=f.run(["plugin","sync","--apply","--json"]);
    assert.equal(canonical.status,5);
    assert.equal(f.calls().length,before);
  } finally { f.cleanup(); }
});

test("sync rejects policy commands, symlink accounts, and concurrent mutation locks before children", () => {
  const f=fixture();
  try {
    fs.mkdirSync(path.dirname(f.config),{recursive:true});
    fs.writeFileSync(f.config,JSON.stringify({plugin_sync_version:1,mode:"shared",accounts:f.accounts,command:"do-not-run"}));
    assert.notEqual(f.run(["plugin","sync","--apply","--json"]).status,0);
    assert.equal(f.calls().length,0);
    fs.unlinkSync(f.config);
    const alias=path.join(f.home,"alias"); fs.symlinkSync(f.accounts[0],alias,"dir");
    assert.notEqual(f.run(["plugin","sync","--mode","shared","--account-home",alias,"--apply","--json"]).status,0);
    assert.equal(f.calls().length,0);
    fs.writeFileSync(path.join(f.home,".killsloprouter/plugin-sync.lock"),"owner-still-active");
    const locked=f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]);
    assert.notEqual(locked.status,0);
    assert.match(locked.stderr,/already locked/);
    assert.equal(f.calls().length,0);
  } finally { f.cleanup(); }
});

test("installer follows shared policy while dry-run and no-activate perform no account changes", () => {
  const f=fixture();
  try {
    output(f.run(["plugin","sync","--mode","shared","--discover-accounts","--json"]));
    const preview=output(f.run(["plugin","install","--force","--dry-run"]));
    assert.equal(preview.account_sync.would_apply,true);
    assert.equal(f.run(["plugin","install","--force","--no-activate"]).status,0);
    assert.equal(f.calls().some((call)=>call.args[1]==="add"),false);
    const refreshed=f.run(["plugin","install","--force"]);
    assert.equal(refreshed.status,0,refreshed.stderr || refreshed.stdout);
    assert.equal(output(refreshed).activation.status,"synced");
    assert.equal(f.calls().filter((call)=>call.args[1]==="add").length,3);
  } finally { f.cleanup(); }
});

test("existing shared plugin folders require an enrolled owner and never get rewired by the toggle", () => {
  const f=fixture();
  try {
    const owner=path.join(f.accounts[0],"plugins");
    fs.mkdirSync(owner);
    const linked=path.join(f.accounts[1],"plugins");
    fs.symlinkSync(owner,linked,"dir");
    const refused=f.run(["plugin","sync","--mode","shared","--account-home",f.accounts[1],"--apply","--json"]);
    assert.equal(refused.status,5);
    assert.equal(f.calls().length,0);
    const applied=f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]);
    assert.equal(applied.status,0,applied.stdout);
    assert.equal(output(applied).accounts[1].cache_shared_with,fs.realpathSync(f.accounts[0]));
    const count=f.calls().length;
    const off=f.run(["plugin","sync","--mode","per-account","--json"]);
    assert.equal(off.status,0,off.stdout);
    assert.equal(fs.readlinkSync(linked),owner);
    assert.equal(f.calls().length,count,"OFF must not invoke the auto-refreshing Codex CLI");
  } finally { f.cleanup(); }
});
