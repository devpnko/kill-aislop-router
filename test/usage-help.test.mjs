import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { bootstrapProject } from "../src/bootstrap.mjs";
import { canonicalDigest, hashArtifact } from "../src/integrity.mjs";
import { automationGuidance } from "../src/usage-guidance.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const router = JSON.parse(fs.readFileSync(path.join(root, "router/default-router.json"), "utf8"));

function fixture(t) {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ksr-usage-")));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const caller = path.join(directory, "caller");
  const target = path.join(directory, "target with 'quote' and $literal");
  fs.mkdirSync(caller);
  fs.mkdirSync(target);
  const createProfile = (projectRoot, projectId) => bootstrapProject({
    router, root: projectRoot, projectId, locale: "ko-KR", surface: "operator-product-ui"
  });
  const run = (args, cwd = caller) => spawnSync(process.execPath, [cli, ...args], {
    cwd, encoding: "utf8", timeout: 30_000, maxBuffer: 4 * 1024 * 1024
  });
  const doctor = (args = [], cwd = caller) => run(["doctor", "--home", directory, "--json", ...args], cwd);
  return { directory, caller, target, createProfile, run, doctor };
}

function approvedFixture(target) {
  // Public documentation fixtures only; never an approval for a real project.
  const config = path.join(target, ".killsloprouter");
  fs.cpSync(path.join(root, "examples"), config, { recursive: true });
  const profile = JSON.parse(fs.readFileSync(path.join(config, "project-profile.example.json"), "utf8"));
  fs.writeFileSync(path.join(config, "profile.json"), JSON.stringify(profile));
  const artifact = path.join(target, "artifact.html");
  fs.writeFileSync(artifact, "<!doctype html><button>Fixture only</button>\n");
  return { config, artifact, profilePath: path.join(config, "profile.json") };
}

function treeBytes(directory) {
  // Unlike an artifact directory digest, this includes .killsloprouter itself.
  return fs.readdirSync(directory).sort().map((name) => {
    const target = path.join(directory, name);
    return [name, fs.statSync(target).isDirectory() ? treeBytes(target) : hashArtifact(target)];
  });
}

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
  assert.ok(bare.stdout.includes(path.join(root, "docs/project-setup.md")));
  assert.doesNotMatch(bare.stdout, /blob\/feat\//);
});

test("explicit --root selects that project's profile, not the invoking project", (t) => {
  const f = fixture(t);
  f.createProfile(f.caller, "caller-project");
  f.createProfile(f.target, "target-project");
  const before = [treeBytes(f.caller), treeBytes(f.target)];
  const result = f.doctor(["--root", f.target]);
  assert.equal(result.status, 5, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.project_id, "target-project");
  assert.equal(report.profile_path, path.join(f.target, ".killsloprouter/profile.json"));
  assert.equal(report.surface_boundary.project_root, f.target);
  assert.deepEqual([treeBytes(f.caller), treeBytes(f.target)], before);
});

test("explicit --root does not inherit an enclosing project's profile", (t) => {
  const f = fixture(t);
  f.createProfile(f.caller, "parent-project");
  const nested = path.join(f.caller, "new-project");
  fs.mkdirSync(nested);
  const result = f.doctor(["--root", nested]);
  assert.equal(result.status, 5, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.profile_path, null);
  assert.equal(report.project_id, null);
  assert.equal(report.next_required_command, "killsloprouter bootstrap");
  assert.equal(report.next_actions[0].id, "bootstrap-project");
  assert.deepEqual(report.next_actions[0].required_inputs, ["project-id", "locale", "surface"]);
  assert.deepEqual(fs.readdirSync(nested), []);
});

test("implicit discovery still finds the containing project and explicit --profile wins", (t) => {
  const f = fixture(t);
  f.createProfile(f.caller, "explicit-project");
  f.createProfile(f.target, "other-project");
  const nested = path.join(f.caller, "src");
  fs.mkdirSync(nested);
  assert.equal(JSON.parse(f.doctor([], nested).stdout).project_id, "explicit-project");
  const result = f.doctor([
    "--root", f.target, "--profile", path.join(f.caller, ".killsloprouter/profile.json")
  ]);
  assert.equal(JSON.parse(result.stdout).project_id, "explicit-project");
});

test("explicit --root must exist and be a directory", (t) => {
  const f = fixture(t);
  for (const target of [path.join(f.target, "missing"), path.join(root, "README.md")]) {
    const result = f.doctor(["--root", target]);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.match(result.stderr, /--root must be an existing directory/);
  }
});

test("doctor orders unresolved setup actions without claiming adapter execution", (t) => {
  const f = fixture(t);
  f.createProfile(f.target, "unresolved-project");
  const result = f.doctor(["--root", f.target]);
  assert.equal(result.status, 5, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.deepEqual(report.next_actions.map((action) => action.id), [
    "visual-intent", "visual-signature", "execution-preflight"
  ]);
  assert.equal(report.execution_readiness, "not_evaluated_use_integrated_dry_run");
  assert.equal(report.completion_eligible, false);
  assert.match(report.next_actions[2].instruction, /not run/);
});

test("an entrypoint conflict is reported before project bootstrap, without migration", (t) => {
  const f = fixture(t);
  const legacy = path.join(f.directory, ".codex/skills/kill-slop-router");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "SKILL.md"), "Legacy fixture entry; not an approved shim.\n");
  const before = treeBytes(f.directory);
  const result = f.doctor(["--root", f.target]);
  assert.equal(result.status, 5, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.next_actions[0].id, "entrypoint-conflict");
  assert.equal(report.next_actions[1].id, "bootstrap-project");
  assert.deepEqual(treeBytes(f.directory), before);
});

test("configured doctor still requires separate host and browser preflight", (t) => {
  const f = fixture(t);
  approvedFixture(f.target);
  const result = f.doctor(["--root", f.target]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, "automation-ready");
  assert.equal(report.completion_eligible, false);
  assert.equal(report.next_required_command, "killsloprouter run --dry-run");
  assert.deepEqual(report.next_actions.map((action) => action.id), ["execution-preflight"]);
});

test("plan and integrated dry-run discover only the explicit project root", (t) => {
  const f = fixture(t);
  f.createProfile(f.caller, "unrelated-project");
  const { artifact } = approvedFixture(f.target);
  let plan;
  for (const command of [["plan"], ["run", "--dry-run"]]) {
    const result = f.run([
      ...command, "--root", f.target, "--task", "audit", "--direction", "none",
      "--scope", "source", "--artifact", artifact, "--json"
    ]);
    const report = JSON.parse(result.stdout);
    if (command[0] === "plan") {
      assert.equal(report.project_id, "example-product", result.stderr);
      plan = report;
    } else {
      assert.equal(result.status, 6, result.stderr);
      assert.equal(report.plan.plan_digest, canonicalDigest(plan));
      assert.ok(report.host_readiness.every((item) => item.execution_status === "manual_pending"));
    }
  }
});

test("host and browser configuration cannot fall back to the caller's profile", (t) => {
  const f = fixture(t);
  f.createProfile(f.caller, "untouched-caller");
  const before = treeBytes(f.caller);
  for (const command of [
    ["host", "configure-codex", "--runtime", process.execPath, "--model", "fixture-only"],
    ["browser", "configure", "--base-url", "http://127.0.0.1:1", "--required-scenarios", "fixture"]
  ]) {
    const result = f.run([...command, "--root", f.target]);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /requires a project profile/);
  }
  assert.deepEqual(treeBytes(f.caller), before);
  assert.deepEqual(fs.readdirSync(f.target), []);
});

test("dry-run text distinguishes pending adapters and browser prerequisites from execution", (t) => {
  const f = fixture(t);
  const { artifact } = approvedFixture(f.target);
  const before = treeBytes(f.target);
  const result = f.run([
    "run", "--dry-run", "--root", f.target, "--task", "audit", "--direction", "none",
    "--scope", "runtime", "--artifact", artifact
  ]);
  assert.equal(result.status, 6, result.stderr);
  assert.match(result.stdout, /reviewers: not executed \(dry-run only\)/);
  assert.match(result.stdout, /next: Connect the pending authorized adapters/);
  assert.match(result.stdout, /official Playwright child/);
  assert.doesNotMatch(result.stdout, /resume after resolving/);
  assert.deepEqual(treeBytes(f.target), before);
});

test("separate CLI invocations resume a manual stop using the caller-retained authority", (t) => {
  const f = fixture(t);
  const { artifact, config, profilePath } = approvedFixture(f.target);
  const statePath = path.join(config, "usage-run.json");
  const started = f.run([
    "run", "--root", f.target, "--task", "audit", "--direction", "none",
    "--scope", "source", "--artifact", artifact, "--out", statePath, "--json"
  ]);
  assert.equal(started.status, 6, started.stderr || started.stdout);
  // Model a later conversation: retain only the original CLI response, not a
  // replacement authority read from mutable state.
  const original = JSON.parse(started.stdout);
  const before = treeBytes(f.target);
  const missingAuthority = f.run(["run", "--resume", statePath]);
  assert.equal(missingAuthority.status, 4, missingAuthority.stderr);
  assert.match(missingAuthority.stderr, /authority/);
  assert.deepEqual(treeBytes(f.target), before);

  const resumed = f.run([
    "run", "--resume", statePath, "--authority-digest", original.resume_authority_digest
  ]);
  assert.equal(resumed.status, 6, resumed.stderr || resumed.stdout);
  assert.match(resumed.stdout, /orchestrator: KillSlopRouter/);
  assert.match(resumed.stdout, /adapter attempts: 0 ran; 0 manual_recorded;/);
  assert.match(resumed.stdout, /next: Supply the pending authorized adapters/);
  assert.match(resumed.stdout, /resume after resolving the stop:/);
  assert.ok(resumed.stdout.includes(`resume after resolving the stop: ${process.execPath} ${cli} run `));
  assert.match(resumed.stdout, /Never reconstruct it from the state being verified/);
  assert.ok(resumed.stdout.includes(original.resume_authority_digest));
  const retained = JSON.parse(fs.readFileSync(statePath, "utf8"));
  assert.equal(retained.run_id, original.run_id);
  assert.deepEqual(retained.journey_identity, original.journey_identity);
  assert.deepEqual(retained.attempts, original.attempts);
  assert.equal(fs.existsSync(`${statePath}.lease`), false);

  // The readability changes must not hide tamper or rewrite old authority.
  fs.appendFileSync(profilePath, "\n");
  const beforeTamperResume = treeBytes(f.target);
  const rejected = f.run([
    "run", "--resume", statePath, "--authority-digest", original.resume_authority_digest
  ]);
  assert.equal(rejected.status, 4, rejected.stderr);
  assert.match(rejected.stderr, /profile changed/);
  assert.doesNotMatch(rejected.stdout, /resume after resolving/);
  assert.deepEqual(treeBytes(f.target), beforeTamperResume);
});

test("presentation preserves triage, adjudication, owner, blocked and completed stops", () => {
  const cases = [
    [{ status: "manual_pending", steps: { "scanner-triage": { status: "manual_pending" } } }, /--triage/],
    [{ status: "manual_pending", steps: { "conflict-adjudication": { status: "manual_pending" } } }, /independent adjudication/],
    [{ status: "manual_pending", final_audit_status: "critic_pass_owner_review_pending" }, /real Owner.*--approval/],
    [{ status: "blocked" }, /never re-sign.*auto-retry/],
    [{ status: "complete" }, /not permission to redesign, deploy, or systemize/]
  ];
  for (const [state, expected] of cases) {
    const before = structuredClone(state);
    assert.match(automationGuidance(state).join("\n"), expected);
    assert.deepEqual(state, before);
  }
  const text = automationGuidance({
    status: "manual_pending",
    attempts: [
      { execution_status: "ran" }, { execution_status: "manual_recorded" },
      { execution_status: "manual_pending" }, { execution_status: "abandoned_after_crash" }
    ]
  }).join("\n");
  assert.match(text, /1 ran; 1 manual_recorded; 1 manual_pending; 1 failed\/unknown/);
});

test("displayed POSIX resume arguments preserve spaces and shell metacharacters literally", () => {
  const state = {
    status: "manual_pending", state_path: "/fixture/a 'quote' $(false) `false`/state.json",
    resume_authority_digest: `sha256:${"a".repeat(64)}`
  };
  const host = "/fixture/host with 'quotes' $literal.json";
  const line = automationGuidance(state, { hostConfig: host })
    .find((item) => item.startsWith("resume after resolving the stop:"));
  // Feed the displayed arguments to a shell function, not a Router/model run.
  // Any expansion changes argv and fails the comparison; no file is executed.
  const command = line.slice("resume after resolving the stop: ".length);
  const result = spawnSync("/bin/sh", ["-c", `killsloprouter() { printf '%s\\n' "$@"; }\n${command}`], {
    encoding: "utf8", timeout: 5_000
  });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.stdout.trimEnd().split("\n"), [
    "run", "--resume", state.state_path, "--authority-digest", state.resume_authority_digest,
    "--host-config", host
  ]);
});
