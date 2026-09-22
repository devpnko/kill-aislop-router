import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import { applicationMapReport, assertApplicationMap, loadApplicationMap } from "../scripts/reference-application-map.mjs";
import { catalogReport, loadCatalog } from "../scripts/reference-catalog.mjs";
import { validateComponentRecipe } from "../src/component-recipes.mjs";
import { validateReferencePack, validateUiBowlManualExport } from "../src/reference.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const cli = path.join(root, "scripts/reference-application-map.mjs");
const { map, map_digest } = loadApplicationMap();
const schema = JSON.parse(fs.readFileSync(path.join(root, "schemas/reference-application-map.schema.json"), "utf8"));
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);

test("part map is schema-valid original research with eight unique inspected frames, not nine approvals", () => {
  assertPublishedSchema("reference-application-map", map);
  assert.equal(validate(map), true, JSON.stringify(validate.errors));
  const report = applicationMapReport(map);
  assert.deepEqual(report.summary, { matching_parts: 9, studied_parts: 8, gap_parts: 1,
    source_products: 5, visually_inspected_frames: 8, source_interactions_executed: 0, source_mobile_frames: 0, ready_reference_packs: 0 });
  assert.equal(report.selection_allowed, false);
  assert.equal(report.creator_input_approved, false);
  assert.match(map_digest, /^sha256:[a-f0-9]{64}$/);
});

test("part evidence closes over actual frame IDs and never multiplies counts when a frame supports several parts", () => {
  assert.equal(assertApplicationMap(map), map);
  const reader = applicationMapReport(map, { part: "source-reader" });
  assert.deepEqual(reader.sources.map(source => source.id), ["clovanote", "facticity"]);
  assert.equal(reader.summary.visually_inspected_frames, 3);
  assert.equal(applicationMapReport(map, { part: "comparison-table" }).summary.visually_inspected_frames, 2);
  for (const mutate of [
    copy => { copy.parts[0].observations[0].frame_id = "invented"; },
    copy => { copy.sources[0].frames[0].url = "https://uibowl.io/website?imgId=wrong"; },
    copy => { copy.sources.push(structuredClone(copy.sources[0])); },
    copy => { copy.parts.push(structuredClone(copy.parts[0])); },
    copy => { copy.sources[0].frames[0].capture_digest = "unverified"; }
  ]) {
    const copy = structuredClone(map);
    mutate(copy);
    assert.throws(() => assertApplicationMap(copy));
  }
});

test("gaps, hypotheses, concrete craft and exclusion constraints survive lookup", () => {
  const mobile = applicationMapReport(map, { part: "responsive-layout" });
  assert.equal(mobile.summary.gap_parts, 1);
  assert.equal(mobile.summary.visually_inspected_frames, 0);
  assert.deepEqual(mobile.sources, []);
  assert.equal(mobile.parts[0].target_craft, null);
  for (const part of map.parts.filter(item => item.coverage === "bounded-study")) {
    assert.deepEqual(Object.keys(part.target_craft), ["anatomy", "material", "edge", "depth", "type", "spacing", "color", "imagery", "motion"]);
    assert.ok(part.rationale_hypothesis && part.exclude.length && part.target_states.length && part.validation.length);
    assert.match(part.responsive_proposal, /^Target proposal:/);
  }
  assert.equal(applicationMapReport(map, { query: "비교표" }).parts[0].id, "comparison-table");
  assert.equal(applicationMapReport(map, { query: "no-such-part-zzz" }).summary.matching_parts, 0);
  assert.throws(() => applicationMapReport(map, { part: "unknown" }), /Unknown part/);
});

test("schema and runtime guard refuse authority, rights or executed-source promotion", () => {
  for (const mutate of [
    copy => { copy.creator_input_approved = true; },
    copy => { copy.visual_authority_granted = true; },
    copy => { copy.design_ready = true; },
    copy => { copy.source_pixels_included = true; },
    copy => { copy.rights.redistribution = true; },
    copy => { copy.rights.creator_pixel_access = true; },
    copy => { copy.rights.license_grant = true; },
    copy => { copy.rights.cross_project_approval_reuse = true; },
    copy => { copy.sources[0].frames[0].interaction = "executed"; },
    copy => { copy.sources[0].frames[0].responsive = "observed"; },
    copy => { copy.sources[0].frames[0].capture_bundled = true; },
    copy => { copy.parts.at(-1).observations = structuredClone(copy.parts[0].observations); },
    copy => { copy.parts[0].target_craft = null; }
  ]) {
    const copy = structuredClone(map);
    mutate(copy);
    assert.equal(validate(copy), false);
    assert.throws(() => applicationMapReport(copy));
  }
});

test("private pixels and approval fields are rejected by both schema and runtime lookup", () => {
  for (const mutate of [
    copy => { copy.capture_path = "/private/source.png"; },
    copy => { copy.sources[0].frames[0].pixels = "data:image/png;base64,AAAA"; },
    copy => { copy.parts[0].owner_approved = true; },
    copy => { copy.sources[0].popularity_rank = 1; },
    copy => { copy.parts[0].observations[0].capture_path = "/private/source.png"; },
    copy => { copy.search_record.creator_approved = true; },
    copy => { copy.search_record.excluded_leads[0].pixels = "data:image/png;base64,AAAA"; }
  ]) {
    const copy = structuredClone(map);
    mutate(copy);
    assert.equal(validate(copy), false);
    assert.throws(() => applicationMapReport(copy));
  }
  assert.doesNotMatch(JSON.stringify(map), /\/Users\/|\/tmp\/|data:image|cloudfront\.net|\.png|\.jpe?g|Bearer\s/);
});

test("research map cannot substitute for export, ready pack or executable component recipe", () => {
  assert.throws(() => validateUiBowlManualExport(map));
  assert.throws(() => validateReferencePack(map));
  assert.throws(() => validateComponentRecipe(map));
  const historical = catalogReport(loadCatalog().catalog);
  assert.equal(historical.summary.fresh_source_frames_inspected, 0);
  assert.equal(historical.summary.historical_frame_link_count, 19);
  assert.equal(historical.summary.ready_reference_packs, 0);
});

test("offline real child lookup is CWD independent, read-only and rejects unknown/missing/duplicate flags", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-part-map-"));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 10_000, shell: false });
    const result = run("--part", "comparison-table", "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.map_digest, map_digest);
    assert.equal(report.summary.source_products, 1);
    assert.equal(report.design_ready, false);
    for (const args of [["--part"], ["--part", "unknown"], ["--out", "state.json"], ["--json", "--json"], ["--execute"]]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 2, JSON.stringify(args));
      assert.equal(invalid.stdout, "");
    }
    assert.match(run("--part", "responsive-layout").stdout, /Source mobile\/interaction proof: 0/);
    assert.equal(run("--help").status, 0);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally { fs.rmdirSync(cwd); }
});

test("symlink invocation produces an identical non-authoritative report", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-part-map-alias-"));
  const alias = path.join(cwd, "parts.mjs");
  try {
    fs.symlinkSync(cli, alias);
    const result = spawnSync(process.execPath, [alias, "--part", "responsive-layout", "--json"], { cwd, encoding: "utf8", timeout: 10_000, shell: false });
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { ...applicationMapReport(map, { part: "responsive-layout" }), map_digest });
  } finally { fs.unlinkSync(alias); fs.rmdirSync(cwd); }
});
