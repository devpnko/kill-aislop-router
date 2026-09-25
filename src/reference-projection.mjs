import crypto from "node:crypto";
import { RouterError } from "./router.mjs";
import { projectComponentRecipe } from "./component-recipes.mjs";

// Local join keys are not product names. A plain-word reference_id may also be
// ordinary task vocabulary (e.g. a category or an exclusion). It is forbidden
// in a provenance slot or explicit identifier claim, not globally in prose.
// Technical keys remain opaque; external names/URIs/record IDs retain the
// conservative substring firewall, including in negative transfer clauses.
const IDENTIFIER_LABEL = "(?:data[-_ ]?)?(?:(?:references?|refs?|sources?)(?:[-_ ]?(?:reference|record))?(?:[-_ ]?ids?)?|(?:product|screen)[-_ ]?record[-_ ]?ids?)";
const PROVENANCE_KEY = new RegExp(`^${IDENTIFIER_LABEL}$`, "i");
const TAG_LABEL = IDENTIFIER_LABEL.replaceAll("[-_ ]", "[-_]");
const DIAGNOSTIC_KEYS = new Set((
  "causal_reasoning transferable_grammar reasoning_id grammar_id user_decision " +
  "likely_constraint consequence_if_flattened confidence dimension principle application " +
  "application_conditions tradeoff harmful_when requires_live_data component_recipe anatomy " +
  "treatment preserve_character avoid reasoning_ids prototypes contract_claims rationale " +
  "intent signature palette color_system reference_reasoning_trace nested text value"
).split(" "));

function normalized(value) { return value.trim().toLocaleLowerCase("en"); }
function escaped(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// Read metadata without evaluating JS, parsing a DOM, or interpreting template
// expressions. Unsupported/malformed values consume the remaining range, so
// an unfinished provenance construct cannot gain the ordinary-prose exemption.
function quoteEnd(text, start) {
  for (let cursor = start + 1; cursor < text.length; cursor += 1) {
    if (text[cursor] === "\\") cursor += 1;
    else if (text[cursor] === text[start]) return cursor + 1;
  }
  return text.length;
}

function triviaEnd(text, start) {
  let cursor = start;
  while (cursor < text.length) {
    if (/\s/.test(text[cursor])) cursor += 1;
    else if (text.startsWith("/*", cursor)) {
      const end = text.indexOf("*/", cursor + 2);
      if (end < 0) return text.length;
      cursor = end + 2;
    } else if (text.startsWith("//", cursor)) {
      const end = text.indexOf("\n", cursor + 2);
      if (end < 0) return text.length;
      cursor = end + 1;
    } else break;
  }
  return cursor;
}

function primaryEnd(text, start) {
  if ('"\'`'.includes(text[start] || "\0")) return quoteEnd(text, start);
  const pairs = { "[": "]", "{": "}", "(": ")" };
  if (!pairs[text[start]]) {
    let cursor = start;
    while (cursor < text.length && !/[\s,;\])}<>]/.test(text[cursor])) cursor += 1;
    return cursor;
  }
  const stack = [];
  for (let cursor = start; cursor < text.length; cursor += 1) {
    const char = text[cursor];
    if ('"\'`'.includes(char)) { cursor = quoteEnd(text, cursor) - 1; continue; }
    if (text.startsWith("/*", cursor) || text.startsWith("//", cursor)) {
      cursor = triviaEnd(text, cursor) - 1;
      continue;
    }
    if (pairs[char]) {
      stack.push(pairs[char]);
      if (stack.length > 64) return text.length;
    } else if ("]})".includes(char)) {
      if (stack.pop() !== char) return text.length;
      if (!stack.length) return cursor + 1;
    }
  }
  return text.length;
}

function valueEnd(text, start, markup) {
  // A closed first atom is not a closed RHS: "" + "id", [].concat(...),
  // property access, calls and parenthesized continuations stay in provenance.
  // Stop only at a lexical expression boundary; never evaluate the expression.
  let cursor = start;
  while (cursor < text.length) {
    const char = text[cursor];
    if (/[;,\])}]/.test(char) || (markup && /[<>]/.test(char)) ||
      /^<\/(?:script|style)\s*>/i.test(text.slice(cursor))) {
      return cursor === start ? text.length : cursor;
    }
    if ('"\'`[{('.includes(char)) { cursor = primaryEnd(text, cursor); continue; }
    if (/\s/.test(char) || text.startsWith("/*", cursor) || text.startsWith("//", cursor)) {
      const next = triviaEnd(text, cursor);
      const preceding = text.slice(start, cursor).trimEnd();
      const previous = preceding.at(-1) || "";
      const continuing = /[+\-*/%?:=|&!.<>]/.test(previous) ||
        /[+\-*/%?:|&.([`<>]/.test(text[next] || "\0") ||
        /\b(?:new|await|yield|typeof|void|delete|instanceof|in)$/.test(preceding);
      if (!continuing && (/[\r\n]/.test(text.slice(cursor, next)) ||
        /^[A-Za-z_:][\w:-]*\s*=/.test(text.slice(next)))) return cursor;
      cursor = next;
      continue;
    }
    cursor += 1;
  }
  return text.length;
}

function tagEnd(text, start) {
  for (let cursor = start; cursor < text.length; cursor += 1) {
    if ('"\''.includes(text[cursor])) cursor = quoteEnd(text, cursor) - 1;
    else if (text[cursor] === ">") return cursor + 1;
  }
  return text.length;
}

function openingAttributes(text, start) {
  const attributes = [];
  let cursor = start;
  while (cursor < text.length) {
    const whitespace = /^\s*/.exec(text.slice(cursor))[0].length;
    cursor += whitespace;
    if (text[cursor] === ">") return { end: cursor + 1, attributes };
    if (text.startsWith("/>", cursor)) return { end: cursor + 2, attributes };
    // In particular, JS `a<b && ... > ...` is not an opening tag. Do not
    // derive markup boundaries from an arbitrary less-than/identifier pair.
    if (!whitespace) return null;
    const name = /^[A-Za-z_:][\w:.-]*/.exec(text.slice(cursor));
    if (!name) return null;
    const nameStart = cursor;
    const nameEnd = cursor + name[0].length;
    cursor = nameEnd;
    const equals = cursor + /^\s*/.exec(text.slice(cursor))[0].length;
    if (text[equals] !== "=") {
      attributes.push({ nameStart, nameEnd });
      continue;
    }
    cursor = equals + 1;
    cursor += /^\s*/.exec(text.slice(cursor))[0].length;
    const valueStart = cursor;
    const quoted = '"\''.includes(text[cursor] || "\0");
    if (quoted) cursor = quoteEnd(text, cursor);
    else if (text[cursor] === "{") cursor = primaryEnd(text, cursor);
    else {
      const value = /^[^\s"'`=<>]+/.exec(text.slice(cursor));
      if (!value) return null;
      cursor += value[0].length;
    }
    attributes.push({ nameStart, nameEnd, valueStart, valueEnd: cursor, quoted });
  }
  return null;
}

function attributeContext(text, index) {
  const tags = /<!--|<([A-Za-z][\w:-]*)(?=[\s/>])/g;
  for (let tag = tags.exec(text); tag && tag.index <= index; tag = tags.exec(text)) {
    if (tag[0] === "<!--") {
      const close = text.indexOf("-->", tags.lastIndex);
      tags.lastIndex = close < 0 ? text.length : close + 3;
      if (index < tags.lastIndex) return null;
      continue;
    }
    const opening = openingAttributes(text, tags.lastIndex);
    if (!opening) continue;
    if (index < opening.end) {
      for (const attribute of opening.attributes) {
        if (index >= attribute.nameStart && index < attribute.nameEnd) {
          return { markup: true, end: opening.end };
        }
        if (index >= attribute.valueStart && index < attribute.valueEnd) {
          // Code/JSON inside a quoted attribute is not HTML attribute syntax.
          // Bound it to that value so later attributes/body cannot be captured.
          return { markup: false, end: attribute.valueEnd - (attribute.quoted ? 1 : 0) };
        }
      }
      return null;
    }
    tags.lastIndex = opening.end;
    if (/^(?:script|style)$/i.test(tag[1])) {
      const closing = new RegExp(`</${tag[1]}\\s*>`, "gi");
      closing.lastIndex = opening.end;
      const close = closing.exec(text);
      const rawEnd = close ? close.index : text.length;
      if (index < rawEnd) return null;
      tags.lastIndex = close ? closing.lastIndex : text.length;
    }
  }
  return null;
}

function markupEnd(text, start, name) {
  const openEnd = tagEnd(text, start);
  if (/\/\s*>$/.test(text.slice(start, openEnd))) return openEnd;
  // HTML source is void even without '/>'. Explicit XML-style closing source
  // metadata still binds its body, but ordinary <picture> content must not
  // capture an unrelated following paragraph as provenance.
  if (normalized(name) === "source" &&
    !/<\s*\/\s*source\s*>/i.test(text.slice(openEnd))) return openEnd;
  const tags = new RegExp(`<\\s*(/?)\\s*${escaped(name)}(?=[\\s/>])`, "gi");
  tags.lastIndex = openEnd;
  let depth = 1;
  for (let tag = tags.exec(text); tag; tag = tags.exec(text)) {
    const end = tagEnd(text, tag.index);
    if (tag[1]) depth -= 1;
    else if (!/\/\s*>$/.test(text.slice(tag.index, end))) depth += 1;
    if (!depth) return end;
    if (depth > 64) break;
    tags.lastIndex = end;
  }
  return text.length;
}

function metadataContains(text, token) {
  const includes = (start, end) => text.slice(start, end).toLocaleLowerCase("en").includes(token);
  const labels = new RegExp(`(^|[^\\w-])(${IDENTIFIER_LABEL})(?![\\w-])`, "gi");
  for (const label of text.matchAll(labels)) {
    // Opening/closing tag names belong to the markup-range check below, not
    // to a JS comparison whose '>' might consume a following sibling's text.
    if (/<\s*\/?\s*$/.test(text.slice(0, label.index + label[1].length))) continue;
    let cursor = label.index + label[0].length;
    if ('"\'`'.includes(text[cursor] || "\0")) cursor += 1;
    cursor = triviaEnd(text, cursor);
    if (text[cursor] === "]") cursor = triviaEnd(text, cursor + 1);
    const pathStart = cursor;
    while (cursor < text.length) {
      if (text[cursor] === "." || text.startsWith("?.", cursor)) {
        const propertyStart = triviaEnd(text, cursor + (text[cursor] === "?" ? 2 : 1));
        const property = /^[A-Za-z_$][\w$]*/.exec(text.slice(propertyStart));
        if (!property) { cursor = text.length; break; }
        cursor = triviaEnd(text, propertyStart + property[0].length);
      } else if (text[cursor] === "[" || text[cursor] === "(") {
        cursor = triviaEnd(text, primaryEnd(text, cursor));
      } else break;
    }
    if (includes(pathStart, cursor)) return true;
    if (cursor === text.length && includes(label.index, cursor)) return true;
    // JS assignment/comparison/logical operators and CSS attribute matchers
    // express provenance too; do not silently downgrade them to ordinary prose.
    const operator = /^(?::|#|[+\-*/%&|^?<>!~$]{0,3}={1,3}|\?\?|&&|\|\||[<>])/.exec(text.slice(cursor));
    if (!operator) continue;
    cursor += operator[0].length;
    const start = triviaEnd(text, cursor);
    const context = attributeContext(text, label.index + label[1].length);
    const bounded = context ? text.slice(0, context.end) : text;
    if (includes(cursor, valueEnd(bounded, start, context?.markup === true))) return true;
  }
  const tags = new RegExp(`<\\s*(${TAG_LABEL})(?=[\\s/>])`, "gi");
  for (const tag of text.matchAll(tags)) {
    if (includes(tag.index, markupEnd(text, tag.index, tag[1]))) return true;
  }
  return false;
}

function identities(pack) {
  return pack.references.flatMap((reference, index) => [
    ["reference_id", reference.reference_id],
    ["app_name", reference.app_name],
    ["source.uri", reference.source.uri],
    ["source.record_id", reference.source.record_id],
    ["source.product_record_id", reference.source.product_record_id],
    ["source.screen_record_id", reference.source.screen_record_id]
  ].filter(([, value]) => typeof value === "string" && value.trim().length >= 3)
    .map(([kind, value]) => {
      const token = normalized(value);
      const localWord = kind === "reference_id" && /^[a-z]+$/.test(token);
      return {
        kind, value, token, field: `references[${index}].${kind}`, localWord,
        attribution: localWord ? new RegExp(
          `\\b(?:reference|ref|source)[-_ ]id\\s+(?:is\\s+)?["']?${escaped(token)}(?![a-z0-9_-])|` +
          `\\b(?:reference|ref)\\s+(?:named\\s+)?["']?${escaped(token)}(?![a-z0-9_-])|` +
          `(?:참조|출처|레퍼런스)\\s*(?:id|식별자)?\\s*[:=#]\\s*["']?${escaped(token)}(?![a-z0-9_-])`, "i"
        ) : null
      };
    }));
}

function safeKey(key) {
  return DIAGNOSTIC_KEYS.has(key) ? key : "<key>";
}

function collision(identity, field) {
  const digest = crypto.createHash("sha256").update(identity.value).digest("hex");
  // No URLs, query strings, paths, source sentences or payload excerpts in
  // errors. A short word-like token is useful only in this parent diagnostic.
  const token = ["reference_id", "app_name"].includes(identity.kind) &&
    /^[\p{L}\p{N}_ -]{3,48}$/u.test(identity.value)
    ? identity.value : `<sha256:${digest.slice(0, 16)}>`;
  return { field: field.slice(0, 256), identity_field: identity.field,
    identity_kind: identity.kind, token };
}

export function findReferenceIdentityCollision(pack, content) {
  const forbidden = identities(pack);
  function inspect(text, field, provenance) {
    const lower = text.toLocaleLowerCase("en");
    for (const identity of forbidden) {
      if (!lower.includes(identity.token)) continue;
      const readable = () => text.replace(/\\(["'])/g, "$1");
      if (!identity.localWord || provenance || identity.attribution.test(readable()) ||
        metadataContains(text, identity.token) || metadataContains(readable(), identity.token)) {
        return collision(identity, field);
      }
    }
    return null;
  }
  function visit(value, field, provenance = false) {
    if (typeof value === "string") return inspect(value, field, provenance);
    if (value === null || typeof value === "number" || typeof value === "boolean") {
      // Preserve the old serialized check for external/technical identities
      // even when the candidate expresses a matching value as a JSON scalar.
      return inspect(String(value), field, provenance);
    }
    if (Array.isArray(value)) {
      for (const [index, item] of value.entries()) {
        const found = visit(item, `${field}[${index}]`, provenance);
        if (found) return found;
      }
    } else if (value && typeof value === "object") {
      for (const [key, item] of Object.entries(value)) {
        // Inspect before adding the key: even an alphanumeric field name can
        // itself be a protected record identity or an unrelated private token.
        const child = `${field}.${safeKey(key)}`;
        const found = inspect(key, `${field}.<key>[key]`, provenance) ||
          visit(item, child, provenance || PROVENANCE_KEY.test(key));
        if (found) return found;
      }
    }
    return null;
  }
  return visit(content, "$", false);
}

export function assertReferenceIdentitySafe(pack, content, label) {
  const found = findReferenceIdentityCollision(pack, content);
  if (found) {
    throw new RouterError(`${label} [field=${found.field}; identity=${found.identity_field}; ` +
      `token=${JSON.stringify(found.token)}]`, 4);
  }
}

// One canonical projection is used by fresh producer ingestion and design
// dispatch. Moving it here does not change packet fields, aliases or hashes.
export function referenceProjection(pack) {
  const reasoning = [...pack.verified_hierarchy_reasoning]
    .sort((left, right) => left.reasoning_id.localeCompare(right.reasoning_id));
  const reasoningAliases = new Map(reasoning.map((item, index) => [
    item.reasoning_id,
    `causal-${String(index + 1).padStart(3, "0")}`
  ]));
  const grammar = [...pack.verified_grammar]
    .sort((left, right) => left.grammar_id.localeCompare(right.grammar_id));
  const grammarAliases = new Map(grammar.map((item, index) => [
    item.grammar_id,
    `grammar-${String(index + 1).padStart(3, "0")}`
  ]));
  return {
    causal_reasoning: reasoning.map((item) => ({
      reasoning_id: reasoningAliases.get(item.reasoning_id),
      user_decision: item.user_decision,
      likely_constraint: item.likely_constraint,
      consequence_if_flattened: item.consequence_if_flattened,
      confidence: item.confidence
    })),
    transferable_grammar: grammar.map((item) => ({
      grammar_id: grammarAliases.get(item.grammar_id),
      dimension: item.dimension,
      principle: item.principle,
      application: item.application,
      application_conditions: structuredClone(item.application_conditions),
      tradeoff: item.tradeoff,
      harmful_when: structuredClone(item.harmful_when),
      requires_live_data: item.requires_live_data,
      ...(item.component_recipe ? {
        component_recipe: projectComponentRecipe(item.component_recipe)
      } : {}),
      avoid: item.avoid,
      reasoning_ids: item.reasoning_ids.map((id) => reasoningAliases.get(id))
    })),
    reasoning_aliases: reasoningAliases,
    grammar_aliases: grammarAliases
  };
}

export function assertReferenceProjectionSafe(pack, label =
  "reference intelligence cannot project source identities to a design participant") {
  const projection = referenceProjection(pack);
  assertReferenceIdentitySafe(pack, {
    causal_reasoning: projection.causal_reasoning,
    transferable_grammar: projection.transferable_grammar
  }, label);
}
