import { canonicalDigest } from "./integrity.mjs";

function requireValue(condition, message) {
  if (!condition) throw new Error(`design browser proof: ${message}`);
}

export function validateDesignScenario(scenario) {
  if (scenario.design === undefined) return;
  const binding = scenario.design;
  requireValue(binding && typeof binding === "object" && !Array.isArray(binding) &&
    Object.keys(binding).sort().join(",") === "locale,state",
  `${scenario.id} requires an exact design {state, locale} binding`);
  for (const key of ["state", "locale"]) {
    requireValue(typeof binding[key] === "string" &&
      /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(binding[key]),
    `${scenario.id} has an invalid design ${key}`);
  }
  requireValue(scenario.path === "/", `${scenario.id} must open only the bound prototype at /`);
  requireValue((scenario.assertions || []).some((item) =>
    ["visible", "text"].includes(item.type) &&
    !["body", "html", ":root", "*"].includes(item.locator?.trim())),
  `${scenario.id} needs an explicit visible/text state assertion, not a root-only assertion`);
  requireValue(binding.state === "default" || (scenario.actions || []).some((item) =>
    ["click", "press", "fill", "check", "uncheck", "select", "hover"].includes(item.type)),
  `${scenario.id} must reach a non-default state through a native user action`);
}

export function selectDesignScenarios(scenarios, task) {
  requireValue(Array.isArray(scenarios), "digest-bound design scenarios are missing");
  for (const values of [task.locales, task.required_states]) {
    requireValue(Array.isArray(values) && values.length > 0 &&
      new Set(values).size === values.length, "required locales/states must be non-empty and unique");
  }
  for (const scenario of scenarios) validateDesignScenario(scenario);
  return task.locales.flatMap((locale) => task.required_states.map((state) => {
    const matches = scenarios.filter((scenario) =>
      scenario.design?.state === state && scenario.design?.locale === locale);
    requireValue(matches.length === 1,
      `requires exactly one reviewed scenario for state=${state}, locale=${locale} (found ${matches.length})`);
    return matches[0];
  }));
}

export function designBrowserCases(scenarios, viewports, colorSchemes) {
  return scenarios.flatMap((scenario) => viewports.flatMap((viewport) =>
    colorSchemes.map((colorScheme) => ({
      scenario: scenario.id,
      state: scenario.design.state,
      locale: scenario.design.locale,
      viewport,
      color_scheme: colorScheme
    }))));
}

export function designBrowserExecutionId(binding) {
  return `design-${canonicalDigest(binding).slice(7)}`;
}

// The caller verifies the report file digest and the immutable child/host
// authority. Recompute the entire matrix here on ingest AND on state replay.
// A signed list of markers is not equivalent to an executed scenario.
export function verifyDesignBrowserReport(packet, report, authority) {
  requireValue(report?.design_playwright_report_version === 2,
    "legacy marker-only evidence cannot be reused; start a new run with reviewed design scenarios");
  requireValue(report.packet_digest === packet.packet_digest &&
    report.packet_id === packet.packet_id && report.run_id === packet.run_id &&
    report.subject_id === packet.design_task.subject_id &&
    report.subject_result_digest === packet.design_task.subject_result_digest &&
    report.prototype?.digest === packet.design_task.prototypes?.[0]?.digest,
  "report does not match the packet/prototype authority");
  requireValue(report.scenario_digest === authority.scenarioDigest,
    "scenario digest does not match the executed host authority");
  const scenarios = selectDesignScenarios(authority.scenarios, packet.design_task);
  const cases = designBrowserCases(scenarios,
    packet.evidence_contract.required_viewports, authority.colorSchemes);
  requireValue(Array.isArray(report.executions) && report.executions.length === cases.length,
    "scenario × state × locale × viewport × color-scheme matrix is incomplete");
  const expected = new Map(cases.map((binding) => [designBrowserExecutionId(binding), binding]));
  const evidenceFiles = new Set();
  for (const execution of report.executions) {
    const binding = expected.get(execution.execution_id);
    requireValue(binding, "duplicate or unexpected execution in the matrix");
    expected.delete(execution.execution_id);
    requireValue(Object.entries(binding).every(([key, value]) => execution[key] === value) &&
      canonicalDigest(execution.viewport_size) === canonicalDigest(authority.viewports[binding.viewport]),
    "execution binding or viewport dimensions differ from the authority");
    const scenario = scenarios.find((item) => item.id === binding.scenario);
    for (const field of ["actions", "assertions"]) {
      const declared = scenario[field] || [];
      const observed = execution[field];
      requireValue(Array.isArray(observed) && observed.length === declared.length &&
        observed.every((item, index) => item.status === "passed" &&
          canonicalDigest(item.step) === canonicalDigest(declared[index])),
      `${execution.execution_id} has missing, changed, or failed ${field}`);
    }
    requireValue(execution.state_after === true &&
      execution.locale_after === true &&
      (binding.state === "default" || execution.state_before === false),
    `${execution.execution_id} did not prove entry into a visible, locale-bound state`);
    for (const check of packet.evidence_contract.required_checks) {
      requireValue(report.checks?.[check] === true && execution.checks?.[check] === true,
        `${execution.execution_id} failed or omitted check: ${check}`);
    }
    requireValue(execution.outcome === "passed", `${execution.execution_id} did not pass`);
    for (const kind of ["screenshot", "trace"]) {
      const name = execution[kind];
      const extension = kind === "screenshot" ? "png" : "zip";
      requireValue(typeof name === "string" &&
        name === `${execution.execution_id}.${extension}` && !evidenceFiles.has(name) &&
        /^sha256:[a-f0-9]{64}$/.test(execution[`${kind}_digest`] || ""),
      `${execution.execution_id} is missing unique digest-bound ${kind} evidence`);
      evidenceFiles.add(name);
    }
  }
  requireValue(expected.size === 0, "required execution coverage is missing");
  return report;
}
