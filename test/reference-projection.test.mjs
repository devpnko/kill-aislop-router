import assert from "node:assert/strict";
import test from "node:test";
import { componentRecipe } from "./fixtures/component-recipe-fixture.mjs";
import { canonicalDigest } from "../src/integrity.mjs";
import {
  assertReferenceIdentitySafe, assertReferenceProjectionSafe,
  findReferenceIdentityCollision, referenceProjection
} from "../src/reference-projection.mjs";

function pack() {
  const recipe = componentRecipe();
  recipe.anatomy[0].treatment = "Add provenance, not an observed sports record feature.";
  recipe.preserve_character[0] = "Preserve contrast, not source colors or sports assets.";
  return {
    references: ["sports", "earnings", "opaque-ref-003"].map((id, index) => ({
      reference_id: id, app_name: `FixtureBrand${index}`,
      source: { uri: `https://references.invalid/${index}`, record_id: `record-${index}`,
        product_record_id: `product-${index}`, screen_record_id: `screen-${index}` }
    })),
    verified_hierarchy_reasoning: [{ reasoning_id: "source-reasoning", user_decision: "Compare records",
      likely_constraint: "Limited attention", consequence_if_flattened: "Lose provenance", confidence: "medium" }],
    verified_grammar: [{ grammar_id: "local-grammar", dimension: "data-comparison",
      principle: "Compare source-bound records", application: "Keep dates aligned",
      application_conditions: ["Records have timestamps"], tradeoff: "Dense comparison needs room",
      harmful_when: ["Values are not comparable"], requires_live_data: true,
      avoid: "Do not reuse sports scores or earnings periods.",
      reasoning_ids: ["source-reasoning"], component_recipe: recipe }]
  };
}

test("plain local join keys do not blacklist category/exclusion prose or nested component craft", () => {
  const input = pack();
  const digest = canonicalDigest(input);
  assert.doesNotThrow(() => assertReferenceProjectionSafe(input));
  const projection = referenceProjection(input);
  assert.equal(projection.transferable_grammar[0].avoid, "Do not reuse sports scores or earnings periods.");
  assert.equal(projection.transferable_grammar[0].component_recipe.anatomy[0].treatment,
    input.verified_grammar[0].component_recipe.anatomy[0].treatment);
  assert.equal(projection.transferable_grammar[0].grammar_id, "grammar-001");
  assert.deepEqual(projection.transferable_grammar[0].reasoning_ids, ["causal-001"]);
  assert.ok(projection.transferable_grammar[0].component_recipe.responsive_variants
    .every(item => !Object.hasOwn(item, "observed_ids")));
  assert.equal(canonicalDigest(input), digest, "frozen pack must not be rewritten");
});

for (const field of ["app_name", "source.uri", "source.record_id", "source.product_record_id", "source.screen_record_id"]) {
  test(`external ${field} stays blocked, including negative transfer instructions`, () => {
    const input = pack();
    const identity = field.split(".").reduce((value, key) => value[key], input.references[0]);
    const content = { transferable_grammar: [{ avoid: `Do not reuse ${identity.toUpperCase()}.` }] };
    const found = findReferenceIdentityCollision(input, content);
    assert.equal(found.field, "$.transferable_grammar[0].avoid");
    assert.equal(found.identity_kind, field);
    assert.throws(() => assertReferenceIdentitySafe(input, content, "blocked"), /field=.*avoid; identity=/);
  });
}

test("a word that is also a real product/record identity is not exempted", () => {
  for (const field of ["app_name", "record_id", "product_record_id", "screen_record_id"]) {
    const input = pack();
    if (field === "app_name") input.references[0][field] = "sports";
    else input.references[0].source[field] = "sports";
    assert.throws(() => assertReferenceProjectionSafe(input), /source identities/);
  }
});

for (const value of [
  "reference_id: sports", "ref=earnings", 'data-source-id="SPORTS"',
  "source reference id: earnings", "source_id is sports", '{"reference_id":"earnings"}',
  "not reference_id: sports", "opaque-ref-003", "reference named sports",
  'const metadata = "{\\"reference_id\\":\\"earnings\\"}";', "참조 ID: sports", "출처: earnings"
]) {
  test(`internal ID attribution remains blocked: ${value}`, () => {
    assert.throws(() => assertReferenceIdentitySafe(pack(), { text: value }, "blocked"), /identity=references/);
  });
}

test("structured source/reference provenance slots cannot echo plain local keys", () => {
  for (const field of ["reference_id", "reference_ids", "source", "ref", "source_record_id"]) {
    const found = findReferenceIdentityCollision(pack(), { [field]: ["sports"] });
    assert.equal(found.identity_kind, "reference_id");
  }
  assert.equal(findReferenceIdentityCollision(pack(), { topic: "sports", type: "earnings" }), null);
});

test("nested candidate HTML/CSS/JS/SVG/image attributes and contract values retain brand checks", () => {
  for (const text of [
    '<p>FixtureBrand0</p>', '<main data-provider="FixtureBrand0">',
    '<style>.FixtureBrand0{display:block}</style>', '<script>const provider="FixtureBrand0"</script>',
    '<svg aria-label="FixtureBrand0"></svg>', '<img alt="FixtureBrand0">',
    'data:font/woff2;base64,AAFixtureBrand0BB=='
  ]) {
    const content = { prototypes: [text], contract_claims: [{ label: "generic" }] };
    assert.equal(findReferenceIdentityCollision(pack(), content).field, "$.prototypes[0]");
  }
  assert.ok(findReferenceIdentityCollision(pack(), { contract_claims: [{ FixtureBrand0: "value" }] }));
  assert.equal(findReferenceIdentityCollision(pack(), {
    prototypes: ["<p>No sports scores or earnings forecasts</p>"],
    rationale: "Do not transfer sports assets", contract_claims: [{ state: "earnings unavailable" }]
  }), null);
});

test("parent diagnostic identifies a bounded field/token without payload, URL or path leakage", () => {
  const input = pack();
  input.references[0].source.uri = "https://private.invalid/?token=DO_NOT_LOG_SECRET";
  const payload = { nested: [{ avoid: `${input.references[0].source.uri} ${"PRIVATE_BODY".repeat(300)}` }] };
  assert.throws(() => assertReferenceIdentitySafe(input, payload, "projection blocked"), error => {
    assert.equal(error.exitCode, 4);
    assert.match(error.message, /field=\$\.nested\[0\]\.avoid; identity=references\[0\]\.source\.uri/);
    assert.doesNotMatch(error.message, /private\.invalid|DO_NOT_LOG_SECRET|PRIVATE_BODY/);
    assert.ok(error.message.length < 512);
    return true;
  });
  const found = findReferenceIdentityCollision(pack(), { "/Users/private/path": "FixtureBrand0" });
  assert.equal(found.field, "$.<key>");
});

test("projection preserves existing wire values and never adds its parent diagnostics", () => {
  const input = pack();
  const projection = referenceProjection(input);
  assert.deepEqual(Object.keys(projection), ["causal_reasoning", "transferable_grammar", "reasoning_aliases", "grammar_aliases"]);
  assert.doesNotMatch(JSON.stringify(projection), /identity_field|identity_kind|reference_id|FixtureBrand|references\.invalid/);
});

test("external record values remain protected in JSON scalars and diagnostics expose only their fingerprint", () => {
  for (const scalar of [123, true, null]) {
    const input = pack();
    input.references[0].source.record_id = String(scalar);
    const found = findReferenceIdentityCollision(input, { value: scalar });
    assert.equal(found.identity_kind, "source.record_id");
    assert.match(found.token, /^<sha256:[a-f0-9]{16}>$/);
  }
  const input = pack();
  input.references[0].source.record_id = "SensitiveRecordToken";
  assert.throws(() => assertReferenceIdentitySafe(input, { text: "SensitiveRecordToken" }, "blocked"), error => {
    assert.doesNotMatch(error.message, /SensitiveRecordToken/);
    assert.match(error.message, /identity=references\[0\].source.record_id/);
    return true;
  });
});

for (const [name, content] of [
  ["embedded JSON array", { prototypes: ['<script type="application/json">{"reference_ids":["sports"]}</script>'] }],
  ["embedded nested JSON", { prototypes: ['<script>{"source":{"id":"sports"}}</script>'] }],
  ["JavaScript template literal", { prototypes: ['<script>const reference_id = `sports`;</script>'] }],
  ["SVG metadata element", { prototypes: ['<svg><metadata><reference_id>sports</reference_id></metadata></svg>'] }],
  ["data attribute contract key", { contract_claims: [{ "data-source-id": "sports" }] }],
  ["plural provenance key", { references: ["sports"] }],
  ["camel-case provenance key", { sourceRecordId: "sports" }],
  ["nested provenance key", { source: { id: "sports" } }],
  ["quoted property access", { prototypes: ['metadata["reference_ids"] = ["sports"];'] }],
  ["JSX attribute expression", { prototypes: ['<Card data-source-id={"sports"} />'] }],
  ["parenthesized assignment", { prototypes: ['const reference_id = ("sports");'] }],
  ["comment-separated assignment", { prototypes: ['const reference_id /* reviewed */ = "sports";'] }],
  ["CSS attribute selector", { prototypes: ['[data-source-id="sports"] { color: red; }'] }],
  ["provenance tag attribute", { prototypes: ['<source id="sports" />'] }],
  ["unterminated provenance value", { prototypes: ['const reference_ids = [{id: "sports";'] }],
  ["unterminated provenance tag", { prototypes: ['<reference_id>sports'] }],
  ["concatenated assignment", { prototypes: ['const reference_id = "" + "sports";'] }],
  ["method continuation", { prototypes: ['const reference_ids = [].concat(["sports"]);'] }],
  ["dot property assignment", { prototypes: ['metadata.source.id = "sports";'] }],
  ["index property assignment", { prototypes: ['source["id"] = "sports";'] }],
  ["CSS substring operator", { prototypes: ['[data-source-id*="sports"] { color: red; }'] }],
  ["CSS word operator", { prototypes: ['[data-source-id~="sports"] { color: red; }'] }],
  ["missing metadata value", { prototypes: ['<script>{"reference_id": , "topic":"sports"}</script>'] }],
  ["newline expression continuation", { prototypes: ['const reference_id = "" +\n "sports";'] }],
  ["void source identity attribute", { prototypes: ['<source data-source-id="sports">'] }],
  ["explicit source closing tag", { prototypes: ['<source>sports</source>'] }],
  ["logical assignment", { prototypes: ['reference_id ||= "sports";'] }],
  ["nullish assignment", { prototypes: ['source.id ??= "sports";'] }],
  ["additive assignment", { prototypes: ['reference_id += "sports";'] }],
  ["newline call continuation", { prototypes: ['const reference_id = String\n("sports");'] }],
  ["conditional comparison RHS", { prototypes: ['const reference_id = count > 0 ? "sports" : "generic";'] }],
  ["less-than comparison RHS", { prototypes: ['const reference_id = count < 0 ? "generic" : "sports";'] }],
  ["newline prefix operator", { prototypes: ['const reference_id = new\n String("sports");'] }],
  ["raw script boundary", { prototypes: ['<script>const reference_id = count > 0 ? "sports" : "generic";</script>'] }],
  ["commented newline continuation", { prototypes: ['const reference_id = "" +// continue\n "sports";'] }],
  ["provenance collection call", { prototypes: ['source.reference_ids.push("sports");'] }],
  ["provenance comparison call", { prototypes: ['source.id.includes("sports");'] }],
  ["provenance chained call", { prototypes: ['source.ids().concat(["sports"]);'] }],
  ["compact JS comparison before assignment", { prototypes: ['const before = a<b && enabled; const reference_id = count > 0 ? "sports" : "generic";'] }],
  ["raw script compact comparison", { prototypes: ['<script>const before = a<b && enabled; const reference_id = count > 0 ? "sports" : "generic";</script>'] }],
  ["raw script spaced comparison", { prototypes: ['<script>const before = a < b && enabled; const reference_id = count > 0 ? "sports" : "generic";</script>'] }],
  ["quoted code attribute", { prototypes: ['<button onclick=\'const before = a<b && enabled; const reference_id = count > 0 ? "sports" : "generic";\'>Run</button>'] }]
]) {
  test(`explicit local identity is blocked in ${name}`, () => {
    const found = findReferenceIdentityCollision(pack(), content);
    assert.equal(found?.identity_kind, "reference_id", name);
    assert.throws(() => assertReferenceIdentitySafe(pack(), content, "blocked"), /identity=references/);
  });
}

test("provenance value boundaries do not swallow unrelated domain text", () => {
  for (const text of [
    'const source = "generic"; const topic = "sports";',
    'const source = {id: "generic"}; const topic = "sports";',
    '<source id="generic" /><p>No sports scores</p>',
    '<reference_id>generic</reference_id><p>sports</p>',
    '<script>{"source":{"id":"generic"},"topic":"sports"}</script>',
    '<picture><source media="(min-width: 600px)" srcset="generic.webp"><img src="generic.png" alt="Chart"></picture><p>No sports scores.</p>',
    '<source id><p>No sports scores.</p>',
    '<div data-source-id="generic" data-topic="sports"></div>',
    'const source = "generic"\nconst topic = "sports";',
    'const source = [].concat(["generic"]); const topic = "sports";',
    'metadata.source.id = "generic"; const topic = "sports";',
    '<div title="a>b" data-source-id="generic"><p>No sports scores</p></div>',
    '<script>const source = "generic";</script><p>No sports scores</p>',
    'source.id ??= "generic"; const topic = "sports";',
    'const source = count > 0 ? "generic" : "unknown"; const topic = "sports";',
    'const source = "generic"// end statement\nconst topic = "sports";',
    '<p>No sports scores or earnings periods</p>',
    '<div data-topic="sports">Do not transfer earnings periods</div>',
    'source.reference_ids.push("generic"); const topic = "sports";',
    'source.id.includes("generic"); const topic = "sports";',
    'source.ids().concat(["generic"]); const topic = "sports";',
    'const before = a<b && enabled; const reference_id = count > 0 ? "generic" : "unknown"; const topic = "sports";',
    '<script>const before = a<b && enabled; const reference_id = count > 0 ? "generic" : "unknown";</script><p>sports</p>',
    '<button onclick=\'const before = a<b && enabled; const reference_id = count > 0 ? "generic" : "unknown"\'>sports</button>',
    '<button onclick=\'reference_id = "generic"\' data-topic="sports">sports</button>'
  ]) assert.equal(findReferenceIdentityCollision(pack(), { prototypes: [text] }), null, text);
});

test("identity-bearing and unknown keys cannot leak through diagnostic field paths", () => {
  const input = pack();
  input.references[0].source.record_id = "SensitiveRecordToken";
  for (const content of [
    { contract_claims: [{ SensitiveRecordToken: "value" }] },
    { contract_claims: [{ PrivateSessionCanary: { SensitiveRecordToken: "value" } }] },
    { contract_claims: [{ PrivateSessionCanary: "SensitiveRecordToken" }] }
  ]) {
    assert.throws(() => assertReferenceIdentitySafe(input, content, "blocked"), error => {
      assert.doesNotMatch(error.message, /SensitiveRecordToken|PrivateSessionCanary/);
      assert.match(error.message, /field=\$\.contract_claims\[0\]\.\<key\>/);
      assert.match(error.message, /token="<sha256:/);
      return true;
    });
  }
});
