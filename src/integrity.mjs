import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const DEFAULT_HASH_IGNORES = new Set([".git", "node_modules", ".killsloprouter"]);

export function sha256(value) {
  return `sha256:${crypto.createHash("sha256").update(value).digest("hex")}`;
}

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])])
    );
  }
  return value;
}

export function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

function hashFile(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function walkArtifact(root, relative = "", ignores = DEFAULT_HASH_IGNORES) {
  const directory = path.join(root, relative);
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !ignores.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const manifest = [];

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const absolute = path.join(root, entryRelative);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink inside artifact is unsupported: ${absolute}`);
    } else if (entry.isDirectory()) {
      manifest.push({ type: "directory", path: entryRelative });
      manifest.push(...walkArtifact(root, entryRelative, ignores));
    } else if (entry.isFile()) {
      manifest.push({
        type: "file",
        path: entryRelative,
        bytes: fs.statSync(absolute).size,
        digest: hashFile(absolute)
      });
    }
  }
  return manifest;
}

export function hashArtifact(target, options = {}) {
  const absolute = path.resolve(target);
  const stat = fs.lstatSync(absolute);
  if (stat.isSymbolicLink()) {
    throw new Error(`symlink artifacts are unsupported: ${absolute}`);
  }
  if (stat.isFile()) return hashFile(absolute);
  if (!stat.isDirectory()) throw new Error(`unsupported artifact type: ${absolute}`);
  const ignores = new Set(options.ignores || DEFAULT_HASH_IGNORES);
  return canonicalDigest({ type: "directory", entries: walkArtifact(absolute, "", ignores) });
}

function displayPath(absolute, root) {
  const relative = path.relative(root, absolute);
  if (relative && !relative.startsWith("..") && !path.isAbsolute(relative)) {
    return relative.split(path.sep).join("/");
  }
  if (!relative) return ".";
  return absolute;
}

export function snapshotArtifact(target, options = {}) {
  const root = path.resolve(options.root || process.cwd());
  const resolvedPath = path.resolve(root, target);
  if (!fs.existsSync(resolvedPath)) throw new Error(`artifact not found: ${resolvedPath}`);
  const stat = fs.lstatSync(resolvedPath);
  const kind = stat.isDirectory() ? "directory" : "file";
  return {
    path: options.label || displayPath(resolvedPath, root),
    resolved_path: resolvedPath,
    kind,
    bytes: stat.isFile() ? stat.size : null,
    digest: hashArtifact(resolvedPath, options)
  };
}

export function verifySnapshot(snapshot, options = {}) {
  if (!snapshot?.resolved_path || !fs.existsSync(snapshot.resolved_path)) {
    return { ok: false, reason: "missing", expected: snapshot?.digest || null, actual: null };
  }
  try {
    const actual = hashArtifact(snapshot.resolved_path, options);
    return {
      ok: actual === snapshot.digest,
      reason: actual === snapshot.digest ? null : "digest-mismatch",
      expected: snapshot.digest,
      actual
    };
  } catch (error) {
    return { ok: false, reason: error.message, expected: snapshot.digest, actual: null };
  }
}

export function publicSnapshot(snapshot) {
  if (!snapshot) return null;
  const { resolved_path: _resolvedPath, ...safe } = snapshot;
  if (path.isAbsolute(safe.path)) safe.path = `<external>/${path.basename(safe.path)}`;
  return safe;
}

export function writeJsonAtomic(filePath, value) {
  const absolute = path.resolve(filePath);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, absolute);
}
