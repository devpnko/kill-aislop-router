import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const mapPath = new URL("../registry/reference-application-map.json", import.meta.url);
const craftKeys = ["anatomy", "material", "edge", "depth", "type", "spacing", "color", "imagery", "motion"];
const uniqueIds = (items, label) => assert.equal(new Set(items.map(item => item.id)).size, items.length, `Duplicate ${label} ID`);
const keys = (value, expected, label) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort(), `${label} has missing or unsupported fields`);
};
const text = value => assert.ok(typeof value === "string" && value.trim(), "Nonempty text required");
const id = value => { text(value); assert.match(value, /^[a-z0-9]+(?:-[a-z0-9]+)*$/); };
const items = (value, minimum = 1) => assert.ok(Array.isArray(value) && value.length >= minimum, "Nonempty array required");
const texts = value => { items(value); value.forEach(text); assert.equal(new Set(value).size, value.length); };
const sourceUrl = value => { text(value); assert.match(value, /^https:\/\/uibowl\.io\/website(?:[/?][^\s]*)?$/); };

// Offline researcher/critic aid, never a creator payload or an approval receipt.
export function loadApplicationMap() {
  const bytes = fs.readFileSync(mapPath);
  const map = JSON.parse(bytes);
  assertApplicationMap(map);
  return { map, map_digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` };
}

export function assertApplicationMap(map) {
  keys(map, ["reference_application_map_version", "id", "status", "audience", "orchestrator",
    "source_pixels_included", "creator_input_approved", "visual_authority_granted", "design_ready",
    "rights", "limits", "sources", "search_record", "shared_rules", "parts"], "map");
  id(map.id);
  assert.equal(map.reference_application_map_version, 1);
  assert.equal(map.status, "research-only");
  assert.equal(map.orchestrator, "KillSlopRouter");
  assert.deepEqual(map.audience, ["internal-researcher", "independent-critic", "owner"]);
  for (const key of ["source_pixels_included", "creator_input_approved", "visual_authority_granted", "design_ready"]) {
    assert.equal(map[key], false, `${key} cannot grant authority`);
  }
  assert.deepEqual(map.rights, { access: "ordinary-public-ui", redistribution: false,
    creator_pixel_access: false, cross_project_approval_reuse: false, license_grant: false });
  texts(map.limits);
  texts(map.shared_rules);
  keys(map.search_record, ["method", "comparisons", "excluded_leads", "stop_reason", "remaining_gaps"], "search record");
  text(map.search_record.method);
  text(map.search_record.stop_reason);
  texts(map.search_record.comparisons);
  texts(map.search_record.remaining_gaps);
  items(map.search_record.excluded_leads, 0);
  for (const lead of map.search_record.excluded_leads) {
    keys(lead, ["url", "reason"], "excluded lead");
    sourceUrl(lead.url);
    text(lead.reason);
  }
  items(map.sources);
  items(map.parts);
  uniqueIds(map.sources, "source");
  uniqueIds(map.parts, "part");
  for (const source of map.sources) {
    keys(source, ["id", "name", "frames"], "source");
    id(source.id);
    text(source.name);
    items(source.frames);
  }
  const frames = map.sources.flatMap(source => source.frames);
  uniqueIds(frames, "frame");
  const frameIds = new Set(frames.map(frame => frame.id));
  for (const frame of frames) {
    keys(frame, ["id", "url", "observed_state", "capture_digest", "evidence_kind", "observed_on",
      "interaction", "responsive", "capture_bundled"], "frame");
    id(frame.id);
    sourceUrl(frame.url);
    text(frame.observed_state);
    assert.match(frame.observed_on, /^\d{4}-\d{2}-\d{2}$/);
    const url = new URL(frame.url);
    assert.equal(url.origin, "https://uibowl.io");
    assert.match(url.pathname, /^\/website(?:\/|$)/);
    assert.equal(url.searchParams.get("imgId"), frame.id, "Frame URL identity mismatch");
    assert.equal(url.searchParams.getAll("imgId").length, 1, "Ambiguous frame URL identity");
    assert.equal(frame.evidence_kind, "archived-ui-image-visually-inspected");
    assert.match(frame.capture_digest, /^sha256:[a-f0-9]{64}$/);
    assert.equal(frame.capture_bundled, false);
    assert.equal(frame.interaction, "not-executed");
    assert.equal(frame.responsive, "not-observed");
  }
  const used = new Set();
  for (const part of map.parts) {
    keys(part, ["id", "label", "job", "coverage", "observations", "rationale_hypothesis", "target_craft",
      "exclude", "target_states", "responsive_proposal", "validation"], "part");
    id(part.id);
    text(part.label);
    text(part.job);
    items(part.observations, 0);
    assert.ok(["bounded-study", "gap"].includes(part.coverage));
    if (part.coverage === "gap") {
      assert.equal(part.observations.length, 0, "A gap cannot claim observations");
      assert.equal(part.target_craft, null);
    } else {
      assert.ok(part.observations.length > 0, "A studied part needs frame-bound observations");
      keys(part.target_craft, craftKeys, "target craft");
      for (const key of craftKeys) text(part.target_craft[key]);
    }
    for (const observation of part.observations) {
      keys(observation, ["frame_id", "facts"], "observation");
      assert.ok(frameIds.has(observation.frame_id), `Unbound observation: ${observation.frame_id}`);
      texts(observation.facts);
      used.add(observation.frame_id);
    }
    for (const key of ["exclude", "target_states", "validation"]) texts(part[key]);
    for (const key of ["rationale_hypothesis", "responsive_proposal"]) text(part[key]);
  }
  assert.equal(used.size, frameIds.size, "Unused frames must not inflate study coverage");
  return map;
}

export function applicationMapReport(map, filters = {}) {
  assertApplicationMap(map);
  if (filters.part && !map.parts.some(part => part.id === filters.part)) throw new Error(`Unknown part: ${filters.part}`);
  const query = filters.query?.normalize("NFKC").toLowerCase();
  const parts = map.parts.filter(part => (!filters.part || part.id === filters.part) &&
    (!query || JSON.stringify(part).normalize("NFKC").toLowerCase().includes(query)));
  const frameIds = new Set(parts.flatMap(part => part.observations.map(observation => observation.frame_id)));
  const sources = map.sources.map(source => ({ ...source, frames: source.frames.filter(frame => frameIds.has(frame.id)) }))
    .filter(source => source.frames.length);
  return {
    report_kind: "part-reference-research-not-a-reference-pack", orchestrator: "KillSlopRouter", status: "research-only",
    selection_allowed: false, creator_input_approved: false, design_ready: false, source_pixels_included: false,
    filters, summary: { matching_parts: parts.length, studied_parts: parts.filter(part => part.coverage === "bounded-study").length,
      gap_parts: parts.filter(part => part.coverage === "gap").length, source_products: sources.length,
      visually_inspected_frames: frameIds.size, source_interactions_executed: 0, source_mobile_frames: 0, ready_reference_packs: 0 },
    parts, sources, rights: map.rights, shared_rules: map.shared_rules, search_record: map.search_record, limits: map.limits,
    next_step: "Resolve project task/authority; revalidate fitting sources and gaps; use existing independent reference review, real Owner selection and aliased recipe delivery. This lookup never dispatches or approves."
  };
}

function main() {
  const options = {};
  const args = process.argv.slice(2);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!["--part", "--query", "--json", "--help"].includes(flag) || Object.hasOwn(options, flag)) throw new Error(`Unknown or repeated option: ${flag}`);
    if (["--json", "--help"].includes(flag)) options[flag] = true;
    else {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`Missing value: ${flag}`);
      options[flag] = value;
    }
  }
  if (options["--help"]) {
    console.log("KillSlopRouter part reference map (offline; research only)\nUsage: node scripts/reference-application-map.mjs [--part ID] [--query TEXT] [--json]\nRun without filters to list parts. No capture, selection, state write, creator dispatch or approval.");
    return;
  }
  const { map, map_digest } = loadApplicationMap();
  const filters = Object.fromEntries(["part", "query"].filter(key => options[`--${key}`]).map(key => [key, options[`--${key}`]]));
  const report = { ...applicationMapReport(map, filters), map_digest };
  if (options["--json"]) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`KillSlopRouter — part research only; ${report.summary.visually_inspected_frames} frames; ready packs: 0`);
    for (const part of report.parts) {
      console.log(`\n${part.id}: ${part.label} [${part.coverage}]\nTask: ${part.job}\nProposal: ${part.rationale_hypothesis}`);
      console.log(`Do not transfer: ${part.exclude.join(" ")}`);
    }
    for (const source of report.sources) for (const frame of source.frames) console.log(`- ${source.name} | ${frame.url}`);
    console.log(`\nSource mobile/interaction proof: 0. Use --json for craft, states and validation details. ${report.next_step}`);
  }
}

let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1]) &&
    fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url));
} catch { /* Imported from a non-file entry point. */ }
if (invokedDirectly) {
  try { main(); } catch (error) {
    console.error(`KillSlopRouter part map: ${error.message}`);
    process.exitCode = 2;
  }
}
