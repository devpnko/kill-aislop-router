import fs from "node:fs";
import path from "node:path";
import { canonicalDigest, hashArtifact, writeJsonAtomic } from "./integrity.mjs";
import { RouterError, VALID_SURFACES } from "./router.mjs";
import { DEFAULT_PLAYWRIGHT_CHECKS, DEFAULT_PLAYWRIGHT_VIEWPORTS } from "./playwright.mjs";

const LOCAL_PROVIDER_IDS = new Set([
  "project-contract",
  "project-design-system",
  "project-systemizer",
  "design-system-contract-review",
  "locale-copy-review",
  "browser-evidence",
  "domain-authority-review",
  "privacy-authority-review",
  "owner-approval"
]);

const REQUIRED_HIGH_RISK_GATES = [
  "domain-authority-review",
  "privacy-authority-review",
  "owner-approval"
];

const DEFAULT_BROWSER_EVIDENCE = {
  browser: "playwright",
  required_viewports: Object.keys(DEFAULT_PLAYWRIGHT_VIEWPORTS),
  required_checks: [...DEFAULT_PLAYWRIGHT_CHECKS]
};

function assertProjectId(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value)) {
    throw new RouterError("bootstrap requires --project-id using letters, digits, dot, underscore, or hyphen", 2);
  }
}

function assertLocale(value) {
  if (typeof value !== "string" || !/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/.test(value)) {
    throw new RouterError("bootstrap requires an explicit BCP 47-like --locale such as ko-KR", 2);
  }
}

function assertSurface(value) {
  if (!VALID_SURFACES.has(value)) {
    throw new RouterError(
      "bootstrap requires --surface operator-product-ui, consumer-product-ui, or marketing-editorial",
      2
    );
  }
}

function assertProjectRoot(root) {
  const absolute = path.resolve(root || process.cwd());
  if (!fs.existsSync(absolute)) throw new RouterError(`bootstrap root does not exist: ${absolute}`, 2);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new RouterError("bootstrap root must be a real directory, not a symlink", 2);
  }
  const real = fs.realpathSync(absolute);
  if (real === path.parse(real).root) {
    throw new RouterError("bootstrap refuses to use a filesystem root as the project root", 2);
  }
  return real;
}

function routingDeclaration(providerId, contract) {
  return {
    target: `manual:${providerId}`,
    status: "routable",
    version: "manual-contract:v1",
    executor: "manual-review",
    strength: contract.strength || 1,
    capabilities: [...(contract.capabilities || [])],
    independent_from_creator: Boolean(contract.independent_from_creator)
  };
}

function externalDeclaration(contract) {
  return {
    status: "routable",
    version: "manual-contract:v1",
    executor: "manual-review",
    strength: contract.strength || 1,
    capabilities: [...(contract.capabilities || [])],
    independent_from_creator: Boolean(contract.independent_from_creator)
  };
}

export function createBootstrapProfile({ router, projectId, locale, surface }) {
  assertSurface(surface);
  const localAdapters = {};
  const externalAdapters = {};
  for (const [providerId, contract] of Object.entries(router.provider_capabilities || {})) {
    if (LOCAL_PROVIDER_IDS.has(providerId)) {
      localAdapters[providerId] = routingDeclaration(providerId, contract);
    } else {
      externalAdapters[providerId] = externalDeclaration(contract);
    }
  }
  return {
    profile_version: 1,
    project_id: projectId,
    default_locale: locale,
    surface_contract: {
      surface_contract_version: 1,
      primary: surface,
      allowed: [surface],
      artifact_bindings: [{ root: ".", surface }]
    },
    approved_design_system: false,
    local_adapters: localAdapters,
    external_adapters: externalAdapters,
    fallback_adapters: {},
    surface_overrides: {},
    high_risk_gates: [...REQUIRED_HIGH_RISK_GATES],
    evidence: structuredClone(DEFAULT_BROWSER_EVIDENCE)
  };
}

export function createManualHostManifest(router) {
  const providers = Object.fromEntries(
    Object.entries(router.provider_capabilities || {}).map(([providerId, contract]) => [
      providerId,
      {
        adapter: "manual-v1",
        strength: contract.strength || 1,
        capabilities: [...(contract.capabilities || [])],
        permissions: []
      }
    ])
  );
  return {
    host_adapter_version: 1,
    allowed_providers: Object.keys(providers),
    granted_permissions: [],
    providers
  };
}

function bootstrapPaths(root) {
  const directory = path.join(root, ".killsloprouter");
  return {
    directory,
    profile: path.join(directory, "profile.json"),
    hostManifest: path.join(directory, "host-adapters.json"),
    receipt: path.join(directory, "bootstrap-receipt.json")
  };
}

function relativeToRoot(root, target) {
  return path.relative(root, target).split(path.sep).join("/");
}

export function bootstrapProject({ router, root, projectId, locale, surface }) {
  assertProjectId(projectId);
  assertLocale(locale);
  assertSurface(surface);
  const projectRoot = assertProjectRoot(root);
  const paths = bootstrapPaths(projectRoot);
  if (fs.existsSync(paths.directory)) {
    const configStat = fs.lstatSync(paths.directory);
    if (configStat.isSymbolicLink() || !configStat.isDirectory()) {
      throw new RouterError(".killsloprouter must be a real directory inside the project root", 2);
    }
  }
  const collisions = [paths.profile, paths.hostManifest, paths.receipt].filter(fs.existsSync);
  if (collisions.length) {
    throw new RouterError(
      `bootstrap refuses to overwrite existing configuration: ${collisions.map((item) => relativeToRoot(projectRoot, item)).join(", ")}`,
      2
    );
  }

  const profile = createBootstrapProfile({ router, projectId, locale, surface });
  const hostManifest = createManualHostManifest(router);
  writeJsonAtomic(paths.profile, profile);
  writeJsonAtomic(paths.hostManifest, hostManifest);

  const receiptBody = {
    bootstrap_receipt_version: 1,
    status: "manual_adapter_setup_required",
    project_id: projectId,
    locale,
    surface,
    project_root: projectRoot,
    profile: {
      path: relativeToRoot(projectRoot, paths.profile),
      digest: hashArtifact(paths.profile)
    },
    host_manifest: {
      path: relativeToRoot(projectRoot, paths.hostManifest),
      digest: hashArtifact(paths.hostManifest),
      execution_mode: "manual-only"
    },
    safety: {
      approved_design_system: false,
      surface_contract_locked: true,
      arbitrary_profile_commands: false,
      executable_adapters_authorized: false,
      missing_execution_remains_manual_pending: true
    },
    next_actions: [
      "bind project contracts and any approved design-system authority",
      "replace manual host adapters only with allowlisted digest-locked entrypoints",
      "run doctor and an integrated dry-run before execution"
    ]
  };
  const receipt = {
    ...receiptBody,
    receipt_digest: canonicalDigest(receiptBody)
  };
  writeJsonAtomic(paths.receipt, receipt);
  return {
    ...receipt,
    receipt_path: paths.receipt
  };
}
