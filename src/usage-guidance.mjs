// Presentation only. These hints never validate, mutate, or authorize a journey.
// Callers supply an already computed doctor report or automation result, not
// unchecked state loaded from disk. Ledger JSON and exit semantics stay intact.

export function doctorNextActions(report) {
  const actions = [];
  if (report.skill_catalog.status !== "ready") actions.push({
    id: "entrypoint-conflict",
    instruction: "Resolve the reported canonical/legacy entry conflict through the reviewed installer. Inspect the exact target and backup requirements; doctor does not install, force-refresh, or migrate it.",
    required_inputs: ["reviewed installation and exact migration scope"],
    documentation: "docs/codex-plugin.md#install"
  });
  if (!report.profile_path) actions.push({
    id: "bootstrap-project",
    instruction: "Read the project contract, then bootstrap this exact root with a real project ID, locale, and product surface. No profile or approval is created by doctor.",
    required_inputs: ["project-id", "locale", "surface"],
    documentation: "docs/project-setup.md#1-identify-the-project"
  });
  if (report.profile_path) {
    for (const [id, entries, documentation] of [
      ["visual-intent", report.visual_intents, "docs/visual-intent-contract.md"],
      ["visual-signature", report.visual_signatures, "docs/visual-signature-contract.md"]
    ]) {
      if (!entries.length || entries.some((entry) =>
        entry.status !== "approved" || entry.authority_status !== "verified")) {
        actions.push({
          id,
          instruction: `Bind ${id} to real project/reference/Owner evidence. Preserve the existing product character; do not invent approval or copy example authority.`,
          required_inputs: ["authoritative evidence and its exact digest"],
          documentation
        });
      }
    }
  }
  actions.push({
    id: "execution-preflight",
    instruction: "After project authority is resolved, run the exact task with run --dry-run and --host-config. Reviewers and browser have not run. Bind authorized reviewers and, for existing UI observation, the official Playwright adapter with reviewed URL, attestation, scenarios and viewports.",
    required_inputs: ["task", "artifact", "scope", "host-config", "planning evidence when required"],
    documentation: "docs/project-setup.md#3-connect-execution"
  });
  return actions;
}

function shellArgument(value) {
  const text = String(value);
  return /^[A-Za-z0-9_./:-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`;
}

export function automationGuidance(state, {
  hostConfig = null,
  commandPrefix = ["killsloprouter"]
} = {}) {
  const lines = [];
  if (state.automation_dry_run_version) {
    lines.push("reviewers: not executed (dry-run only)");
    if (state.status === "blocked") {
      lines.push("next: Resolve the listed route/planning/observation blockers, then repeat the same dry-run. Do not edit the artifact while its route is blocked.");
    } else if (state.pending?.length) {
      lines.push("next: Connect the pending authorized adapters; see docs/project-setup.md#3-connect-execution. Routable or ready is not ran.");
    } else {
      lines.push("next: Check for an existing matching state. Resume it with its original authority, or start the authorized run with a new --out. Dry-run is not an audit approval.");
    }
    if (state.host_readiness?.some((item) => item.provider_id === "browser-evidence")) {
      lines.push("browser: Existing-UI observation requires the official Playwright child; a manual/custom screenshot report is not a substitute.");
    }
    return lines;
  }

  const attempts = state.attempts || [];
  const count = (status) => attempts.filter((item) => item.execution_status === status).length;
  lines.push(`adapter attempts: ${count("ran")} ran; ${count("manual_recorded")} manual_recorded; ${count("manual_pending")} manual_pending; ${count("blocked_execution_error") + count("abandoned_after_crash")} failed/unknown`);
  if (state.status === "complete") {
    lines.push("next: Report the exact final audit verdict and receipt; complete describes this run, not permission to redesign, deploy, or systemize.");
    return lines;
  }
  if (state.status === "blocked") {
    lines.push("next: Resolve the listed blockers before resuming. Changed bound artifacts/authority may require a new run; never re-sign the ledger or auto-retry an unknown child outcome.");
  } else if (state.final_audit_status === "critic_pass_owner_review_pending") {
    lines.push("next: Ask the real Owner to review the exact scope and provide --approval. Creator or critic approval cannot replace that decision.");
  } else if (state.steps?.["scanner-triage"]?.status === "manual_pending") {
    lines.push("next: Classify every pending scanner finding in --triage, then resume the same state. Zero scanner hits are not design approval.");
  } else if (state.steps?.["conflict-adjudication"]?.status === "manual_pending") {
    lines.push("next: Obtain the pending independent adjudication result and ingest it with --result. Do not average away reviewer conflicts.");
  } else {
    lines.push("next: Supply the pending authorized adapters or genuinely independent --result files, then resume the same state. Existing-UI observation still requires official Playwright execution.");
  }
  if (state.state_path && /^sha256:[a-f0-9]{64}$/.test(state.resume_authority_digest || "")) {
    const args = [...commandPrefix, "run", "--resume", state.state_path,
      "--authority-digest", state.resume_authority_digest];
    if (hostConfig) args.push("--host-config", hostConfig);
    lines.push(`resume after resolving the stop: ${args.map(shellArgument).join(" ")}`);
    lines.push("retain: Keep the original start authority outside mutable state for the next session. Never reconstruct it from the state being verified; see docs/project-setup.md#4-stop-and-continue.");
  }
  return lines;
}

// These views are for the Owner, never a source-identity-bearing creator brief.
export function referenceChoicesGuidance(report) {
  const lines = [
    `UI Bowl reference choices: ${report.status} (Owner view; not visual approval)`,
    `ranking: ${report.ranking_policy}; ranking is not Owner selection`,
    `selection: one anchor and 1-4 supports; supports must cover a different product, category and ecosystem from the anchor`,
    `required grammar dimensions: ${report.selection_requirements.required_grammar_dimensions.join(", ")}`,
    `required component recipes: ${report.selection_requirements.required_recipe_families.join(", ") || "none"}`
  ];
  if (report.registry_comparison) {
    const registry = report.registry_comparison;
    lines.push(`registry: ${registry.status} (canonical JSON); file bytes: ${registry.file_bytes_match ? "same" : "different"}`,
      `   bound: ${registry.bound_registry_digest}; bundled: ${registry.bundled_registry_digest}`,
      `   ${registry.note}`);
  }
  if (report.recovery) {
    lines.push(`accepted packets (immutable): ${report.recovery.accepted_packet_ids.join(", ") || "none"}`,
      `unresolved packets: ${report.recovery.unresolved_packet_ids.join(", ") || "none"}`);
  }
  for (const item of report.candidates) {
    lines.push(`${item.rank}. ${item.app_name} [${item.reference_id}]${item.role ? ` — selected ${item.role}` : ""}`,
      `   source: ${item.source.uri}`,
      `   identity: ${item.source.product_record_id}; category: ${item.product_category}; ecosystem: ${item.ecosystem_id}`,
      `   fit: ${item.product_fit.band} (${item.product_fit.score}) — ${item.product_fit.rationale}`,
      `   use: ${item.component_families.join(", ")}; ${item.patterns.join(", ")}`,
      `   verified grammar choices: ${item.transfers.map((transfer) => transfer.grammar_id).join(", ")}`);
    const reasoning = item.hierarchy_reasoning[0];
    if (reasoning) lines.push(`   hierarchy (${reasoning.confidence} inference): ${reasoning.user_decision} — ${reasoning.consequence_if_flattened}`);
    for (const transfer of item.transfers.filter((entry) => entry.component_recipe)) {
      lines.push(`   craft (${transfer.component_recipe.family}): ${transfer.application}`,
        `   treatment: ${transfer.component_recipe.visual_treatment.surface} ${transfer.component_recipe.visual_treatment.typography}`,
        `   responsive: ${transfer.component_recipe.responsive_variants.map((variant) => `${variant.range}=${variant.basis}`).join(", ")}`);
    }
    lines.push(`   limits: ${item.locale_risks.join("; ")}`,
      `   popularity: ${item.popularity.status}; ${item.popularity.used_for_ranking ? `verified score ${item.popularity.score}` : "not used for ranking"}`,
      `   capture coverage: ${item.capture_readiness.status}; rights: ${item.rights.status}; no source redistribution or creator pixels`);
  }
  for (const blocker of report.blockers) lines.push(`blocker: ${blocker}`);
  for (const pending of report.pending) lines.push(`pending: ${pending}`);
  if (report.selected_grammar_ids.length) lines.push(`Owner-selected grammar: ${report.selected_grammar_ids.join(", ")}`);
  lines.push(`producer complete: ${report.producer_complete}; next step: ${report.next_step}`,
    `next: ${report.next_action}`,
    "detail: reference choices --run FILE --json includes verified hierarchy reasoning, application conditions and tradeoffs. Source links are for Owner review, not creator input.");
  return lines;
}

export function designReferenceGuidance(report) {
  return (report.selected_references || []).flatMap((item) => [
    `selected reference (${item.role}): ${item.app_name} — ${item.source_uri}`,
    `  fit: ${item.fit_rationale}`,
    ...item.transfers.map((transfer) => `  intended transfer (${transfer.recipe_family || transfer.dimension}): ${transfer.application}`)
  ]);
}
