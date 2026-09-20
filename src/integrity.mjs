import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  ensureSecureDirectory,
  secureExistingRegularFile,
  secureWritablePath,
  trustedPlatformPath,
  verifySecureDirectoryIdentity
} from "./path-security.mjs";

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

function pinnedFileIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    links: String(stat.nlink),
    owner_uid: String(stat.uid),
    mode: Number(stat.mode & 0o777n),
    size: String(stat.size),
    mtime_ns: String(stat.mtimeNs),
    ctime_ns: String(stat.ctimeNs)
  };
}

function stableDirectoryIdentity(stat) {
  return {
    device: String(stat.dev),
    inode: String(stat.ino),
    owner_uid: String(stat.uid),
    mode: Number(stat.mode & 0o777n)
  };
}

export function physicalIdentityDigest(identity) {
  return canonicalDigest(identity);
}

function captureDirectory(root, relative, ignores) {
  const directory = path.join(root, relative);
  const before = fs.lstatSync(directory, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink()) {
    throw new Error(`artifact directory changed or became unsupported: ${directory}`);
  }
  const entries = fs.readdirSync(directory, { withFileTypes: true })
    .filter((entry) => !ignores.has(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const contentEntries = [];
  const identityEntries = [{
    type: "directory",
    path: relative || ".",
    identity: stableDirectoryIdentity(before)
  }];

  for (const entry of entries) {
    const entryRelative = path.join(relative, entry.name);
    const absolute = path.join(root, entryRelative);
    if (entry.isSymbolicLink()) {
      throw new Error(`symlink inside artifact is unsupported: ${absolute}`);
    }
    if (entry.isDirectory()) {
      contentEntries.push({ type: "directory", path: entryRelative });
      const nested = captureDirectory(root, entryRelative, ignores);
      contentEntries.push(...nested.contentEntries);
      identityEntries.push(...nested.identityEntries);
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`unsupported entry inside artifact: ${absolute}`);
    }
    const pinned = readFilePinned(absolute, {
      label: `artifact file ${entryRelative}`,
      requireCallerOwned: false
    });
    contentEntries.push({
      type: "file",
      path: entryRelative,
      bytes: pinned.bytes,
      digest: pinned.digest
    });
    identityEntries.push({
      type: "file",
      path: entryRelative,
      identity: pinned.file_identity
    });
  }

  const after = fs.lstatSync(directory, { bigint: true });
  if (!after.isDirectory() || after.isSymbolicLink() ||
    !samePinnedFileIdentity(before, after)) {
    throw new Error(`artifact directory changed while it was being captured: ${directory}`);
  }
  return { contentEntries, identityEntries };
}

function captureArtifact(target, options = {}) {
  const absolute = path.resolve(target);
  const stat = fs.lstatSync(absolute, { bigint: true });
  if (stat.isSymbolicLink()) {
    throw new Error(`symlink artifacts are unsupported: ${absolute}`);
  }
  if (stat.isFile()) {
    const pinned = readFilePinned(absolute, {
      label: options.label || "artifact file",
      requireCallerOwned: false
    });
    return {
      kind: "file",
      bytes: pinned.bytes,
      digest: pinned.digest,
      physical_identity_digest: physicalIdentityDigest({
        type: "file",
        identity: pinned.file_identity
      })
    };
  }
  if (!stat.isDirectory()) throw new Error(`unsupported artifact type: ${absolute}`);
  const ignores = new Set(options.ignores || DEFAULT_HASH_IGNORES);
  const captured = captureDirectory(absolute, "", ignores);
  return {
    kind: "directory",
    bytes: null,
    digest: canonicalDigest({ type: "directory", entries: captured.contentEntries }),
    physical_identity_digest: physicalIdentityDigest({
      type: "directory",
      entries: captured.identityEntries
    })
  };
}

export function hashArtifact(target, options = {}) {
  return captureArtifact(target, options).digest;
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
  const captured = captureArtifact(resolvedPath, options);
  return {
    path: options.label || displayPath(resolvedPath, root),
    resolved_path: resolvedPath,
    ...captured
  };
}

export function verifySnapshot(snapshot, options = {}) {
  if (!snapshot?.resolved_path || !fs.existsSync(snapshot.resolved_path)) {
    return { ok: false, reason: "missing", expected: snapshot?.digest || null, actual: null };
  }
  try {
    if (!snapshot.physical_identity_digest) {
      return {
        ok: false,
        reason: "physical-identity-missing",
        expected: snapshot.digest,
        actual: null
      };
    }
    const captured = captureArtifact(snapshot.resolved_path, options);
    const contentMatches = captured.digest === snapshot.digest;
    const identityMatches = captured.physical_identity_digest === snapshot.physical_identity_digest;
    return {
      ok: contentMatches && identityMatches,
      reason: !contentMatches
        ? "digest-mismatch"
        : !identityMatches ? "physical-identity-mismatch" : null,
      expected: snapshot.digest,
      actual: captured.digest
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

function samePinnedFileIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

export function readFilePinned(target, {
  label = "JSON input",
  securePath = null,
  requireCallerOwned = true,
  requireSingleLink = requireCallerOwned,
  faultInjector = null
} = {}) {
  const trustedTarget = securePath ? target : trustedPlatformPath(target);
  const canonical = securePath
    ? securePath(target, label)
    : secureExistingRegularFile(trustedTarget, label, { singleLink: requireSingleLink });
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  try {
    descriptor = fs.openSync(canonical, flags);
    const before = fs.fstatSync(descriptor, { bigint: true });
    const lexicalBefore = fs.lstatSync(canonical, { bigint: true });
    if (!before.isFile() || !lexicalBefore.isFile() ||
      !samePinnedFileIdentity(before, lexicalBefore)) {
      throw new Error(`${label} changed while its read-only descriptor was being pinned`);
    }
    if (requireSingleLink && before.nlink !== 1n) {
      throw new Error(`${label} must be a single-link file`);
    }
    if (requireCallerOwned && typeof process.getuid === "function") {
      if (before.uid !== BigInt(process.getuid())) {
        throw new Error(`${label} must be owned by the invoking user`);
      }
      if ((before.mode & 0o022n) !== 0n) {
        throw new Error(`${label} must not be group- or world-writable`);
      }
    }

    const source = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    if (!samePinnedFileIdentity(before, after)) {
      throw new Error(`${label} changed while it was being read`);
    }
    faultInjector?.("after-read-before-path-revalidation", {
      path: canonical,
      digest: sha256(source)
    });
    const canonicalAfter = securePath
      ? securePath(canonical, label)
      : secureExistingRegularFile(canonical, label, { singleLink: requireSingleLink });
    const lexicalAfter = fs.lstatSync(canonicalAfter, { bigint: true });
    if (canonicalAfter !== canonical || !samePinnedFileIdentity(after, lexicalAfter)) {
      throw new Error(`${label} path identity changed while it was being read`);
    }

    const digest = sha256(source);
    const bytes = Number(after.size);
    const fileIdentity = pinnedFileIdentity(after);
    const physicalIdentity = physicalIdentityDigest({ type: "file", identity: fileIdentity });
    return {
      path: canonical,
      source,
      digest,
      bytes,
      source_snapshot: {
        path: canonical,
        resolved_path: canonical,
        kind: "file",
        bytes,
        digest,
        physical_identity_digest: physicalIdentity
      },
      file_identity: fileIdentity,
      physical_identity_digest: physicalIdentity
    };
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

export function readJsonPinned(target, options = {}) {
  const pinned = readFilePinned(target, options);
  let input;
  try {
    input = JSON.parse(pinned.source.toString("utf8"));
  } catch (error) {
    throw new Error(`cannot parse ${options.label || "JSON input"} at ${pinned.path}: ${error.message}`);
  }
  const { source: _source, ...metadata } = pinned;
  return { ...metadata, input };
}

function sameFileIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function verifyAtomicTarget(target, parentIdentity, label) {
  verifySecureDirectoryIdentity(parentIdentity, `${label} parent`);
  const canonical = secureWritablePath(target, label, { boundary: parentIdentity.real_path });
  if (path.dirname(canonical) !== parentIdentity.real_path) {
    throw new Error(`${label} escaped its guarded parent directory`);
  }
  if (fs.existsSync(canonical)) {
    const stat = fs.lstatSync(canonical);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} must replace only a regular non-symlink file: ${canonical}`);
    }
  }
  return canonical;
}

function removeTemporaryIfOwned(temporary, identity) {
  try {
    const current = fs.lstatSync(temporary, { bigint: true });
    if (sameFileIdentity(current, identity)) fs.rmSync(temporary);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

export function writeJsonAtomic(filePath, value, {
  label = "JSON output",
  faultInjector = null
} = {}) {
  const preflight = secureWritablePath(trustedPlatformPath(filePath), label);
  faultInjector?.("after-preflight", { target: preflight, parent: path.dirname(preflight) });
  const parentIdentity = ensureSecureDirectory(path.dirname(preflight), `${label} parent`, {
    faultInjector
  });
  const absolute = verifyAtomicTarget(preflight, parentIdentity, label);
  const temporary = path.join(
    parentIdentity.real_path,
    `.${path.basename(absolute)}.${process.pid}.${crypto.randomUUID()}.tmp`
  );
  const flags = fs.constants.O_WRONLY |
    fs.constants.O_CREAT |
    fs.constants.O_EXCL |
    (fs.constants.O_NOFOLLOW || 0);
  let descriptor;
  let temporaryIdentity = null;
  try {
    descriptor = fs.openSync(temporary, flags, 0o600);
    temporaryIdentity = fs.fstatSync(descriptor, { bigint: true });
    faultInjector?.("after-temporary-open", {
      target: absolute,
      parent: parentIdentity.real_path,
      temporary
    });
    verifyAtomicTarget(absolute, parentIdentity, label);
    const lexicalTemporary = fs.lstatSync(temporary, { bigint: true });
    if (!lexicalTemporary.isFile() || lexicalTemporary.isSymbolicLink() ||
      !sameFileIdentity(lexicalTemporary, temporaryIdentity)) {
      throw new Error(`${label} temporary file identity changed before write`);
    }

    fs.writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fs.fsyncSync(descriptor);
    const writtenIdentity = fs.fstatSync(descriptor, { bigint: true });
    if (!sameFileIdentity(writtenIdentity, temporaryIdentity)) {
      throw new Error(`${label} temporary file identity changed while writing`);
    }
    fs.closeSync(descriptor);
    descriptor = undefined;

    faultInjector?.("before-commit", {
      target: absolute,
      parent: parentIdentity.real_path,
      temporary
    });
    verifyAtomicTarget(absolute, parentIdentity, label);
    const commitSource = fs.lstatSync(temporary, { bigint: true });
    if (!sameFileIdentity(commitSource, temporaryIdentity)) {
      throw new Error(`${label} temporary file identity changed before commit`);
    }
    fs.renameSync(temporary, absolute);

    verifySecureDirectoryIdentity(parentIdentity, `${label} parent`);
    const committed = fs.lstatSync(absolute, { bigint: true });
    if (!committed.isFile() || committed.isSymbolicLink() ||
      !sameFileIdentity(committed, temporaryIdentity)) {
      throw new Error(`${label} committed file identity changed during atomic replacement`);
    }
    try {
      const parentDescriptor = fs.openSync(
        parentIdentity.real_path,
        fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0) | (fs.constants.O_NOFOLLOW || 0)
      );
      try {
        fs.fsyncSync(parentDescriptor);
      } finally {
        fs.closeSync(parentDescriptor);
      }
    } catch (error) {
      if (!["EINVAL", "ENOTSUP", "EBADF"].includes(error?.code)) throw error;
    }
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    if (temporaryIdentity) removeTemporaryIfOwned(temporary, temporaryIdentity);
    throw error;
  }
}
