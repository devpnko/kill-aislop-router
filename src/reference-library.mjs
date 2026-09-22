import path from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalDigest, readFilePinned, readJsonPinned } from "./integrity.mjs";
import { validateComponentRecipe } from "./component-recipes.mjs";
import { RouterError } from "./router.mjs";

const packageRoot = fileURLToPath(new URL("../", import.meta.url));
const manifestPath = "registry/reference-library.json";
const artifactKeys = ["study", "study_document", "review", "source_index"];
const audience = ["internal-researcher", "independent-critic", "owner"];
const keywordBasis = "curator-search-facets-not-verified-fit-rank-or-owner-selection";
const noAuthority = ["design_ready", "creator_input_approved", "visual_authority_granted", "source_pixels_included", "source_assets_included"];
const need = (condition, message) => {
  if (!condition) throw new RouterError(`reference library: ${message}`, 5);
};
const same = (left, right) => canonicalDigest(left) === canonicalDigest(right);
function shape(value, expected, label) {
  need(value && typeof value === "object" && !Array.isArray(value) &&
    same(Object.keys(value).sort(), [...expected].sort()), `${label} has missing or unsupported fields`);
}
function distinct(values, label) {
  need(Array.isArray(values) && new Set(values).size === values.length, `duplicate ${label}`);
}
function safeText(value) {
  return typeof value === "string" && value.trim().length > 0 && !/[\u0000-\u001f\u007f]/u.test(value);
}

// Fixed package-local input only. CLI callers cannot supply a manifest, profile,
// artifact root or arbitrary path. The optional root is for package parity tests.
export function loadReferenceLibrary(root = packageRoot) {
  try {
    const pinnedIndex = readJsonPinned(path.join(root, manifestPath), {
      label: "reference library index", requireCallerOwned: false, requireSingleLink: true
    });
    const index = pinnedIndex.input;
    shape(index, ["reference_library_version", "status", "audience", ...artifactKeys, "keyword_basis", "entries"], "index");
    need(index.reference_library_version === 1 && index.status === "research-only", "unsupported index or authority");
    need(same(index.audience, audience) && index.keyword_basis === keywordBasis, "index is researcher/critic/Owner material only");
    const documents = {};
    for (const key of artifactKeys) {
      const ref = index[key];
      shape(ref, ["path", "digest"], `${key} binding`);
      need(/^docs\/research\/[a-z0-9_-]+\.(json|md)$/.test(ref.path) && /^sha256:[a-f0-9]{64}$/.test(ref.digest), `unsafe ${key} binding`);
      need(ref.path.endsWith(key === "study_document" ? ".md" : ".json"), `invalid ${key} content kind`);
      const pinned = readFilePinned(path.join(root, ref.path), {
        label: `reference library ${key}`, requireCallerOwned: false, requireSingleLink: true
      });
      need(pinned.digest === ref.digest, `${key} digest mismatch; retain history and review a successor`);
      documents[key] = key === "study_document" ? null : JSON.parse(pinned.source.toString("utf8"));
    }
    const { study, review, source_index: sourceIndex } = documents;
    need(study.research_component_study_version === 1 && study.status === "research-draft-not-design-ready" &&
      study.authority_scope === "non-authoritative-research-aid", "study is not bounded research");
    noAuthority.forEach(key => need(study[key] === false, `${key} cannot grant authority`));
    need(study.downstream_creator_access === false && study.rights?.redistribution === false &&
      study.rights?.creator_pixel_access === false && study.rights?.cross_project_approval_reuse === false, "source or creator rights were widened");
    for (const key of ["ready_project_packs", "source_behavior_executions", "same_product_responsive_pairs", "formal_reference_pipeline_review_passes"]) {
      need(study.counts?.[key] === 0, `${key} cannot be promoted by research lookup`);
    }
    need(same(study.source_index?.path, index.source_index.path) && study.source_index.digest === index.source_index.digest, "source index binding mismatch");
    need(review.review_kind === "manual-independent-peer-review" &&
      review.verdict === "accepted-as-bounded-static-research-with-nonblocking-notes" &&
      Array.isArray(review.must_fix_remaining) && review.must_fix_remaining.length === 0, "independent study review is unresolved");
    for (const key of ["formal_reference_cli_review", "owner_approval", "ready_reference_pack", "creator_input_approved", "visual_authority_granted", "source_pixels_included"]) {
      need(review.boundaries?.[key] === false, `manual review cannot grant ${key}`);
    }
    need(same(review.reviewed_artifacts, [index.study, index.study_document]), "review does not bind the exact study and narrative");
    need(Array.isArray(study.sources) && Array.isArray(study.entries) && Array.isArray(index.entries), "missing study inventory");
    distinct(study.sources.map(source => source.id), "source IDs");
    distinct(study.entries.map(entry => entry.id), "study IDs");
    distinct(index.entries.map(entry => entry.entry_id), "lookup IDs");
    need(same(index.entries.map(entry => entry.entry_id).sort(), study.entries.map(entry => entry.id).sort()), "lookup must cover every study entry exactly once");
    for (const facet of index.entries) {
      shape(facet, ["entry_id", "keywords"], "search facet");
      need(/^[a-z][a-z0-9-]*$/.test(facet.entry_id) && Array.isArray(facet.keywords) && facet.keywords.length > 0 && facet.keywords.every(safeText), "invalid search facet");
      distinct(facet.keywords, "keywords");
    }
    const allFrames = new Map();
    for (const source of study.sources) {
      const original = sourceIndex.products?.find(item => item.id === source.id);
      need(original && source.observed_surface === original.observed_surface && source.ecosystem === original.ecosystem &&
        source.source_archive_group_date === original.source_archive_group_date && same(source.frames, original.frames), "source scope or frames differ from intake");
      for (const frame of source.frames) {
        need(!allFrames.has(frame.frame_id), "duplicate source frame");
        const url = new URL(frame.source_url);
        need(url.origin === "https://uibowl.io" && !url.username && !url.password &&
          url.searchParams.getAll("imgId").length === 1 && url.searchParams.get("imgId") === frame.frame_id &&
          frame.source_interaction_tested === false && /^sha256:[a-f0-9]{64}$/.test(frame.private_capture_digest), "invalid frame provenance");
        allFrames.set(frame.frame_id, source.id);
      }
    }
    const covered = new Set();
    for (const entry of study.entries) {
      need(entry.family === entry.component_recipe?.family && entry.frame_ids?.length > 0 &&
        entry.frame_ids.every(id => allFrames.get(id) === entry.source_id), "unbound component observation");
      entry.frame_ids.forEach(id => covered.add(id));
      validateComponentRecipe(entry.component_recipe);
      need(entry.component_recipe.responsive_variants.every(variant => variant.basis === "target-proposal" && variant.observed_ids.length === 0), "responsive execution was not observed in this study");
    }
    need(covered.size === allFrames.size, "unused frames cannot inflate coverage");
    need(!/\/Users\/|\/tmp\/|data:image|\.png|\.jpe?g|api_key|Bearer\s/i.test(JSON.stringify(study)), "private capture data is not library output");
    return { index, study, review, index_digest: pinnedIndex.digest,
      library_digest: canonicalDigest({ index_digest: pinnedIndex.digest, artifacts: artifactKeys.map(key => index[key]) }) };
  } catch (error) {
    if (error instanceof RouterError && error.exitCode === 5) throw error;
    throw new RouterError(`reference library: ${error.message}`, 5);
  }
}

export function referenceLibraryReport(library, filters = {}) {
  for (const [key, value] of Object.entries(filters)) {
    if (!["component", "source", "query", "details"].includes(key) ||
      (key === "details" ? typeof value !== "boolean" : !safeText(value))) {
      throw new RouterError(`reference library: invalid filter ${key}`, 2);
    }
  }
  for (const key of ["component", "source"]) if (filters[key] && !/^[a-z][a-z0-9-]*$/.test(filters[key])) {
    throw new RouterError(`reference library: ${key} must be a semantic ID; use --query for Korean text`, 2);
  }
  const normalize = value => value.normalize("NFKC").toLocaleLowerCase("en-US");
  const terms = filters.query ? normalize(filters.query).split(/[\s/,·]+/u).filter(Boolean) : [];
  if (filters.query && !terms.length) throw new RouterError("reference library: query needs searchable text", 2);
  const { index, study, review } = library;
  const entries = study.entries.filter(entry => {
    const source = study.sources.find(item => item.id === entry.source_id);
    const facet = index.entries.find(item => item.entry_id === entry.id);
    const searchable = normalize([entry.id, entry.family, entry.label, entry.task, source.name, ...facet.keywords].join(" "));
    return (!filters.component || entry.family === filters.component) && (!filters.source || entry.source_id === filters.source) &&
      terms.every(term => searchable.includes(term));
  });
  const frames = new Set(entries.flatMap(entry => entry.frame_ids));
  const sources = study.sources.map(source => ({ ...source, frames: source.frames.filter(frame => frames.has(frame.frame_id)) })).filter(source => source.frames.length);
  return {
    reference_library_report_version: 1,
    report_kind: "component-research-lookup-not-reference-choices",
    orchestrator: "KillSlopRouter", status: "research-only", audience,
    selection_allowed: false, creator_input_approved: false, design_ready: false,
    visual_authority_granted: false, source_pixels_included: false,
    library_digest: library.library_digest, index_digest: library.index_digest,
    provenance: Object.fromEntries(artifactKeys.map(key => [key, index[key]])),
    filters, order: "study-order-not-fit-or-popularity-ranking",
    available_components: [...new Set(study.entries.map(entry => entry.family))],
    available_sources: study.sources.map(source => ({ id: source.id, name: source.name, observed_surface: source.observed_surface })),
    summary: { matching_components: entries.length, source_products: sources.length,
      ecosystems: new Set(sources.map(source => source.ecosystem)).size, unique_source_frames: frames.size,
      anatomy_parts: entries.reduce((sum, entry) => sum + entry.anatomy_observed.length, 0),
      proposed_target_checks: entries.reduce((sum, entry) => sum + entry.application_checks.length, 0),
      source_behavior_executions: 0, source_responsive_pairs: 0, ready_reference_packs: 0 },
    entries: entries.map(entry => ({ id: entry.id, component: entry.family, source_id: entry.source_id,
      label: entry.label, task: entry.task, frame_ids: entry.frame_ids, observation_scope: entry.observation_scope,
      application_conditions: entry.causal_hypothesis.application_conditions,
      harmful_context: entry.causal_hypothesis.harmful_context, limitations: entry.limitations,
      ...(filters.details ? { analysis: entry } : {}) })),
    sources, rights: study.rights,
    review: { kind: review.review_kind, verdict: review.verdict, nonblocking_notes: review.nonblocking_notes,
      formal_reference_cli_review: false, owner_approval: false },
    limits: study.limitations,
    next_step: entries.length
      ? "Match the project task, planning and rights; rebind eligible evidence in a reference run, obtain independent project review and real Owner selection. Reuse a matching ready project pack only when already verified. This lookup cannot dispatch a creator."
      : "No matching study. Research the target's missing coverage through permitted source access; do not substitute a familiar theme or invent fit, selection or readiness."
  };
}

export function formatReferenceLibrary(report) {
  const lines = ["KillSlopRouter — component research library (read-only)",
    `Matches: ${report.summary.matching_components}; source frames: ${report.summary.unique_source_frames}; ready packs: 0`,
    "연구 자료입니다. 프로젝트 적합성 순위·Owner 선택·디자인 승인·creator 입력이 아닙니다."];
  for (const entry of report.entries) {
    const source = report.sources.find(item => item.id === entry.source_id);
    lines.push(`\n${entry.component} — ${entry.label} [${source.name}]`, `Task: ${entry.task}`,
      `Scope: ${source.observed_surface}; ${entry.observation_scope.basis}`, `Fit conditions: ${entry.application_conditions.join(" / ")}`,
      `Do not apply: ${entry.harmful_context}`);
    for (const frame of source.frames.filter(frame => entry.frame_ids.includes(frame.frame_id))) lines.push(`Source: ${frame.source_url}`);
    if (entry.analysis) {
      for (const [aspect, observation] of Object.entries(entry.analysis.visual_observations)) lines.push(`${aspect} [${observation.basis}]: ${observation.description}`);
      for (const check of entry.analysis.application_checks) lines.push(`Target test proposal: ${check.question} → ${check.pass_condition}`);
    }
  }
  lines.push(`\nSource interaction/responsive execution: 0. ${report.next_step}`, `Library digest: ${report.library_digest}`);
  return `${lines.join("\n")}\n`;
}
