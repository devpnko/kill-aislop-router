import assert from "node:assert/strict";
import test from "node:test";
import {
  designBrowserCases,
  designBrowserExecutionId,
  selectDesignScenarios,
  validateDesignScenario,
  verifyDesignBrowserReport
} from "../src/design-browser-proof.mjs";
import { validatePlaywrightScenarioDocument } from "../src/playwright.mjs";
import { designScenarios } from "./fixtures/design-browser-contract.mjs";

const digest = `sha256:${"1".repeat(64)}`;
function proofFixture() {
  const packet = {
    run_id: "run", packet_id: "packet", packet_digest: digest,
    design_task: {
      subject_id: "candidate", subject_result_digest: digest,
      prototypes: [{ digest }], locales: ["en-US", "ko-KR"],
      required_states: ["default", "error"]
    },
    evidence_contract: { required_viewports: ["mobile", "desktop"], required_checks: ["state"] }
  };
  const authority = {
    scenarios: designScenarios(), scenarioDigest: digest,
    viewports: { mobile: { width: 390, height: 844 }, desktop: { width: 1440, height: 1000 } },
    colorSchemes: ["light", "dark"]
  };
  const report = {
    design_playwright_report_version: 2,
    run_id: "run", packet_id: "packet", packet_digest: digest,
    subject_id: "candidate", subject_result_digest: digest,
    prototype: { digest }, scenario_digest: digest, checks: { state: true },
    executions: designBrowserCases(authority.scenarios,
      packet.evidence_contract.required_viewports, authority.colorSchemes).map((binding) => {
      const id = designBrowserExecutionId(binding);
      const scenario = authority.scenarios.find((item) => item.id === binding.scenario);
      return {
        ...binding, execution_id: id, viewport_size: authority.viewports[binding.viewport],
        actions: scenario.actions.map((step) => ({ step, status: "passed" })),
        assertions: scenario.assertions.map((step) => ({ step, status: "passed" })),
        outcome: "passed", state_before: binding.state === "default", state_after: true, locale_after: true,
        checks: { state: true }, screenshot: `${id}.png`, trace: `${id}.zip`,
        screenshot_digest: digest, trace_digest: digest
      };
    })
  };
  return { packet, report, authority };
}

test("design proof requires reviewed state × locale scenarios without changing runtime scenarios", () => {
  const runtime = { id: "runtime", path: "/settings", actions: [], assertions: [] };
  assert.doesNotThrow(() => validatePlaywrightScenarioDocument({
    playwright_scenario_version: 1, scenarios: [runtime]
  }));
  const { packet, authority } = proofFixture();
  assert.equal(selectDesignScenarios(authority.scenarios, packet.design_task).length, 4);
  assert.throws(() => selectDesignScenarios([runtime], packet.design_task), /state=default, locale=en-US/);
  assert.throws(() => selectDesignScenarios(authority.scenarios.slice(1), packet.design_task), /found 0/);
  assert.throws(() => selectDesignScenarios([...authority.scenarios, authority.scenarios[0]], packet.design_task),
    /found 2/);
});

for (const [name, mutate] of [
  ["non-default without native action", (s) => { s.actions = [{ type: "wait-for", locator: "#error" }]; }],
  ["root-only assertion", (s) => { s.assertions = [{ type: "visible", locator: "body" }]; }],
  ["no assertion", (s) => { s.assertions = []; }],
  ["navigation outside the artifact", (s) => { s.path = "/other.html"; }],
  ["unknown authority fields", (s) => { s.design.approved = true; }],
  ["invalid locale", (s) => { s.design.locale = "../ko-KR"; }]
]) {
  test(`design scenario fails closed: ${name}`, () => {
    const scenario = designScenarios()[1];
    mutate(scenario);
    assert.throws(() => validateDesignScenario(scenario), /design browser proof:/);
    assert.throws(() => validatePlaywrightScenarioDocument({
      playwright_scenario_version: 1, scenarios: [scenario]
    }), /design browser proof:/);
  });
}

test("design proof accepts the complete executed matrix", () => {
  const { packet, report, authority } = proofFixture();
  assert.equal(report.executions.length, 16);
  assert.equal(verifyDesignBrowserReport(packet, report, authority), report);
});

for (const [name, mutate] of [
  ["legacy marker-only report", (r) => { r.design_playwright_report_version = 1; }],
  ["packet tamper", (r) => { r.packet_digest = `sha256:${"2".repeat(64)}`; }],
  ["scenario replacement", (r) => { r.scenario_digest = `sha256:${"2".repeat(64)}`; }],
  ["omitted viewport", (r) => { r.executions = r.executions.filter((e) => e.viewport !== "mobile"); }],
  ["omitted locale", (r) => { r.executions = r.executions.filter((e) => e.locale !== "ko-KR"); }],
  ["omitted scheme", (r) => { r.executions = r.executions.filter((e) => e.color_scheme !== "dark"); }],
  ["duplicate evidence row", (r) => { r.executions[1] = r.executions[0]; }],
  ["changed viewport dimensions", (r) => { r.executions[0].viewport_size = { width: 1000, height: 1000 }; }],
  ["native click skipped", (r) => { r.executions[0].actions[0].status = "skipped"; }],
  ["native click failed", (r) => { r.executions[0].actions[0].status = "failed"; }],
  ["weakened action", (r) => { r.executions[0].actions[0].step.type = "wait-for"; }],
  ["missing assertion", (r) => { r.executions[0].assertions = []; }],
  ["hidden state", (r) => { r.executions[0].state_after = false; }],
  ["hidden locale", (r) => { r.executions[0].locale_after = false; }],
  ["state already visible before action", (r) => { r.executions.find((e) => e.state === "error").state_before = true; }],
  ["failed per-state check", (r) => { r.executions[0].checks.state = false; }],
  ["missing trace", (r) => { delete r.executions[0].trace; }],
  ["screenshot borrowed from another case", (r) => { r.executions[0].screenshot = r.executions[1].screenshot; }]
]) {
  test(`design proof replay rejects ${name}`, () => {
    const { packet, report, authority } = proofFixture();
    // Independent copies prevent a mutation from changing expected authority.
    const changed = structuredClone(report);
    mutate(changed);
    assert.throws(() => verifyDesignBrowserReport(packet, changed, authority), /design browser proof:/);
  });
}
