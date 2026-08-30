import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { builtinModules } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  canonicalDigest,
  readFilePinned,
  sha256
} from "./integrity.mjs";
import { RouterError } from "./router.mjs";

const MAX_SEALED_ENTRYPOINT_BYTES = 512 * 1024;
const MAX_SEALED_MODULE_GRAPH_BYTES = 8 * 1024 * 1024;
const MAX_SEALED_MODULES = 256;
const DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const SUPPORTED_MODULE_EXTENSIONS = new Set([".mjs", ".cjs", ".js", ".json"]);
const BUILTIN_SPECIFIERS = new Set([
  ...builtinModules,
  ...builtinModules.map((name) => name.startsWith("node:") ? name : `node:${name}`)
]);

const LOADER_SOURCE = String.raw`
import crypto from "node:crypto";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

const descriptor = Number(process.env.KILLSLOPROUTER_SEALED_GRAPH_FD);
const expectedPayloadDigest = process.env.KILLSLOPROUTER_SEALED_GRAPH_PAYLOAD_DIGEST;
const expectedEntrypoint = process.env.KILLSLOPROUTER_SEALED_ENTRYPOINT_URL;
if (!Number.isInteger(descriptor) || descriptor < 3 || !expectedPayloadDigest || !expectedEntrypoint) {
  throw new Error("KillSlopRouter sealed module graph handoff is invalid");
}
const payloadSource = fs.readFileSync(descriptor);
const actualPayloadDigest = "sha256:" + crypto.createHash("sha256").update(payloadSource).digest("hex");
if (actualPayloadDigest !== expectedPayloadDigest) {
  throw new Error("KillSlopRouter sealed module graph payload digest mismatch");
}
const payload = JSON.parse(payloadSource.toString("utf8"));
if (payload.sealed_module_graph_version !== 1 || payload.entrypoint_url !== expectedEntrypoint ||
  !Array.isArray(payload.modules)) {
  throw new Error("KillSlopRouter sealed module graph authority is invalid");
}
const modules = new Map();
for (const module of payload.modules) {
  const source = Buffer.from(module.source_base64 || "", "base64");
  const digest = "sha256:" + crypto.createHash("sha256").update(source).digest("hex");
  if (!module.url || modules.has(module.url) || source.length !== module.bytes ||
    digest !== module.digest || !["module", "commonjs", "json"].includes(module.module_format)) {
    throw new Error("KillSlopRouter sealed module graph contains an invalid module");
  }
  modules.set(module.url, { ...module, source });
}
if (!modules.has(expectedEntrypoint)) {
  throw new Error("KillSlopRouter sealed module graph omits its entrypoint");
}

function localUrl(specifier, parentURL) {
  try {
    if (specifier.startsWith("file:")) return new URL(specifier).href;
    if (specifier.startsWith("/")) return pathToFileURL(specifier).href;
    if (specifier.startsWith(".") && parentURL) return new URL(specifier, parentURL).href;
  } catch {
    return null;
  }
  return null;
}

export async function resolve(specifier, context, nextResolve) {
  const direct = localUrl(specifier, context.parentURL);
  if (direct && modules.has(direct)) return { url: direct, shortCircuit: true };
  if (context.parentURL && modules.has(context.parentURL) && direct?.startsWith("file:")) {
    throw new Error("sealed adapter attempted to load an unsealed local dependency: " + direct);
  }
  const resolved = await nextResolve(specifier, context);
  if (context.parentURL && modules.has(context.parentURL) && resolved.url.startsWith("file:") &&
    !modules.has(resolved.url)) {
    throw new Error("sealed adapter attempted to load an unsealed dependency: " + resolved.url);
  }
  return resolved;
}

export async function load(url, context, nextLoad) {
  const module = modules.get(url);
  if (module) {
    return { format: module.module_format, source: module.source, shortCircuit: true };
  }
  return nextLoad(url, context);
}
`;

const LOADER_URL = `data:text/javascript;base64,${Buffer.from(LOADER_SOURCE).toString("base64")}`;

function requireValue(condition, message) {
  if (!condition) throw new RouterError(message, 4);
}

function inside(candidate, root) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function moduleReadOptions(modulePath, label, trustedPackageRoot = null) {
  if (!trustedPackageRoot) return { label };
  let physicalPath;
  try {
    physicalPath = fs.realpathSync.native(modulePath);
  } catch {
    physicalPath = path.resolve(modulePath);
  }
  requireValue(inside(physicalPath, trustedPackageRoot),
    `trusted bundled adapter module escaped its package root: ${modulePath}`);
  return {
    label,
    requireCallerOwned: false,
    requireSingleLink: false
  };
}

function moduleFormatForPath(modulePath, { trustedPackageRoot = null } = {}) {
  const extension = path.extname(modulePath).toLowerCase();
  if (extension === ".mjs") return "module";
  if (extension === ".cjs") return "commonjs";
  if (extension === ".json") return "json";
  requireValue(extension === ".js",
    "host adapter modules must use .mjs, .js, .cjs, or .json");
  let directory = path.dirname(modulePath);
  while (true) {
    const packagePath = path.join(directory, "package.json");
    if (fs.existsSync(packagePath)) {
      let pinned;
      try {
        pinned = readFilePinned(packagePath, moduleReadOptions(
          packagePath,
          "host adapter package type authority",
          trustedPackageRoot
        ));
        return JSON.parse(pinned.source.toString("utf8")).type === "module"
          ? "module"
          : "commonjs";
      } catch (error) {
        throw new RouterError(`cannot determine host adapter module format: ${error.message}`, 4);
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) return "commonjs";
    directory = parent;
  }
}

function identifierStart(character) {
  return /[A-Za-z_$]/.test(character || "");
}

function identifierPart(character) {
  return /[A-Za-z0-9_$]/.test(character || "");
}

function decodedEscape(source, index) {
  const character = source[index];
  const simple = {
    b: "\b",
    f: "\f",
    n: "\n",
    r: "\r",
    t: "\t",
    v: "\v",
    0: "\0"
  };
  if (Object.hasOwn(simple, character)) return { value: simple[character], end: index + 1 };
  if (character === "\n") return { value: "", end: index + 1 };
  if (character === "\r") {
    return { value: "", end: source[index + 1] === "\n" ? index + 2 : index + 1 };
  }
  if (character === "x" && /^[0-9A-Fa-f]{2}$/.test(source.slice(index + 1, index + 3))) {
    return {
      value: String.fromCodePoint(Number.parseInt(source.slice(index + 1, index + 3), 16)),
      end: index + 3
    };
  }
  if (character === "u") {
    const braced = source.slice(index + 1).match(/^\{([0-9A-Fa-f]{1,6})\}/);
    if (braced) {
      return {
        value: String.fromCodePoint(Number.parseInt(braced[1], 16)),
        end: index + 1 + braced[0].length
      };
    }
    const fixed = source.slice(index + 1, index + 5);
    if (/^[0-9A-Fa-f]{4}$/.test(fixed)) {
      return {
        value: String.fromCodePoint(Number.parseInt(fixed, 16)),
        end: index + 5
      };
    }
  }
  return { value: character || "", end: index + 1 };
}

function readStringToken(source, start) {
  const quote = source[start];
  let value = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index];
    if (character === quote) {
      return { token: { type: "string", value }, end: index + 1 };
    }
    if (character === "\n" || character === "\r") return null;
    if (character === "\\") {
      const decoded = decodedEscape(source, index + 1);
      value += decoded.value;
      index = decoded.end;
      continue;
    }
    value += character;
    index += 1;
  }
  return null;
}

function regexMayStart(previous) {
  if (!previous) return true;
  if (previous.type === "identifier") {
    return new Set([
      "await", "case", "delete", "else", "in", "instanceof", "new", "of",
      "return", "throw", "typeof", "void", "yield"
    ]).has(previous.value);
  }
  if (["string", "number", "regex", "template"].includes(previous.type)) return false;
  return ![")", "]", "}", "++", "--"].includes(previous.value);
}

function skipRegexLiteral(source, start) {
  let index = start + 1;
  let inClass = false;
  while (index < source.length) {
    const character = source[index];
    if (character === "\\") {
      index += 2;
      continue;
    }
    if (character === "[") inClass = true;
    else if (character === "]") inClass = false;
    else if (character === "/" && !inClass) {
      index += 1;
      while (/[A-Za-z]/.test(source[index] || "")) index += 1;
      return index;
    } else if (character === "\n" || character === "\r") {
      return start + 1;
    }
    index += 1;
  }
  return start + 1;
}

function scanModuleTokens(source, start = 0, stopAtTemplateExpressionEnd = false) {
  const tokens = [];
  let index = start;
  let braceDepth = 0;
  while (index < source.length) {
    const character = source[index];
    if (stopAtTemplateExpressionEnd && character === "}" && braceDepth === 0) {
      return { tokens, end: index + 1, closed: true };
    }
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "/") {
      index += 2;
      while (index < source.length && !["\n", "\r"].includes(source[index])) index += 1;
      continue;
    }
    if (character === "/" && source[index + 1] === "*") {
      const end = source.indexOf("*/", index + 2);
      index = end < 0 ? source.length : end + 2;
      continue;
    }
    if (character === "'" || character === '"') {
      const parsed = readStringToken(source, index);
      if (!parsed) {
        index += 1;
        continue;
      }
      tokens.push(parsed.token);
      index = parsed.end;
      continue;
    }
    if (character === "`") {
      tokens.push({ type: "template", value: "`" });
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") {
          index += 2;
          continue;
        }
        if (source[index] === "`") {
          index += 1;
          break;
        }
        if (source[index] === "$" && source[index + 1] === "{") {
          tokens.push({ type: "punct", value: "${" });
          const expression = scanModuleTokens(source, index + 2, true);
          tokens.push(...expression.tokens);
          tokens.push({ type: "punct", value: "}" });
          index = expression.end;
          continue;
        }
        index += 1;
      }
      continue;
    }
    if (character === "/" && regexMayStart(tokens.at(-1))) {
      const end = skipRegexLiteral(source, index);
      if (end > index + 1) {
        tokens.push({ type: "regex", value: "/" });
        index = end;
        continue;
      }
    }
    if (identifierStart(character)) {
      let end = index + 1;
      while (identifierPart(source[end])) end += 1;
      tokens.push({ type: "identifier", value: source.slice(index, end) });
      index = end;
      continue;
    }
    if (/[0-9]/.test(character)) {
      let end = index + 1;
      while (/[0-9A-Za-z_.]/.test(source[end] || "")) end += 1;
      tokens.push({ type: "number", value: source.slice(index, end) });
      index = end;
      continue;
    }
    const pair = source.slice(index, index + 2);
    const value = ["=>", "++", "--", "&&", "||", "??", "?."].includes(pair)
      ? pair
      : character;
    tokens.push({ type: "punct", value });
    if (stopAtTemplateExpressionEnd) {
      if (["{", "(", "["].includes(value)) braceDepth += 1;
      else if (["}", ")", "]"].includes(value) && braceDepth > 0) braceDepth -= 1;
    }
    index += value.length;
  }
  return { tokens, end: source.length, closed: !stopAtTemplateExpressionEnd };
}

function moduleTokens(source) {
  return scanModuleTokens(source).tokens;
}

function delimiterPairs(tokens, open, close) {
  const pairs = new Map();
  const stack = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].value === open) {
      stack.push(index);
      continue;
    }
    if (tokens[index].value !== close || stack.length === 0) continue;
    const start = stack.pop();
    pairs.set(start, index);
    pairs.set(index, start);
  }
  return pairs;
}

function containingRange(ranges, index) {
  return ranges
    .filter((range) => range.start < index && index < range.end)
    .sort((left, right) => (left.end - left.start) - (right.end - right.start))[0] || null;
}

function bindingScopeFor(index, blockRanges, functionRanges, kind) {
  if (kind === "var") {
    return containingRange(functionRanges, index) || {
      start: -1,
      end: Number.MAX_SAFE_INTEGER
    };
  }
  return containingRange(blockRanges, index) || {
    start: -1,
    end: Number.MAX_SAFE_INTEGER
  };
}

function directParameterBindsRequire(tokens, start, end) {
  let nested = 0;
  for (let index = start; index < end; index += 1) {
    const value = tokens[index].value;
    if (["(", "[", "{"].includes(value)) {
      nested += 1;
      continue;
    }
    if ([")", "]", "}"].includes(value)) {
      nested = Math.max(0, nested - 1);
      continue;
    }
    if (nested > 0 || tokens[index].type !== "identifier" || value !== "require") continue;
    const previous = tokens[index - 1]?.value;
    const next = tokens[index + 1]?.value;
    if ((index === start || previous === "," ||
      tokens.slice(Math.max(start, index - 3), index).every((item) => item.value === ".")) &&
      (index + 1 === end || [",", "=", ")"].includes(next))) {
      return true;
    }
  }
  return false;
}

function functionDeclarationAt(tokens, index) {
  let previous = index - 1;
  if (tokens[previous]?.value === "async") previous -= 1;
  if (tokens[previous]?.value === "default") previous -= 1;
  if (tokens[previous]?.value === "export") return true;
  return previous < 0 || ["{", "}", ";"].includes(tokens[previous]?.value);
}

function functionDescriptors(tokens, parens, braces) {
  const descriptors = [];
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== "identifier" || tokens[index].value !== "function") continue;
    let cursor = index + 1;
    if (tokens[cursor]?.value === "*") cursor += 1;
    const nameIndex = tokens[cursor]?.type === "identifier" ? cursor : null;
    if (nameIndex !== null) cursor += 1;
    if (tokens[cursor]?.value !== "(" || !parens.has(cursor)) continue;
    const parametersEnd = parens.get(cursor);
    const bodyStart = parametersEnd + 1;
    if (tokens[bodyStart]?.value !== "{" || !braces.has(bodyStart)) continue;
    descriptors.push({
      tokenIndex: index,
      name: nameIndex === null ? null : tokens[nameIndex].value,
      declaration: functionDeclarationAt(tokens, index),
      parametersStart: cursor + 1,
      parametersEnd,
      start: bodyStart,
      end: braces.get(bodyStart)
    });
  }
  return descriptors;
}

function arrowBodyRange(tokens, arrowIndex, braces, parens, brackets) {
  const start = arrowIndex + 1;
  if (tokens[start]?.value === "{" && braces.has(start)) {
    return { start, end: braces.get(start) };
  }
  let cursor = start;
  while (cursor < tokens.length) {
    const value = tokens[cursor].value;
    const pair = value === "(" ? parens.get(cursor)
      : value === "[" ? brackets.get(cursor)
        : value === "{" ? braces.get(cursor)
          : null;
    if (pair !== null && pair !== undefined && pair > cursor) {
      cursor = pair + 1;
      continue;
    }
    if ([",", ";", "}"].includes(value)) break;
    cursor += 1;
  }
  return { start: arrowIndex, end: Math.max(arrowIndex + 1, cursor) };
}

function declarationBindsRequire(tokens, declarationIndex, pairs, limit) {
  let cursor = declarationIndex + 1;
  let expectBinding = true;
  while (cursor < limit) {
    const value = tokens[cursor].value;
    if (value === ";") break;
    const pair = ["(", "[", "{"].includes(value) ? pairs.get(cursor) : null;
    if (pair !== null && pair !== undefined && pair > cursor) {
      if (expectBinding && value !== "(") expectBinding = false;
      cursor = pair + 1;
      continue;
    }
    if (value === ",") {
      expectBinding = true;
      cursor += 1;
      continue;
    }
    if (expectBinding && tokens[cursor].type === "identifier") {
      if (value === "require") return true;
      expectBinding = false;
    }
    cursor += 1;
  }
  return false;
}

function requireShadowRanges(tokens) {
  const parens = delimiterPairs(tokens, "(", ")");
  const braces = delimiterPairs(tokens, "{", "}");
  const brackets = delimiterPairs(tokens, "[", "]");
  const allPairs = new Map([...parens, ...braces, ...brackets]);
  const blockRanges = [...braces.entries()]
    .filter(([start, end]) => start < end)
    .map(([start, end]) => ({ start, end }));
  const functions = functionDescriptors(tokens, parens, braces);
  const functionRanges = functions.map(({ start, end }) => ({ start, end }));
  const ranges = [];

  for (const descriptor of functions) {
    if (directParameterBindsRequire(
      tokens,
      descriptor.parametersStart,
      descriptor.parametersEnd
    )) {
      ranges.push({ start: descriptor.start, end: descriptor.end });
    }
    if (descriptor.name !== "require") continue;
    ranges.push({ start: descriptor.start, end: descriptor.end });
    if (descriptor.declaration) {
      ranges.push(bindingScopeFor(
        descriptor.tokenIndex,
        blockRanges,
        functionRanges,
        "function"
      ));
    }
  }

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.value === "=>") {
      const body = arrowBodyRange(tokens, index, braces, parens, brackets);
      const previous = tokens[index - 1];
      const binds = previous?.type === "identifier" && previous.value === "require" ||
        previous?.value === ")" && parens.has(index - 1) &&
          directParameterBindsRequire(tokens, parens.get(index - 1) + 1, index - 1);
      if (binds) ranges.push(body);
      continue;
    }
    if (token.type === "identifier" && token.value === "catch" &&
      tokens[index + 1]?.value === "(" && parens.has(index + 1)) {
      const parametersEnd = parens.get(index + 1);
      const bodyStart = parametersEnd + 1;
      if (tokens[bodyStart]?.value === "{" && braces.has(bodyStart) &&
        directParameterBindsRequire(tokens, index + 2, parametersEnd)) {
        ranges.push({ start: bodyStart, end: braces.get(bodyStart) });
      }
      continue;
    }
    if (token.type !== "identifier") continue;
    if (["var", "let", "const"].includes(token.value)) {
      const scope = bindingScopeFor(index, blockRanges, functionRanges, token.value);
      if (declarationBindsRequire(tokens, index, allPairs, scope.end)) ranges.push(scope);
      continue;
    }
    if (token.value === "class" && tokens[index + 1]?.value === "require") {
      ranges.push(bindingScopeFor(index, blockRanges, functionRanges, "class"));
    }
  }
  return ranges;
}

function declaredSpecifiers(source, moduleFormat) {
  const tokens = moduleTokens(source);
  const specifiers = new Set();
  const shadowedRequire = moduleFormat === "commonjs" ? requireShadowRanges(tokens) : [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1];
    if (moduleFormat === "commonjs" &&
      token.type === "identifier" && token.value === "require" &&
      tokens[index - 1]?.value !== "." && next?.value === "(" &&
      tokens[index + 2]?.type === "string" && tokens[index + 3]?.value === ")" &&
      !shadowedRequire.some((range) => range.start < index && index < range.end)) {
      specifiers.add(tokens[index + 2].value);
      continue;
    }
    if (token.type !== "identifier" || !["import", "export"].includes(token.value)) continue;
    if (token.value === "import" && next?.type === "string") {
      specifiers.add(next.value);
      continue;
    }
    if (token.value === "import" && next?.value === "(" &&
      tokens[index + 2]?.type === "string" && tokens[index + 3]?.value === ")") {
      specifiers.add(tokens[index + 2].value);
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
      if (tokens[cursor].value === ";") break;
      if (tokens[cursor].type === "identifier" && tokens[cursor].value === "from" &&
        tokens[cursor + 1]?.type === "string") {
        specifiers.add(tokens[cursor + 1].value);
        break;
      }
    }
  }
  return { specifiers: [...specifiers], tokens };
}

function resolveDeclaredModule(specifier, parentPath) {
  if (BUILTIN_SPECIFIERS.has(specifier)) return null;
  requireValue(
    specifier.startsWith(".") || specifier.startsWith("/") || specifier.startsWith("file:"),
    `sealed host adapters cannot import an unsealed package: ${specifier}`
  );
  let parsed;
  try {
    parsed = specifier.startsWith("file:")
      ? new URL(specifier)
      : specifier.startsWith("/")
        ? pathToFileURL(specifier)
        : new URL(specifier, pathToFileURL(parentPath));
  } catch (error) {
    throw new RouterError(`cannot resolve sealed adapter dependency ${specifier}: ${error.message}`, 4);
  }
  requireValue(parsed.protocol === "file:" && !parsed.search && !parsed.hash,
    `sealed adapter dependency must be an exact file URL: ${specifier}`);
  const candidate = fileURLToPath(parsed);
  requireValue(SUPPORTED_MODULE_EXTENSIONS.has(path.extname(candidate).toLowerCase()),
    `sealed adapter dependency requires an explicit supported extension: ${specifier}`);
  requireValue(fs.existsSync(candidate), `sealed adapter dependency is missing: ${candidate}`);
  return candidate;
}

function graphDigestBody(graph) {
  return {
    sealed_module_graph_version: 1,
    entrypoint_url: graph.entrypoint_url,
    modules: graph.modules.map((module) => ({
      url: module.url,
      module_format: module.module_format,
      bytes: module.bytes,
      digest: module.digest
    }))
  };
}

function captureModuleGraph(entrypoint, { trustedPackageRoot = null } = {}) {
  const trustedRoot = trustedPackageRoot
    ? fs.realpathSync.native(path.resolve(trustedPackageRoot))
    : null;
  if (trustedRoot) {
    requireValue(inside(fs.realpathSync.native(path.resolve(entrypoint)), trustedRoot),
      `trusted bundled adapter entrypoint escaped its package root: ${entrypoint}`);
  }
  const pending = [path.resolve(entrypoint)];
  const captured = new Map();
  let canonicalEntrypoint = null;
  let totalBytes = 0;
  while (pending.length > 0) {
    const requested = pending.shift();
    let pinned;
    try {
      pinned = readFilePinned(requested, moduleReadOptions(
        requested,
        `host adapter module ${requested}`,
        trustedRoot
      ));
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    canonicalEntrypoint ||= pinned.path;
    if (captured.has(pinned.path)) continue;
    requireValue(captured.size < MAX_SEALED_MODULES,
      `host adapter module graph exceeds ${MAX_SEALED_MODULES} modules`);
    requireValue(pinned.bytes <= MAX_SEALED_ENTRYPOINT_BYTES,
      `host adapter module exceeds the ${MAX_SEALED_ENTRYPOINT_BYTES}-byte sealed execution limit`);
    totalBytes += pinned.bytes;
    requireValue(totalBytes <= MAX_SEALED_MODULE_GRAPH_BYTES,
      `host adapter module graph exceeds the ${MAX_SEALED_MODULE_GRAPH_BYTES}-byte sealed handoff limit`);
    const moduleFormat = moduleFormatForPath(pinned.path, {
      trustedPackageRoot: trustedRoot
    });
    const source = pinned.source.toString("utf8");
    const declared = declaredSpecifiers(source, moduleFormat);
    if (declared.tokens.some((token) =>
      token.type === "identifier" && token.value === "createRequire")) {
      const officialPlaywright = path.resolve(pinned.path) === path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "adapters",
        "playwright-browser.mjs"
      );
      requireValue(officialPlaywright,
        "sealed host adapters cannot use createRequire outside the official Playwright runtime boundary");
    }
    const module = {
      path: pinned.path,
      url: pathToFileURL(pinned.path).href,
      module_format: moduleFormat,
      bytes: pinned.bytes,
      digest: pinned.digest,
      physical_identity_digest: pinned.physical_identity_digest,
      source_base64: pinned.source.toString("base64")
    };
    captured.set(pinned.path, module);
    if (moduleFormat === "json") continue;
    for (const specifier of declared.specifiers) {
      const dependency = resolveDeclaredModule(specifier, pinned.path);
      if (dependency) pending.push(dependency);
    }
  }
  const modules = [...captured.values()].sort((left, right) => left.url.localeCompare(right.url));
  const entrypointModule = modules.find((module) => module.path === canonicalEntrypoint);
  requireValue(entrypointModule, "sealed host adapter graph omitted its entrypoint");
  const graph = {
    sealed_module_graph_version: 1,
    entrypoint_url: entrypointModule.url,
    modules
  };
  return {
    graph,
    entrypointModule,
    graphDigest: canonicalDigest(graphDigestBody(graph)),
    totalBytes
  };
}

export function sealedEntrypointGraphDigest(entrypoint, options = {}) {
  return captureModuleGraph(entrypoint, options).graphDigest;
}

function authorityBody(authority) {
  const { authority_digest: _digest, ...body } = authority;
  return body;
}

export function createSealedEntrypointAuthority(entrypoint, expectedDigest, {
  label = "host adapter entrypoint",
  expectedGraphDigest = null,
  trustedPackageRoot = null
} = {}) {
  requireValue(DIGEST_PATTERN.test(expectedDigest || ""),
    `${label} requires an exact SHA-256 digest`);
  const captured = captureModuleGraph(entrypoint, { trustedPackageRoot });
  requireValue(captured.entrypointModule.digest === expectedDigest, `${label} digest mismatch`);
  if (captured.graph.modules.length > 1) {
    requireValue(DIGEST_PATTERN.test(expectedGraphDigest || ""),
      `${label} imports local modules and requires entrypoint_graph_digest`);
  }
  if (expectedGraphDigest !== null) {
    requireValue(DIGEST_PATTERN.test(expectedGraphDigest),
      `${label} entrypoint_graph_digest is invalid`);
    requireValue(captured.graphDigest === expectedGraphDigest,
      `${label} module graph digest mismatch`);
  }
  const entrypointModule = captured.entrypointModule;
  const body = {
    sealed_entrypoint_authority_version: 2,
    path: entrypointModule.path,
    module_format: entrypointModule.module_format,
    bytes: entrypointModule.bytes,
    digest: entrypointModule.digest,
    physical_identity_digest: entrypointModule.physical_identity_digest,
    source_base64: entrypointModule.source_base64,
    graph_digest: captured.graphDigest,
    graph_bytes: captured.totalBytes,
    module_graph: captured.graph
  };
  return { ...body, authority_digest: canonicalDigest(body) };
}

export function verifySealedEntrypointAuthority(authority, {
  label = "host adapter entrypoint at final child boundary"
} = {}) {
  requireValue(authority?.sealed_entrypoint_authority_version === 2,
    `${label} lacks sealed module-graph authority`);
  requireValue(canonicalDigest(authorityBody(authority)) === authority.authority_digest,
    `${label} authority digest mismatch`);
  requireValue(authority.module_graph?.sealed_module_graph_version === 1 &&
    Array.isArray(authority.module_graph.modules) && authority.module_graph.modules.length > 0,
  `${label} module graph is invalid`);
  requireValue(canonicalDigest(graphDigestBody(authority.module_graph)) === authority.graph_digest,
    `${label} module graph digest mismatch`);
  requireValue(authority.module_graph.entrypoint_url === pathToFileURL(authority.path).href,
    `${label} module graph targets a different entrypoint`);
  let totalBytes = 0;
  let entrypointPinned = null;
  const urls = new Set();
  for (const module of authority.module_graph.modules) {
    requireValue(!urls.has(module.url) && pathToFileURL(module.path).href === module.url,
      `${label} module graph contains duplicate or conflicting paths`);
    urls.add(module.url);
    const source = Buffer.from(module.source_base64 || "", "base64");
    requireValue(source.length === module.bytes && sha256(source) === module.digest,
      `${label} sealed module source digest mismatch: ${module.path}`);
    let pinned;
    try {
      // Initial authority creation enforces the source policy. At this final
      // boundary the previously captured physical identity (including owner and
      // link count) is compared exactly, so installed package hardlinks do not
      // need a second caller-ownership policy check.
      pinned = readFilePinned(module.path, {
        label: `${label} module ${module.path}`,
        requireCallerOwned: false,
        requireSingleLink: false
      });
    } catch (error) {
      throw new RouterError(error.message, 4);
    }
    requireValue(
      pinned.digest === module.digest &&
        pinned.bytes === module.bytes &&
        pinned.physical_identity_digest === module.physical_identity_digest,
      `${label} imported module changed after manifest verification: ${module.path}`
    );
    totalBytes += module.bytes;
    if (module.path === authority.path) entrypointPinned = pinned;
  }
  requireValue(totalBytes === authority.graph_bytes && totalBytes <= MAX_SEALED_MODULE_GRAPH_BYTES,
    `${label} module graph byte count mismatch`);
  requireValue(entrypointPinned && entrypointPinned.digest === authority.digest &&
    entrypointPinned.physical_identity_digest === authority.physical_identity_digest,
  `${label} entrypoint conflicts with its module graph`);
  return entrypointPinned;
}

function graphHandoff(authority) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "killsloprouter-module-graph-"));
  fs.chmodSync(directory, 0o700);
  const graphPath = path.join(directory, "graph.json");
  const payload = Buffer.from(JSON.stringify(authority.module_graph));
  let descriptor = null;
  try {
    fs.writeFileSync(graphPath, payload, { mode: 0o600, flag: "wx" });
    descriptor = fs.openSync(graphPath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    return {
      descriptor,
      payloadDigest: sha256(payload),
      cleanup() {
        if (descriptor !== null) {
          fs.closeSync(descriptor);
          descriptor = null;
        }
        fs.rmSync(directory, { recursive: true, force: true });
      }
    };
  } catch (error) {
    if (descriptor !== null) fs.closeSync(descriptor);
    fs.rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

function stdioWithGraphDescriptor(stdio, descriptor) {
  if (Array.isArray(stdio)) {
    requireValue(stdio.length <= 3,
      "sealed adapter spawn reserves child descriptor 3 for module authority");
    return [...stdio, ...Array(Math.max(0, 3 - stdio.length)).fill("pipe"), descriptor];
  }
  const mode = stdio || "pipe";
  requireValue(["pipe", "ignore", "inherit"].includes(mode),
    "sealed adapter spawn requires pipe, ignore, inherit, or a three-entry stdio array");
  return [mode, mode, mode, descriptor];
}

export function spawnSealedNodeEntrypoint(authority, args = [], options = {}) {
  verifySealedEntrypointAuthority(authority);
  const handoff = graphHandoff(authority);
  const environment = {
    ...(options.env || process.env),
    KILLSLOPROUTER_SEALED_ENTRYPOINT_URL: pathToFileURL(authority.path).href,
    KILLSLOPROUTER_SEALED_GRAPH_FD: "3",
    KILLSLOPROUTER_SEALED_GRAPH_PAYLOAD_DIGEST: handoff.payloadDigest
  };
  const { stdio = undefined, ...spawnOptions } = options;
  try {
    return spawnSync(process.execPath, [
      "--no-warnings",
      "--experimental-loader",
      LOADER_URL,
      authority.path,
      ...args
    ], {
      ...spawnOptions,
      stdio: stdioWithGraphDescriptor(stdio, handoff.descriptor),
      env: environment,
      shell: false
    });
  } finally {
    handoff.cleanup();
  }
}

export {
  MAX_SEALED_ENTRYPOINT_BYTES,
  MAX_SEALED_MODULE_GRAPH_BYTES,
  MAX_SEALED_MODULES
};
