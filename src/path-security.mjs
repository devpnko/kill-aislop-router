import fs from "node:fs";
import os from "node:os";
import path from "node:path";

function pathInside(candidate, boundary) {
  const relative = path.relative(path.resolve(boundary), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function lstatIfPresent(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (["ENOENT", "ENOTDIR"].includes(error?.code)) return null;
    throw error;
  }
}

export function trustedPlatformPath(target) {
  const absolute = path.resolve(target);
  if (process.platform !== "darwin") return absolute;
  for (const [alias, expected] of [["/tmp", "/private/tmp"], ["/var", "/private/var"]]) {
    const relative = path.relative(alias, absolute);
    if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      continue;
    }
    const stat = fs.lstatSync(alias);
    if (!stat.isSymbolicLink() || stat.uid !== 0 || fs.realpathSync.native(alias) !== expected) {
      throw new Error(`trusted macOS filesystem alias changed: ${alias}`);
    }
    return path.join(expected, relative);
  }
  return absolute;
}

function nearestExistingCanonical(target) {
  let cursor = path.resolve(target);
  while (true) {
    try {
      return fs.realpathSync.native(cursor);
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) throw new Error(`cannot resolve a filesystem anchor for ${target}`);
    cursor = parent;
  }
}

function trustedAmbientAnchors(target) {
  const existingCanonical = nearestExistingCanonical(target);
  const candidates = [os.homedir(), os.tmpdir(), process.cwd()]
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .flatMap((candidate) => {
      const stat = lstatIfPresent(candidate);
      if (!stat?.isDirectory() || stat.isSymbolicLink()) return [];
      const canonical = fs.realpathSync.native(candidate);
      return pathInside(existingCanonical, canonical) ? [{ logical: candidate, canonical }] : [];
    })
    .sort((left, right) => left.canonical.length - right.canonical.length);
  if (candidates.length > 0) return candidates[0].canonical;
  return fs.realpathSync.native(path.parse(path.resolve(target)).root);
}

function lexicalAliasForBoundary(target, canonicalBoundary) {
  let cursor = path.resolve(target);
  while (true) {
    try {
      if (fs.realpathSync.native(cursor) === canonicalBoundary) return cursor;
    } catch (error) {
      if (!["ENOENT", "ENOTDIR"].includes(error?.code)) throw error;
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
}

function secureFromBoundary(target, boundary, {
  label,
  mustExist = false,
  kind = null,
  singleLink = false
}) {
  const absolute = path.resolve(target);
  const boundaryStat = lstatIfPresent(boundary);
  if (!boundaryStat?.isDirectory() || boundaryStat.isSymbolicLink()) {
    throw new Error(`${label} trust boundary must be a real directory: ${boundary}`);
  }
  const canonicalBoundary = fs.realpathSync.native(boundary);
  const logicalBoundary = lexicalAliasForBoundary(absolute, canonicalBoundary);
  if (!logicalBoundary) {
    throw new Error(`${label} escapes its trusted filesystem boundary: ${canonicalBoundary}`);
  }
  const logicalBoundaryStat = lstatIfPresent(logicalBoundary);
  if (!logicalBoundaryStat?.isDirectory() || logicalBoundaryStat.isSymbolicLink()) {
    throw new Error(`${label} contains a symlink ancestor: ${logicalBoundary}`);
  }

  const relative = path.relative(logicalBoundary, absolute);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error(`${label} escapes its trusted filesystem boundary: ${canonicalBoundary}`);
  }
  const segments = relative.split(path.sep).filter(Boolean);
  let cursor = logicalBoundary;
  let firstMissing = -1;
  for (const [index, segment] of segments.entries()) {
    cursor = path.join(cursor, segment);
    const stat = lstatIfPresent(cursor);
    if (!stat) {
      if (firstMissing < 0) firstMissing = index;
      continue;
    }
    if (stat.isSymbolicLink()) {
      throw new Error(`${label} contains a symlink ancestor: ${cursor}`);
    }
    if (firstMissing >= 0) {
      throw new Error(`${label} has an existing descendant below a missing path component: ${cursor}`);
    }
    if (index < segments.length - 1 && !stat.isDirectory()) {
      throw new Error(`${label} contains a non-directory ancestor: ${cursor}`);
    }
  }

  const targetStat = lstatIfPresent(absolute);
  if (mustExist && !targetStat) throw new Error(`${label} is missing: ${absolute}`);
  if (targetStat?.isSymbolicLink()) throw new Error(`${label} must not be a symlink: ${absolute}`);
  if (kind === "file" && targetStat && !targetStat.isFile()) {
    throw new Error(`${label} must be a regular file: ${absolute}`);
  }
  if (kind === "directory" && targetStat && !targetStat.isDirectory()) {
    throw new Error(`${label} must be a directory: ${absolute}`);
  }
  if (singleLink && targetStat?.isFile() && targetStat.nlink !== 1) {
    throw new Error(`${label} must be a single-link regular file: ${absolute}`);
  }

  let canonical;
  if (targetStat) {
    canonical = fs.realpathSync.native(absolute);
  } else {
    const missingAt = firstMissing < 0 ? segments.length : firstMissing;
    const existingRelative = segments.slice(0, missingAt);
    const missingRelative = segments.slice(missingAt);
    const existingLogical = path.join(logicalBoundary, ...existingRelative);
    canonical = path.join(fs.realpathSync.native(existingLogical), ...missingRelative);
  }
  if (!pathInside(canonical, canonicalBoundary)) {
    throw new Error(`${label} resolves outside its trusted filesystem boundary: ${canonical}`);
  }
  return canonical;
}

export function secureExistingDirectory(target, label) {
  const trustedTarget = trustedPlatformPath(target);
  const boundary = trustedAmbientAnchors(trustedTarget);
  return secureFromBoundary(trustedTarget, boundary, {
    label,
    mustExist: true,
    kind: "directory"
  });
}

export function secureExistingRegularFile(target, label, { singleLink = false } = {}) {
  const trustedTarget = trustedPlatformPath(target);
  const boundary = trustedAmbientAnchors(trustedTarget);
  return secureFromBoundary(trustedTarget, boundary, {
    label,
    mustExist: true,
    kind: "file",
    singleLink
  });
}

export function secureWritablePath(target, label, { boundary = null } = {}) {
  const trustedTarget = trustedPlatformPath(target);
  const trustedBoundary = boundary
    ? secureExistingDirectory(boundary, `${label} authority root`)
    : trustedAmbientAnchors(trustedTarget);
  return secureFromBoundary(trustedTarget, trustedBoundary, { label });
}

function directoryIdentity(target, label) {
  const realPath = secureExistingDirectory(target, label);
  const stat = fs.lstatSync(realPath, { bigint: true });
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`${label} must remain a real directory: ${realPath}`);
  }
  return {
    lexical_path: path.resolve(target),
    real_path: realPath,
    device: String(stat.dev),
    inode: String(stat.ino)
  };
}

function identitiesMatch(left, right) {
  return left.real_path === right.real_path &&
    left.device === right.device &&
    left.inode === right.inode;
}

export function verifySecureDirectoryIdentity(identity, label = "secure directory") {
  const current = directoryIdentity(identity.lexical_path, label);
  if (!identitiesMatch(current, identity)) {
    throw new Error(`${label} physical identity changed during the guarded operation`);
  }
  return current;
}

export function ensureSecureDirectory(target, label, {
  mode = 0o700,
  boundary = null,
  faultInjector = null
} = {}) {
  const canonicalTarget = secureWritablePath(target, label, { boundary });
  let existing = canonicalTarget;
  const missing = [];
  while (!lstatIfPresent(existing)) {
    missing.unshift(path.basename(existing));
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error(`${label} has no existing directory anchor`);
    existing = parent;
  }

  let guard = directoryIdentity(existing, `${label} existing anchor`);
  for (const segment of missing) {
    verifySecureDirectoryIdentity(guard, `${label} parent`);
    const child = path.join(guard.real_path, segment);
    faultInjector?.("before-directory-create", {
      target: canonicalTarget,
      parent: guard.real_path,
      child
    });
    try {
      fs.mkdirSync(child, { mode, recursive: false });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    verifySecureDirectoryIdentity(guard, `${label} parent`);
    const childIdentity = directoryIdentity(child, `${label} component`);
    if (path.dirname(childIdentity.real_path) !== guard.real_path) {
      throw new Error(`${label} component escaped its guarded parent: ${child}`);
    }
    guard = childIdentity;
  }

  const finalIdentity = directoryIdentity(canonicalTarget, label);
  if (!identitiesMatch(finalIdentity, guard)) {
    throw new Error(`${label} physical identity changed during creation`);
  }
  return finalIdentity;
}
