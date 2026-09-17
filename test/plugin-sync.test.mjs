import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { canonicalDigest } from "../src/integrity.mjs";
import { readPluginSyncPolicy, withPluginSyncTransaction } from "../src/plugin-sync.mjs";

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
  const loseLock=path.join(account,"replace-lock-on-list");
  const loseAfterAdd=path.join(account,"replace-lock-after-add");
  if (fs.existsSync(loseLock) || (fs.existsSync(loseAfterAdd) && fs.existsSync(record))) {
    const lock=path.join(home,".killsloprouter/plugin-sync.lock");
    fs.writeFileSync(lock+".replacement","fixture-replacement-owner");
    fs.renameSync(lock+".replacement",lock);
  }
  if (fs.existsSync(path.join(account,"change-policy-on-list"))) {
    const config=path.join(home,".killsloprouter/plugin-sync.json");
    const policy=JSON.parse(fs.readFileSync(config));
    fs.writeFileSync(config,JSON.stringify({...policy,mode:"per-account"}));
  }
  if (fs.existsSync(path.join(account,"refresh-on-list"))) {
    fs.cpSync(source,path.join(account,"plugins/cache/personal/killsloprouter",version),{recursive:true});
  }
  console.log(JSON.stringify({installed:fs.existsSync(record)?[JSON.parse(fs.readFileSync(record))]:[]}));
} else process.exit(8);
`, { mode: 0o700 });
  const run = (args, environment = {}) => spawnSync(process.execPath, [cli, ...args], {
    cwd: home, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, HOME: home, USERPROFILE: home, CODEX_HOME: accounts[2],
      PATH: `${bin}${path.delimiter}${process.env.PATH}`, KSR_SYNC_FIXTURE_HOME: home, ...environment }
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

function copyHook(f, body) {
  const file=path.join(f.home,"copy-hook.cjs");
  fs.writeFileSync(file, `const fs=require("node:fs"), path=require("node:path");
const {spawnSync}=require("node:child_process");
const original=fs.cpSync; let fired=false;
fs.cpSync=function(source,target,...options){
  if(!fired && String(target).includes(".killsloprouter-install-")){
    fired=true;
    ${body}
  }
  return original.call(this,source,target,...options);
};`);
  return {NODE_OPTIONS:`--require ${JSON.stringify(file)}`};
}

test("shared toggle previews without writes, syncs enrolled accounts, and is idempotent", () => {
  const f = fixture();
  try {
    const initial = output(f.run(["plugin","sync","--json"]));
    assert.equal(initial.mode,"shared");
    assert.equal(initial.accounts.length,3);
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

test("default shared installation freezes discovered enrollment and preserves an explicit OFF", () => {
  const f=fixture();
  try {
    const preview=output(f.run(["plugin","install","--force","--dry-run"]));
    assert.equal(preview.account_sync.mode,"shared");
    assert.equal(preview.account_sync.accounts.length,3);
    assert.equal(preview.account_sync.would_apply,true);
    assert.equal(fs.existsSync(f.config),false);
    assert.equal(f.calls().length,0);
    const installed=f.run(["plugin","install","--force"]);
    assert.equal(installed.status,0,installed.stderr || installed.stdout);
    assert.equal(output(installed).activation.status,"synced");
    const policy=JSON.parse(fs.readFileSync(f.config));
    assert.equal(policy.mode,"shared");
    assert.equal(policy.accounts.length,3);
    const extra=path.join(f.home,".codex-accounts/account4");
    fs.mkdirSync(extra); fs.writeFileSync(path.join(extra,"config.toml"),"");
    const count=f.calls().length;
    const again=output(f.run(["plugin","sync","--apply","--json"]));
    assert.equal(again.accounts.length,3);
    assert.equal(again.discovered_accounts.length,4);
    assert.equal(f.calls().slice(count).some((call)=>call.account===extra),false);
    assert.equal(f.run(["plugin","sync","--mode","per-account","--json"]).status,0);
    const off=JSON.parse(fs.readFileSync(f.config));
    assert.equal(off.mode,"per-account");
    const offPreview=output(f.run(["plugin","install","--force","--dry-run"]));
    assert.equal(offPreview.account_sync.mode,"per-account");
    assert.equal(offPreview.account_sync.would_apply,false);
    const reinstalled=f.run(["plugin","install","--force","--no-activate"]);
    assert.equal(reinstalled.status,0,reinstalled.stdout);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.config)),off);
  } finally { f.cleanup(); }
});

test("default shared mode includes an existing custom active home but never creates a missing one", () => {
  const f=fixture();
  try {
    const active=path.join(f.home,"custom-codex");
    fs.mkdirSync(active); fs.writeFileSync(path.join(active,"config.toml"),"");
    const preview=output(f.run(["plugin","sync","--dry-run","--json"],{CODEX_HOME:active}));
    assert.equal(preview.mode,"shared");
    assert.equal(preview.accounts.length,4);
    assert.equal(f.calls().length,0);
    const missing=path.join(f.home,"future-home");
    assert.deepEqual(readPluginSyncPolicy(missing),{plugin_sync_version:1,mode:"shared",accounts:[]});
    assert.equal(fs.existsSync(missing),false);
  } finally { f.cleanup(); }
});

test("default shared mode with no accounts reports enrollment required, never synchronized", () => {
  const f=fixture();
  try {
    for (const account of f.accounts) {
      fs.unlinkSync(path.join(account,"config.toml"));
      fs.unlinkSync(path.join(account,"auth.json"));
    }
    for (const args of [["plugin","sync","--json"],["plugin","sync","--apply","--json"]]) {
      const result=f.run(args);
      assert.equal(result.status,5,result.stderr || result.stdout);
      assert.equal(output(result).mode,"shared");
      assert.equal(output(result).status,"enrollment_required");
      assert.equal(output(result).policy_saved,false);
    }
    assert.equal(fs.existsSync(f.config),false);
    assert.equal(f.calls().length,0);
  } finally { f.cleanup(); }
});

test("default shared discovery recognizes a logged-in home without reading credentials", () => {
  const f=fixture();
  try {
    fs.unlinkSync(path.join(f.accounts[1],"config.toml"));
    fs.chmodSync(path.join(f.accounts[1],"auth.json"),0o000);
    const result=f.run(["plugin","sync","--dry-run","--json"]);
    assert.equal(result.status,5,result.stderr || result.stdout);
    assert.equal(output(result).accounts.length,3);
    assert.equal(output(result).accounts.every((account)=>account.status==="cache_missing"),true);
    assert.equal(f.calls().length,0);
  } finally { f.cleanup(); }
});

test("a policy change during plugin list blocks add and all subsequent account children", () => {
  const f=fixture();
  try {
    fs.writeFileSync(path.join(f.accounts[0],"change-policy-on-list"),"");
    const result=f.run(["plugin","sync","--mode","shared","--discover-accounts","--apply","--json"]);
    assert.equal(result.status,5,result.stdout);
    assert.equal(output(result).status,"blocked");
    assert.deepEqual(f.calls().map((call)=>call.args[1]),["list"],result.stdout);
    assert.match(output(result).accounts[0].error,/policy changed/);
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
    fs.writeFileSync(f.config,JSON.stringify({plugin_sync_version:1,mode:"shared",accounts:[]}));
    const empty=f.run(["plugin","sync","--apply","--json"]);
    assert.notEqual(empty.status,0);
    assert.match(empty.stderr,/at least one enrolled account/);
    assert.equal(f.calls().length,0,"a stored empty policy must not fall back to default discovery");
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

test("installer rejects an existing lease before any canonical, marketplace, shim or account mutation", () => {
  const f=fixture();
  try {
    const lock=path.join(f.home,".killsloprouter/plugin-sync.lock");
    fs.writeFileSync(lock,"fixture-existing-owner");
    const before=fs.statSync(f.target).ino;
    const marketplace=path.join(f.home,".agents/plugins/marketplace.json");
    const marketBytes=fs.readFileSync(marketplace,"utf8");
    const legacy=path.join(f.accounts[0],"skills/kill-slop-router/SKILL.md");
    fs.mkdirSync(path.dirname(legacy),{recursive:true});
    fs.writeFileSync(legacy,"fixture full legacy entry\n");
    for(const flags of [[],["--no-activate"]]) {
      const result=f.run(["plugin","install","--force","--migrate-legacy-entry",...flags]);
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/already locked/);
      assert.equal(fs.statSync(f.target).ino,before);
      assert.equal(fs.readFileSync(marketplace,"utf8"),marketBytes);
      assert.equal(fs.readFileSync(legacy,"utf8"),"fixture full legacy entry\n");
      assert.equal(fs.existsSync(path.join(f.home,"plugins/.killsloprouter-backups")),false);
      assert.equal(fs.existsSync(f.config),false);
      assert.equal(f.calls().length,0);
      assert.equal(fs.readFileSync(lock,"utf8"),"fixture-existing-owner");
    }
  } finally { f.cleanup(); }
});

test("install and enrollment changes serialize under one lease before selecting activation targets", () => {
  const f=fixture();
  try {
    assert.equal(f.run(["plugin","sync","--mode","per-account","--json"]).status,0);
    const before=fs.readFileSync(f.config,"utf8");
    const attempts=path.join(f.home,"concurrent-attempts.json");
    const configure=[cli,"plugin","sync","--mode","shared","--account-home",f.accounts[1],"--json"];
    const install=[cli,"plugin","install","--force","--no-activate"];
    const hooked=copyHook(f, `
      const results=${JSON.stringify([configure,install])}.map(args=>{
        const result=spawnSync(process.execPath,args,{env:{...process.env,NODE_OPTIONS:""},encoding:"utf8"});
        return {status:result.status,stderr:result.stderr};
      });
      fs.writeFileSync(${JSON.stringify(attempts)},JSON.stringify(results));`);
    const result=f.run(["plugin","install","--force"],hooked);
    assert.equal(result.status,0,result.stderr || result.stdout);
    for(const attempt of JSON.parse(fs.readFileSync(attempts))) {
      assert.notEqual(attempt.status,0);
      assert.match(attempt.stderr,/already locked/);
    }
    assert.equal(fs.readFileSync(f.config,"utf8"),before);
    assert.deepEqual(f.calls().filter(call=>call.args[1]==="add").map(call=>call.account),[f.accounts[2]]);
    const saved=f.run(configure.slice(1));
    assert.equal(saved.status,5,saved.stderr || saved.stdout);
    assert.equal(output(saved).policy_saved,true);
    assert.equal(output(saved).status,"sync_required");
    const count=f.calls().length;
    const next=f.run(["plugin","install","--force"]);
    assert.equal(next.status,0,next.stderr || next.stdout);
    assert.deepEqual(output(next).activation.accounts.map(account=>account.account_home),[fs.realpathSync(f.accounts[1])]);
    assert.equal(f.calls().slice(count).every(call=>fs.realpathSync(call.account)===fs.realpathSync(f.accounts[1])),true);
  } finally { f.cleanup(); }
});

test("an out-of-band policy edit during staging blocks publication and stale per-account activation", () => {
  const f=fixture();
  try {
    assert.equal(f.run(["plugin","sync","--mode","per-account","--json"]).status,0);
    const before=fs.statSync(f.target).ino;
    const changed={plugin_sync_version:1,mode:"shared",accounts:[fs.realpathSync(f.accounts[1])]};
    const hooked=copyHook(f,`fs.writeFileSync(${JSON.stringify(f.config)},${JSON.stringify(JSON.stringify(changed))});`);
    const result=f.run(["plugin","install","--force"],hooked);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/policy changed during installation/);
    assert.equal(fs.statSync(f.target).ino,before);
    assert.deepEqual(JSON.parse(fs.readFileSync(f.config)),changed);
    assert.equal(f.calls().length,0);
    assert.equal(fs.existsSync(path.join(f.home,"plugins/.killsloprouter-backups")),false);
  } finally { f.cleanup(); }
});

test("lost lock ownership blocks later children and receipt persistence, including after the last add", () => {
  for(const afterAdd of [false,true]) {
    const f=fixture();
    try {
      const selected=afterAdd ? f.accounts.slice(-1) : f.accounts;
      fs.writeFileSync(path.join(selected[0],afterAdd?"replace-lock-after-add":"replace-lock-on-list"),"");
      const result=f.run(["plugin","sync","--mode","shared",...selected.flatMap(account=>["--account-home",account]),"--apply","--json"]);
      assert.notEqual(result.status,0);
      assert.match(result.stderr,/lock ownership changed/);
      assert.deepEqual(f.calls().map(call=>call.args[1]),afterAdd?["list","add","list"]:["list"]);
      assert.equal(fs.existsSync(path.join(f.home,".killsloprouter/plugin-sync-receipts")),false);
      assert.equal(fs.readFileSync(path.join(f.home,".killsloprouter/plugin-sync.lock"),"utf8"),"fixture-replacement-owner");
    } finally { f.cleanup(); }
  }
});

test("case-equivalent account homes are rejected before a policy can be poisoned", (t) => {
  const f=fixture();
  try {
    const alias=path.join(f.home,".CODEX");
    if(!fs.existsSync(alias)) { t.skip("requires a case-insensitive filesystem"); return; }
    const result=f.run(["plugin","sync","--mode","shared","--account-home",f.accounts[0],"--account-home",alias,"--apply","--json"]);
    assert.notEqual(result.status,0);
    assert.match(result.stderr,/unique/);
    assert.equal(fs.existsSync(f.config),false);
    assert.equal(f.calls().length,0);
    assert.equal(f.run(["plugin","sync","--mode","per-account","--json"]).status,0,"invalid input must not poison later OFF");
  } finally { f.cleanup(); }
});

test("unknown sync options never fall back to shared discovery or change enrollment", () => {
  const f=fixture();
  try {
    for(const option of ["--account-hmoe","--subcommand","--force"]) {
      const result=f.run(["plugin","sync","--mode","shared",option,f.accounts[1],"--apply","--json"]);
      assert.equal(result.status,2,result.stdout);
      assert.match(result.stderr,/unknown plugin sync option/);
      assert.equal(fs.existsSync(f.config),false);
      assert.equal(f.calls().length,0);
      assert.equal(fs.existsSync(path.join(f.home,".killsloprouter/plugin-sync.lock")),false);
    }
  } finally { f.cleanup(); }
});

test("installer-bound sync capability cannot run after the lease is released", () => {
  const f=fixture();
  try {
    let transaction;
    withPluginSyncTransaction(f.home, value=>{ transaction=value; value.verifyLease(); });
    assert.throws(()=>transaction.sync({mode:"per-account"}),/lock ownership changed/);
    assert.equal(fs.existsSync(f.config),false);
    assert.equal(f.calls().length,0);
  } finally { f.cleanup(); }
});
