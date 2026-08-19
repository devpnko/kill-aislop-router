import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hashArtifact } from "../src/integrity.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(root, "bin", "killsloprouter.mjs");
const baseProfile = JSON.parse(fs.readFileSync(
  path.join(root, "examples", "project-profile.example.json"),
  "utf8"
));
const manualHost = JSON.parse(fs.readFileSync(
  path.join(root, "examples", "host-adapter.example.json"),
  "utf8"
));
const SIGNATURE_ASPECTS = [
  "palette",
  "typography",
  "density",
  "shape",
  "elevation",
  "imagery",
  "motion",
  "style_keywords",
  "forbidden_transformations"
];

const CASES = [
  {
    id: "ko-erp-operator",
    locale: "ko-KR",
    surface: "operator-product-ui",
    risk: "standard",
    primary: "#175CD3",
    accent: "#F04438",
    font: "Pretendard",
    density: "compact",
    energy: "balanced",
    depth: "layered",
    imagery: "functional",
    motion: "restrained",
    preserve: ["재고 비교 밀도", "승인 권한 계층", "브랜드 블루", "같은 화면의 빠른 판단"],
    avoid: ["B2C 카드형 재배치", "종이색 중립화", "전역 무그림자 처리"],
    forbidden: [
      "replace compact ERP rows with spacious consumer cards",
      "replace brand blue with paper beige",
      "remove operator authority and status hierarchy"
    ]
  },
  {
    id: "b2c-membership",
    locale: "en-US",
    surface: "consumer-product-ui",
    risk: "standard",
    primary: "#7C3AED",
    accent: "#F97316",
    font: "Manrope",
    density: "balanced",
    energy: "high",
    depth: "layered",
    imagery: "brand",
    motion: "balanced",
    preserve: ["customer trust", "brand-purple navigation", "clear membership comparison", "warm visual energy"],
    avoid: ["operator-table conversion", "paper editorial neutralization", "single-gray palette"],
    forbidden: [
      "replace customer journeys with dense ERP tables",
      "replace purple and orange roles with neutral gray",
      "flatten every branded layer"
    ]
  },
  {
    id: "ko-high-risk-account",
    locale: "ko-KR",
    surface: "consumer-product-ui",
    risk: "high",
    primary: "#006B5F",
    accent: "#E5484D",
    font: "Pretendard",
    density: "balanced",
    energy: "balanced",
    depth: "layered",
    imagery: "functional",
    motion: "restrained",
    preserve: ["본인확인 신뢰", "개인정보 선택권", "한국어 금융 용어", "명시적 오류 복구"],
    avoid: ["과장된 캠페인 표현", "privacy 동의 은닉", "영문 우선 카피"],
    forbidden: [
      "hide privacy consent inside decorative copy",
      "replace Korean domain language with generic English labels",
      "remove verification and recovery states"
    ]
  }
];

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function signatureFor(item) {
  return {
    palette: {
      primary: [{ value: item.primary, token: "--color-primary", usage: "primary action and selection" }],
      accent: [{ value: item.accent, token: "--color-accent", usage: "bounded emphasis" }],
      background: [{ value: "#F7F8FA", token: "--color-background", usage: "application canvas" }],
      surface: [{ value: "#FFFFFF", token: "--color-surface", usage: "interactive surfaces" }],
      text: [{ value: "#171717", token: "--color-text", usage: "primary content" }],
      semantic: [{ role: "danger", value: "#D92D20", token: "--color-danger", usage: "blocking state" }]
    },
    typography: {
      families: [{ family: item.font, role: `${item.locale} product interface` }],
      scale: item.density === "compact" ? "compact task hierarchy" : "balanced product hierarchy",
      weights: ["400", "500", "700"],
      treatments: ["clear action hierarchy", "tabular values where data requires them"]
    },
    density: {
      mode: item.density,
      characteristics: item.density === "compact"
        ? ["same-screen comparison", "short operator rows"]
        : ["scannable sections", "comfortable touch rhythm"]
    },
    shape: {
      radii: item.surface === "operator-product-ui" ? ["4px controls", "8px panels"] : ["8px controls", "14px cards"],
      geometry: ["purposeful product geometry"],
      strokes: ["1px semantic boundaries"]
    },
    elevation: {
      strategy: "layered",
      shadows: ["one restrained overlay shadow"],
      separation: ["surface contrast", "semantic borders"]
    },
    imagery: {
      strategy: item.imagery,
      characteristics: item.imagery === "brand"
        ? ["brand-owned customer imagery"]
        : ["task and status imagery only"]
    },
    motion: {
      intensity: item.motion,
      characteristics: ["state confirmation", "reduced-motion equivalent"]
    },
    style_keywords: item.surface === "operator-product-ui"
      ? ["operational", "data-dense", "high-clarity"]
      : ["trustworthy", "brand-specific", "customer-focused"],
    forbidden_transformations: item.forbidden
  };
}

function makeProject(item) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `killsloprouter-dogfood-${item.id}-`));
  const artifact = path.join(directory, "artifact.html");
  fs.writeFileSync(artifact, `<!doctype html><html lang="${item.locale}"><body><main>${item.id}</main></body></html>\n`);

  const intent = {
    mode: item.surface === "operator-product-ui" ? "product-native" : "brand-expressive",
    editorial_treatment: "forbidden",
    editorial_scope: [],
    energy: item.energy,
    depth: item.depth,
    preserve: item.preserve,
    avoid: item.avoid
  };
  const intentReceiptPath = path.join(directory, "visual-intent-approval.json");
  writeJson(intentReceiptPath, {
    visual_intent_receipt_version: 1,
    project_id: item.id,
    surface: item.surface,
    status: "approved",
    intent,
    authority: {
      kind: "approved-reference",
      authority_id: `${item.id}-owner`,
      basis: `The reviewed ${item.id} artifact defines its own surface and visual intent.`,
      decided_at: "2026-08-19T00:00:00.000Z"
    },
    evidence: [{
      kind: "approved-artifact",
      path: path.basename(artifact),
      digest: hashArtifact(artifact)
    }]
  });

  const signature = signatureFor(item);
  const signatureReceiptPath = path.join(directory, "visual-signature-approval.json");
  writeJson(signatureReceiptPath, {
    visual_signature_receipt_version: 1,
    project_id: item.id,
    surface: item.surface,
    status: "approved",
    signature,
    authority: {
      kind: "approved-reference",
      authority_id: `${item.id}-owner`,
      basis: `The reviewed ${item.id} artifact binds its exact palette, type, density, and depth.`,
      decided_at: "2026-08-19T00:00:00.000Z"
    },
    evidence: [{
      kind: "approved-artifact",
      path: path.basename(artifact),
      digest: hashArtifact(artifact)
    }],
    coverage: SIGNATURE_ASPECTS.map((aspect) => ({
      aspect,
      evidence_paths: [path.basename(artifact)]
    }))
  });

  const designAuthorityPath = path.join(directory, "design-system-owner.json");
  writeJson(designAuthorityPath, {
    status: "approved",
    owner_id: `${item.id}-owner`,
    scope: `${item.id}-design-system`
  });

  const profile = structuredClone(baseProfile);
  profile.project_id = item.id;
  profile.default_locale = item.locale;
  profile.surface_contract = {
    surface_contract_version: 1,
    primary: item.surface,
    allowed: [item.surface],
    artifact_bindings: [{ root: ".", surface: item.surface }]
  };
  profile.visual_intents = {
    [item.surface]: {
      visual_intent_version: 1,
      status: "approved",
      ...intent,
      authority_receipt: path.basename(intentReceiptPath),
      authority_digest: hashArtifact(intentReceiptPath)
    }
  };
  profile.visual_signatures = {
    [item.surface]: {
      visual_signature_version: 1,
      status: "approved",
      ...signature,
      authority_receipt: path.basename(signatureReceiptPath),
      authority_digest: hashArtifact(signatureReceiptPath)
    }
  };
  profile.design_system = {
    id: `${item.id}-ui`,
    version: "1.0.0",
    status: "approved",
    authority_receipt: path.basename(designAuthorityPath),
    authority_digest: hashArtifact(designAuthorityPath),
    source_scope_id: `${item.id}-approved-surface`
  };
  profile.approved_design_system = true;
  profile.surface_overrides = {
    [item.surface]: { creator: "project-design-system", exclude_tools: ["taste-skill"] }
  };
  profile.local_adapters["locale-copy-review"] = `reviewers/${item.locale}-copy`;
  delete profile.planning;
  delete profile.tool_lock;

  const profilePath = path.join(directory, "profile.json");
  const hostPath = path.join(directory, "host-adapters.json");
  writeJson(profilePath, profile);
  writeJson(hostPath, manualHost);
  return { directory, artifact, profilePath, hostPath };
}

function commandArgs(item, project, extra = []) {
  return [
    "run",
    "--profile", project.profilePath,
    "--host-config", project.hostPath,
    "--surface", item.surface,
    "--task", "redesign",
    "--direction", "approved",
    "--changes", item.risk === "high"
      ? "source,copy,layout,interaction,data,authority"
      : "source,copy,layout,interaction",
    "--risk", item.risk,
    "--artifact", project.artifact,
    "--scope", "mockup",
    "--creator-id", `${item.id}-creator`,
    "--json",
    ...extra
  ];
}

for (const item of CASES) {
  test(`dogfood routes ${item.id} without cross-surface style collapse`, () => {
    const project = makeProject(item);
    try {
      const dry = spawnSync(process.execPath, [cli, ...commandArgs(item, project, ["--dry-run"])], {
        cwd: project.directory,
        encoding: "utf8",
        timeout: 30_000
      });
      assert.equal(dry.status, 6, dry.stderr || dry.stdout);
      const report = JSON.parse(dry.stdout);
      assert.equal(report.status, "dry_run");
      assert.equal(report.plan.status, "planned");
      assert.equal(report.plan.route_id, item.surface);
      assert.equal(report.plan.creator, "project-design-system");
      assert.equal(report.plan.visual_intent.editorial_treatment, "forbidden");
      assert.equal(report.plan.visual_intent.authority_status, "verified");
      assert.equal(report.plan.visual_signature.authority_status, "verified");
      assert.equal(report.plan.visual_signature.primary, item.primary);
      assert.equal(report.plan.visual_signature.typography_family, item.font);
      assert.equal(report.plan.visual_signature.density, item.density);
      assert.equal(report.plan.routing.some((stage) =>
        stage.selected_providers.includes("taste-skill")), false);
      assert.equal(report.host_readiness.every((entry) =>
        entry.execution_status === "manual_pending"), true);
      const privacy = report.plan.routing.find((stage) => stage.stage_id === "high-risk-project-gates");
      assert.equal(Boolean(privacy), item.risk === "high");
      if (privacy) assert.deepEqual(privacy.selected_providers, ["privacy-authority-review"]);
      assert.ok(report.plan.routing.find((stage) => stage.stage_id === "copy-review")
        .selected_providers.includes("locale-copy-review"));

      const statePath = path.join(project.directory, "automation.json");
      const started = spawnSync(process.execPath, [
        cli,
        ...commandArgs(item, project, ["--out", statePath])
      ], {
        cwd: project.directory,
        encoding: "utf8",
        timeout: 30_000
      });
      assert.equal(started.status, 6, started.stderr || started.stdout);
      const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
      assert.equal(state.status, "manual_pending");
      assert.equal(state.attempts.every((attempt) =>
        attempt.execution_status === "manual_pending" && attempt.ingest_status === "not-recorded"), true);
      const audit = JSON.parse(fs.readFileSync(state.paths.audit.path, "utf8"));
      assert.equal(audit.creator.provider_id, "project-design-system");
      assert.equal(audit.packets.every((packet) =>
        packet.visual_intent_contract.editorial_treatment === "forbidden"), true);
      assert.equal(audit.packets.every((packet) =>
        packet.visual_signature_contract.palette.primary[0].value === item.primary), true);
      assert.equal(audit.packets.every((packet) =>
        packet.visual_signature_contract.forbidden_transformations.join("\n") === item.forbidden.join("\n")), true);
      assert.equal(audit.packets.some((packet) =>
        packet.provider.id === "privacy-authority-review"), item.risk === "high");
    } finally {
      fs.rmSync(project.directory, { recursive: true, force: true });
    }
  });
}
