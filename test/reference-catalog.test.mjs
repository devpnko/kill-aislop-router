import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv from "ajv/dist/2020.js";
import { catalogReport, loadCatalog } from "../scripts/reference-catalog.mjs";
import { validateReferencePack, validateUiBowlManualExport } from "../src/reference.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const { catalog, catalog_digest } = loadCatalog();
const read = (file) => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const schema = read("schemas/reference-candidate-catalog.schema.json");
const validate = new Ajv({ allErrors: true, strict: false }).compile(schema);
const cli = path.join(root, "scripts/reference-catalog.mjs");

test("catalog schema loads alongside every published 2020-12 reference contract", () => {
  assertPublishedSchema("reference-candidate-catalog", catalog);
  assertPublishedSchema("uibowl-manual-export", read("examples/reference-evidence/ui-bowl-manual-export.json"));
});

test("candidate catalog has explicit evidence levels, pinned studies and no ready pack claims", () => {
  assert.equal(validate(catalog), true, JSON.stringify(validate.errors));
  assert.match(catalog_digest, /^sha256:[a-f0-9]{64}$/);
  const report = catalogReport(catalog);
  assert.equal(report.summary.candidate_count, 30);
  assert.equal(report.families.length, 14);
  assert.deepEqual(report.summary.by_evidence_level, {
    "historical-summary": 17, "study-listed": 7, "historical-frame-notes": 6
  });
  assert.equal(report.summary.historical_frame_link_count, 19);
  assert.equal(report.summary.fresh_source_frames_inspected, 0);
  assert.equal(report.summary.ready_reference_packs, 0);
  assert.equal(report.selection_allowed, false);
  assert.equal(report.design_ready, false);
});

test("candidate IDs, ecosystems and all research facets close over their inventories", () => {
  for (const inventory of [catalog.entries, catalog.families, catalog.studies, catalog.discovery_routes, catalog.collection_backlog]) {
    assert.equal(new Set(inventory.map((item) => item.id)).size, inventory.length);
  }
  const components = new Set(catalog.families.flatMap((family) => family.component_families));
  for (const entry of catalog.entries) {
    const study = catalog.studies.find((item) => item.id === entry.study_id);
    assert.ok(study);
    assert.equal(entry.observed_on, study.observed_on);
    assert.ok(entry.family_ids.every((id) => catalog.families.some((family) => family.id === id)));
    assert.ok(entry.component_families.every((id) => components.has(id)), entry.id);
    assert.equal(entry.last_revalidated_on, null);
  }
  for (const family of catalog.families) {
    assert.ok(family.discovery_route_ids.every((id) => catalog.discovery_routes.some((route) => route.id === id)));
    if (family.catalog_coverage === "gap") assert.equal(catalog.entries.filter((entry) => entry.family_ids.includes(family.id)).length, 0);
  }
  for (const item of catalog.collection_backlog) assert.ok(item.family_ids.every((id) => catalog.families.some((family) => family.id === id)));
  assert.equal(catalog.entries.find((entry) => entry.id === "toss-pos").ecosystem,
    catalog.entries.find((entry) => entry.id === "toss-business").ecosystem);
  assert.ok(catalogReport(catalog).summary.ecosystem_count < catalog.entries.length);
});

test("historical frame IDs preserve exact subject membership without inventing captured bytes", () => {
  const source = read("docs/research/ui-bowl-task-design-samples-2026-09-10.json");
  const entries = catalog.entries.filter((entry) => entry.evidence_level === "historical-frame-notes");
  assert.equal(entries.length, source.products.length);
  const ids = [];
  for (const entry of entries) {
    const product = source.products.find((item) => item.id === entry.id);
    assert.ok(product);
    assert.deepEqual(entry.frames, product.frames.map((frame) => ({
      id: frame.id, url: frame.url, role: frame.role, recorded_state: frame.state_observed
    })));
    for (const frame of entry.frames) {
      assert.equal(new URL(frame.url).searchParams.get("imgId"), frame.id);
      ids.push(frame.id);
    }
  }
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of catalog.entries.filter((item) => item.study_id === "study-20260904")) {
    assert.deepEqual(entry.frames, []);
    assert.equal(entry.source_locator_kind, "study-index-only");
  }
});

test("missing reading coverage stays a gap instead of falling back to a dashboard theme", () => {
  for (const family of ["news-reading", "knowledge-search", "public-access"]) {
    const report = catalogReport(catalog, { family });
    assert.deepEqual(report.entries, []);
    assert.equal(report.families[0].catalog_coverage, "gap");
    assert.ok(report.discovery_routes.length > 0);
    assert.ok(report.collection_backlog.length > 0);
    assert.equal(report.design_ready, false);
  }
});

test("task, component, device and Korean queries narrow candidates without ranking or selection", () => {
  assert.deepEqual(catalogReport(catalog, { component: "comparison-table" }).entries.map((entry) => entry.id), ["cardgorilla-web"]);
  assert.deepEqual(catalogReport(catalog, { query: "카드고릴라" }).entries.map((entry) => entry.id), ["cardgorilla-web"]);
  assert.equal(catalogReport(catalog, { platform: "mobile" }).entries.length, 13);
  assert.equal(catalogReport(catalog, { platform: "desktop" }).entries.length, 17);
  assert.equal(catalogReport(catalog, { family: "comparison", platform: "mobile" }).entries.length, 0);
  assert.equal(catalogReport(catalog, { query: "no-such-reference-zzz" }).entries.length, 0);
  const tabs = catalogReport(catalog, { component: "tabs" });
  for (const entry of tabs.entries) {
    for (const id of entry.family_ids) assert.ok(tabs.families.some((family) => family.id === id));
  }
  assert.throws(() => catalogReport(catalog, { family: "unknown" }), /Unknown family/);
  assert.throws(() => catalogReport(catalog, { component: "unknown" }), /Unknown component/);
  assert.throws(() => catalogReport(catalog, { platform: "watch" }), /Unknown platform/);
});

test("schema rejects promoted authority, invented observations, private captures and numeric popularity", () => {
  const mutations = [
    (copy) => { copy.design_ready = true; },
    (copy) => { copy.visual_authority_granted = true; },
    (copy) => { copy.creator_input_approved = true; },
    (copy) => { copy.rights.redistribution = true; },
    (copy) => { copy.rights.creator_pixel_access = true; },
    (copy) => { copy.rights.cross_project_approval_reuse = true; },
    (copy) => { copy.entries[0].capture_readiness = "ready"; },
    (copy) => { copy.entries[0].responsive_evidence = "observed"; },
    (copy) => { copy.entries[0].raw_value = 0; },
    (copy) => { copy.entries[0].capture_path = "/private/capture.png"; },
    (copy) => { copy.entries.find((entry) => entry.evidence_level === "study-listed").observation = "Invented visual observation"; },
    (copy) => { copy.discovery_routes[0].source_frames_inspected = true; },
  ];
  for (const mutate of mutations) {
    const copy = structuredClone(catalog);
    mutate(copy);
    assert.equal(validate(copy), false);
  }
  for (const flag of ["source_pixels_included", "source_assets_included", "creator_input_approved", "visual_authority_granted", "design_ready"]) {
    const copy = structuredClone(catalog);
    copy[flag] = true;
    assert.throws(() => catalogReport(copy));
  }
});

test("discovery data is rejected by existing reference export and pack validators", () => {
  assert.throws(() => validateUiBowlManualExport(catalog));
  assert.throws(() => validateReferencePack(catalog));
  const serialized = JSON.stringify(catalog);
  assert.doesNotMatch(serialized, /\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/);
  assert.ok(catalog.entries.every((entry) => entry.source_product_id === null));
});

test("real child lookup is CWD independent, writes nothing and fails invalid flags", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-catalog-test-"));
  try {
    const run = (...args) => spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8", timeout: 10_000, shell: false });
    const result = run("--family", "comparison", "--json");
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.catalog_digest, catalog_digest);
    assert.equal(report.summary.candidate_count, 4);
    assert.equal(report.selection_allowed, false);
    for (const args of [["--family"], ["--family", "unknown"], ["--out", "state.json"], ["--json", "--json"], ["--platform", "watch"]]) {
      const invalid = run(...args);
      assert.equal(invalid.status, 2, JSON.stringify(args));
      assert.equal(invalid.stdout, "");
    }
    const text = run("--family", "news-reading");
    assert.equal(text.status, 0);
    assert.match(text.stdout, /discovery candidates only \(0\); ready packs: 0/);
    assert.equal(run("--help").status, 0);
    assert.deepEqual(fs.readdirSync(cwd), []);
  } finally {
    fs.rmdirSync(cwd);
  }
});

test("symlink-invoked catalog runs rather than silently exiting with empty output", () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "ksr-catalog-alias-"));
  const alias = path.join(cwd, "lookup.mjs");
  try {
    fs.symlinkSync(cli, alias);
    const result = spawnSync(process.execPath, [alias, "--family", "news-reading", "--json"], {
      cwd, encoding: "utf8", timeout: 10_000, shell: false
    });
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.summary.candidate_count, 0);
    assert.equal(report.catalog_digest, catalog_digest);
  } finally {
    fs.unlinkSync(alias);
    fs.rmdirSync(cwd);
  }
});
