import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { loadReferenceLibrary, referenceLibraryReport, formatReferenceLibrary } from "../src/reference-library.mjs";
import { hashArtifact } from "../src/integrity.mjs";
import { inspectDistribution } from "../src/distribution.mjs";
import { validateReferencePack, validateUiBowlManualExport } from "../src/reference.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "bin/killsloprouter.mjs");
const library = loadReferenceLibrary();
const all = referenceLibraryReport(library);
const run = (args, cwd = root) => spawnSync(process.execPath, [cli, "reference", "library", ...args], {
  cwd, encoding: "utf8", timeout: 10_000, shell: false, maxBuffer: 2 * 1024 * 1024
});

function copyLibrary(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-research-library-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const files = ["registry/reference-library.json", ...["study", "study_document", "review", "source_index"].map(key => library.index[key].path)];
  for (const file of files) {
    fs.mkdirSync(path.dirname(path.join(directory, file)), { recursive: true });
    fs.copyFileSync(path.join(root, file), path.join(directory, file));
  }
  return directory;
}

function rewriteBound(directory, key, change) {
  const target = path.join(directory, library.index[key].path);
  const value = JSON.parse(fs.readFileSync(target, "utf8"));
  change(value);
  fs.writeFileSync(target, JSON.stringify(value));
  const indexPath = path.join(directory, "registry/reference-library.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  index[key].digest = hashArtifact(target);
  fs.writeFileSync(indexPath, JSON.stringify(index));
}

test("library index and all exact source/review hashes load without promoting research", () => {
  assertPublishedSchema("reference-library", library.index);
  assert.equal(all.status, "research-only");
  assert.deepEqual(all.summary, { matching_components: 14, source_products: 10, ecosystems: 5,
    unique_source_frames: 30, anatomy_parts: 89, proposed_target_checks: 65,
    source_behavior_executions: 0, source_responsive_pairs: 0, ready_reference_packs: 0 });
  assert.equal(all.entries.some(entry => Object.hasOwn(entry, "analysis")), false);
  assert.equal(all.order, "study-order-not-fit-or-popularity-ranking");
  assert.equal(all.review.formal_reference_cli_review, false);
  assert.equal(all.review.owner_approval, false);
  for (const flag of ["selection_allowed", "creator_input_approved", "design_ready", "visual_authority_granted", "source_pixels_included"]) assert.equal(all[flag], false);
  assert.match(all.library_digest, /^sha256:[a-f0-9]{64}$/);
  assert.throws(() => validateReferencePack(all));
  assert.throws(() => validateUiBowlManualExport(all));
});

test("task and component searches preserve actual frame scope and source distinctions", () => {
  const briefing = referenceLibraryReport(library, { query: "브리핑" });
  assert.deepEqual(briefing.entries.map(entry => entry.id), ["naverpay-briefing-reader"]);
  const search = referenceLibraryReport(library, { query: "검색/탭" });
  assert.deepEqual(search.entries.map(entry => entry.id), ["naver-travel-hierarchical-search", "naver-map-web-help-disclosure", "toss-securities-search-palette"]);
  assert.deepEqual(referenceLibraryReport(library, { query: "브리핑".normalize("NFD") }).entries, briefing.entries);
  assert.deepEqual(referenceLibraryReport(library, { query: "ＴＡＢＳ", source: "toss-securities" }).entries.map(entry => entry.id), ["toss-securities-search-palette"]);
  const palette = referenceLibraryReport(library, { component: "mixed-search-palette", details: true });
  assert.equal(palette.summary.unique_source_frames, 1);
  assert.equal(palette.entries[0].observation_scope.basis, "single-static-frame");
  assert.equal(palette.entries[0].analysis.component_recipe.responsive_variants.every(v => v.basis === "target-proposal"), true);
  assert.match(referenceLibraryReport(library, { source: "naver-map-web" }).sources[0].observed_surface, /^support/);
  assert.match(referenceLibraryReport(library, { source: "toss-business" }).sources[0].observed_surface, /^operator/);
  const kakaopay = referenceLibraryReport(library, { source: "kakaopay" });
  assert.equal(kakaopay.summary.matching_components, 2);
  assert.equal(kakaopay.summary.unique_source_frames, 3);
});

test("missing coverage stays empty and filters never invent ranking or source selection", () => {
  for (const filters of [{ query: "의료복약일정" }, { component: "comparison-table" }, { source: "not-in-study" }]) {
    const report = referenceLibraryReport(library, filters);
    assert.equal(report.entries.length, 0);
    assert.equal(report.sources.length, 0);
    assert.equal(report.summary.unique_source_frames, 0);
    assert.equal(report.selection_allowed, false);
    assert.match(report.next_step, /No matching study/);
  }
  for (const filters of [{ out: "invented.json" }, { details: "yes" }, { query: " " }, { query: "/ ," }, { query: "bad\u001bvalue" }, { component: "../escape" }, { source: "네이버" }]) {
    assert.throws(() => referenceLibraryReport(library, filters), error => error.exitCode === 2);
  }
});

test("real CLI is CWD independent, has no profile authority or side effects and rejects mutation flags", (t) => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-library-cwd-"));
  t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  fs.mkdirSync(path.join(cwd, ".killsloprouter"));
  const profile = path.join(cwd, ".killsloprouter", "profile.json");
  fs.writeFileSync(profile, "not a valid profile; lookup must not read this");
  const before = hashArtifact(profile);
  const result = run(["--query", "브리핑", "--json"], cwd);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), referenceLibraryReport(library, { query: "브리핑" }));
  const plain = run(["--component", "mixed-search-palette", "--details"], cwd);
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, formatReferenceLibrary(referenceLibraryReport(library, { component: "mixed-search-palette", details: true })));
  for (const args of [["--out", "state.json"], ["--profile", profile], ["--root", cwd], ["--run", "old.json"], ["--selection", "owner.json"], ["--apply"], ["--dry-run"], ["--details", "--details"], ["--json", "--json"], ["--query"], ["--query", "x", "--query", "y"], ["--format", "yaml"], ["--json", "--format", "text"], ["--unknown", "x"]]) {
    const invalid = run(args, cwd);
    assert.equal(invalid.status, 2, JSON.stringify(args));
    assert.equal(invalid.stdout, "");
  }
  assert.equal(hashArtifact(profile), before);
  assert.deepEqual(fs.readdirSync(cwd), [".killsloprouter"]);
  assert.deepEqual(fs.readdirSync(path.join(cwd, ".killsloprouter")), ["profile.json"]);
});

test("changed study, narrative, review or intake bytes fail before research output", (t) => {
  for (const key of ["study", "study_document", "review", "source_index"]) {
    const directory = copyLibrary(t);
    fs.appendFileSync(path.join(directory, library.index[key].path), "\n");
    assert.throws(() => loadReferenceLibrary(directory), error => error.exitCode === 5 && /digest mismatch/.test(error.message));
  }
});

test("re-sealed manual research cannot claim Owner approval or a ready pack", (t) => {
  for (const [key, change] of [
    ["study", value => { value.design_ready = true; }],
    ["study", value => { value.rights.creator_pixel_access = true; }],
    ["study", value => { value.counts.source_behavior_executions = 1; }],
    ["review", value => { value.boundaries.owner_approval = true; }],
    ["review", value => { value.must_fix_remaining = ["unresolved"]; }],
    ["review", value => { value.reviewed_artifacts[0].digest = `sha256:${"0".repeat(64)}`; }]
  ]) {
    const directory = copyLibrary(t);
    rewriteBound(directory, key, change);
    assert.throws(() => loadReferenceLibrary(directory), error => error.exitCode === 5);
  }
});

test("library rejects path escapes, missing membership, symlink and hardlink evidence", (t) => {
  for (const mutate of [
    index => { index.study.path = "../../outside.json"; },
    index => { index.entries.push(index.entries[0]); },
    index => { index.entries.pop(); },
    index => { index.creator_input_approved = true; }
  ]) {
    const directory = copyLibrary(t);
    const file = path.join(directory, "registry/reference-library.json");
    const index = JSON.parse(fs.readFileSync(file, "utf8"));
    mutate(index);
    fs.writeFileSync(file, JSON.stringify(index));
    assert.throws(() => loadReferenceLibrary(directory), error => error.exitCode === 5);
  }
  for (const kind of ["symlink", "hardlink"]) {
    const directory = copyLibrary(t);
    const file = path.join(directory, library.index.study.path);
    const original = `${file}.original`;
    fs.renameSync(file, original);
    if (kind === "symlink") fs.symlinkSync(original, file);
    else fs.linkSync(original, file);
    assert.throws(() => loadReferenceLibrary(directory), error => error.exitCode === 5);
  }
});

test("detailed output stays path/pixel-free and package capability advertises only bundled lookup", () => {
  const detailed = referenceLibraryReport(library, { details: true });
  assert.doesNotMatch(JSON.stringify(detailed), /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/);
  assert.equal(detailed.entries.length, 14);
  assert.equal(detailed.entries.every(entry => entry.analysis.component_recipe), true);
  const capability = inspectDistribution().features.find(feature => feature.id === "reference-research-library");
  assert.equal(capability.status, "available");
  assert.ok(capability.evidence.every(item => item.digest));
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /reference library/);
});
