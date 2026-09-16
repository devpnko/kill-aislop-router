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
