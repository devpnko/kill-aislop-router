import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const hash = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
const unique = (values) => [...new Set(values)].sort();

// Offline discovery aid only. Never import this data into a creator packet or
// treat this report as a reference result, pack, selection or approval receipt.
export function loadCatalog() {
  const bytes = fs.readFileSync(path.join(packageRoot, "registry/reference-candidates.json"));
  const catalog = JSON.parse(bytes);
  for (const study of catalog.studies) {
    for (const [file, digest] of [[study.path, study.digest], [study.frame_index_path, study.frame_index_digest]]) {
      if (file === null && digest === null) continue;
      assert.match(file, /^docs\/research\/[a-z0-9._-]+\.(md|json)$/);
      assert.equal(hash(fs.readFileSync(path.join(packageRoot, file))), digest, `Study bytes changed: ${file}`);
    }
  }
  return { catalog, catalog_digest: hash(bytes) };
}

export function catalogReport(catalog, filters = {}) {
  assert.equal(catalog.reference_candidate_catalog_version, 1);
  assert.equal(catalog.status, "discovery-only");
  assert.equal(catalog.authority_scope, "non-authoritative-discovery-index");
  for (const flag of ["source_pixels_included", "source_assets_included", "creator_input_approved", "visual_authority_granted", "design_ready"]) {
    assert.equal(catalog[flag], false, `${flag} cannot grant authority`);
  }
  for (const flag of ["redistribution", "creator_pixel_access", "cross_project_approval_reuse"]) {
    assert.equal(catalog.rights[flag], false, `${flag} cannot grant rights`);
  }
  for (const entry of catalog.entries) {
    assert.equal(entry.design_ready, false);
    assert.equal(entry.capture_readiness, "not-bound");
  }
  const components = unique(catalog.families.flatMap((family) => family.component_families));
  if (filters.family && !catalog.families.some((family) => family.id === filters.family)) {
    throw new Error(`Unknown family: ${filters.family}. Use --help or list the catalog.`);
  }
  if (filters.component && !components.includes(filters.component)) throw new Error(`Unknown component: ${filters.component}`);
  if (filters.platform && !["mobile", "desktop"].includes(filters.platform)) throw new Error(`Unknown platform: ${filters.platform}`);
  const query = filters.query?.normalize("NFKC").toLowerCase();
  const entries = catalog.entries.filter((entry) =>
    (!filters.family || entry.family_ids.includes(filters.family)) &&
    (!filters.component || entry.component_families.includes(filters.component)) &&
    (!filters.platform || entry.platform === filters.platform) &&
    (!query || JSON.stringify(entry).normalize("NFKC").toLowerCase().includes(query))
  );
  const families = catalog.families.filter((family) =>
    (!filters.family || family.id === filters.family) &&
    (!filters.component || family.component_families.includes(filters.component) ||
      entries.some((entry) => entry.family_ids.includes(family.id)))
  ).map((family) => ({ ...family, matching_candidate_ids: entries.filter((entry) => entry.family_ids.includes(family.id)).map((entry) => entry.id) }));
  const routeIds = new Set(families.flatMap((family) => family.discovery_route_ids));
  const counts = {};
  for (const entry of entries) counts[entry.evidence_level] = (counts[entry.evidence_level] || 0) + 1;
  return {
    report_kind: "reference-candidate-catalog-not-a-reference-pack",
    orchestrator: "KillSlopRouter", status: "discovery-only", selection_allowed: false,
    creator_input_approved: false, source_pixels_included: false, design_ready: false,
    filters, summary: {
      candidate_count: entries.length, indexed_product_count: unique(entries.map((entry) => entry.id)).length,
      ecosystem_count: unique(entries.map((entry) => entry.ecosystem)).length,
      historical_frame_link_count: unique(entries.flatMap((entry) => entry.frames.map((frame) => frame.id))).length,
      fresh_source_frames_inspected: 0, ready_reference_packs: 0, by_evidence_level: counts,
    },
    families, entries, discovery_routes: catalog.discovery_routes.filter((route) => routeIds.has(route.id)),
    collection_backlog: catalog.collection_backlog.filter((item) => item.family_ids.some((id) => families.some((family) => family.id === id))),
    limits: catalog.limits,
    next_step: "Check project fit; acquire scoped genuine source evidence via permitted UI; complete existing independent reference research/review and real Owner selection. Catalog lookup alone never dispatches a creator.",
  };
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const option = args[index];
    const key = option.replace(/^--/, "");
    if (!option.startsWith("--") || !["family", "component", "platform", "query", "json", "help"].includes(key) || Object.hasOwn(options, key)) {
      throw new Error(`Unknown or repeated option: ${option}`);
    }
    if (["json", "help"].includes(key)) options[key] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value: ${option}`);
      options[key] = value;
    }
  }
  return options;
}

function main() {
  const { json, help, ...filters } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("KillSlopRouter reference candidate catalog (offline; not approved references)\nUsage: node scripts/reference-catalog.mjs [--family ID] [--component ID] [--platform mobile|desktop] [--query TEXT] [--json]\nRun without filters to list family IDs and coverage gaps. No network, capture, selection, state write or creator dispatch occurs.");
    return;
  }
  const { catalog, catalog_digest } = loadCatalog();
  const report = { ...catalogReport(catalog, filters), catalog_digest };
  if (json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`KillSlopRouter — discovery candidates only (${report.summary.candidate_count}); ready packs: 0`);
    for (const family of report.families) console.log(`${family.id}: ${family.label} [${family.catalog_coverage}] (${family.matching_candidate_ids.length} matching candidates)`);
    for (const entry of report.entries) console.log(`- ${entry.name} | ${entry.platform} | ${entry.evidence_level} | ${entry.source_entry_url}`);
    console.log(`Historical frame links: ${report.summary.historical_frame_link_count}; freshly inspected frames: 0. ${report.next_step}`);
  }
}

// Node resolves module URLs physically, including macOS /var -> /private/var.
// Match that identity for npm consumers and symlink-invoked script paths too.
let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* A non-file argv entry means this module was imported. */ }
if (invokedDirectly) {
  try { main(); } catch (error) {
    console.error(`KillSlopRouter catalog: ${error.message}`);
    process.exitCode = 2;
  }
}
