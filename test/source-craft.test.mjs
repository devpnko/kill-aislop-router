import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { canonicalDigest, sha256 } from "../src/integrity.mjs";
import {
  validateSourceCraftAuthority, validateSourceCraftReview, sourceCraftPacketContract
} from "../src/source-craft.mjs";
import { assertPublishedSchema } from "./fixtures/schema-validation.mjs";

// Entirely synthetic protocol evidence; these assertions license no real source.
function fixture() {
  const captures = [
    { digest: canonicalDigest("synthetic-source-a"), pixel_width: 1280, pixel_height: 720 },
    { digest: canonicalDigest("synthetic-source-b"), pixel_width: 200, pixel_height: 180 }
  ];
  const authority = {
    source_craft_authority_version: 1,
    purpose: "source-target-component-craft", status: "authorized",
    issuer_id: "synthetic-rights-issuer", reviewer_provider_id: "source-review-provider",
    reviewer_actor_id: "source-review-actor", project_id: "synthetic-project",
    screen_id: "answer-screen", comparison_id: "source-craft-comparison",
    candidate_id: "answer--refine", primary_reference_id: "synthetic-reference",
    pack_digest: canonicalDigest("synthetic-pack"), producer_state_digest: canonicalDigest("synthetic-producer"),
    task_frame_digest: canonicalDigest({ baseline_digest: canonicalDigest("synthetic-baseline"), task_frame: "Synthetic answering task." }),
    cohort_digest: canonicalDigest(["/synthetic-cohort/candidate-a/state.json"]),
    capture_digests: captures.map((item) => item.digest),
    rights_basis: {
      assertion: "PRIVATE-ASSERTION: synthetic fixture only; not a real source license.",
      evidence: { path: "/synthetic-private/rights-evidence.json", digest: canonicalDigest("synthetic-rights") }
    },
    creator_access: false, browser_access: false, redistribution: false, network_external: false,
    source_duplication: false, human_authorship: false, owner_approval_granted: false,
    comparison_slots: [
      { slot_id: "identity-desktop", relationship_id: "identity-value", capture_digest: captures[0].digest,
        viewport: "desktop", state: "default", locale: "en-US" },
      { slot_id: "identity-mobile-error", relationship_id: "identity-value", capture_digest: captures[1].digest,
        viewport: "mobile", state: "error", locale: "ko-KR" },
      { slot_id: "answer-desktop", relationship_id: "answer-action", capture_digest: captures[0].digest,
        viewport: "desktop", state: "default", locale: "en-US" }
    ],
    target_invention_relationship_ids: ["target-help"]
  };
  const context = {
    ...Object.fromEntries(["project_id", "screen_id", "comparison_id", "candidate_id", "primary_reference_id",
      "pack_digest", "producer_state_digest", "task_frame_digest", "cohort_digest", "reviewer_provider_id", "reviewer_actor_id"]
      .map((key) => [key, authority[key]])),
    participants: {
      creator_ids: ["creator-provider", "creator-actor"], browser_ids: ["browser-provider", "browser-actor"],
      critic_ids: ["target-critic-provider", "target-critic-actor"],
      source_producer_ids: ["source-producer-provider", "source-producer-actor"], other_excluded_ids: []
    },
    relationships: [
      { relationship_id: "identity-value", binding: { kind: "recipe" } },
      { relationship_id: "answer-action", binding: { kind: "recipe" } },
      { relationship_id: "target-help", binding: { kind: "target-invention" } }
    ],
    required_viewports: ["desktop", "tablet", "mobile"], required_states: ["default", "error"],
    required_locales: ["en-US", "ko-KR"], captures,
    // Raw bytes deliberately differ from semantic/canonical digest.
    authority_digest: sha256(JSON.stringify(authority, null, 2)),
    candidate_result_digest: canonicalDigest("synthetic-candidate-result"),
    browser_result_digest: canonicalDigest("synthetic-browser-result"),
    screenshots: [
      { digest: canonicalDigest("synthetic-target-desktop"), viewport: "desktop", state: "default", locale: "en-US" },
      { digest: canonicalDigest("synthetic-target-mobile-error"), viewport: "mobile", state: "error", locale: "ko-KR" }
    ]
  };
  const review = {
    source_craft_review_version: 1,
    authority_digest: context.authority_digest,
    candidate_result_digest: context.candidate_result_digest,
    browser_result_digest: context.browser_result_digest,
    reviewer_provider_id: authority.reviewer_provider_id, reviewer_actor_id: authority.reviewer_actor_id,
    adequacy: "adequate", rationale: "Synthetic scoped comparisons are assessable; unknown metadata remains explicit.",
    limitations: [],
    slots: authority.comparison_slots.map((slot) => ({
      slot_id: slot.slot_id, relationship_id: slot.relationship_id, source_capture_digest: slot.capture_digest,
      target_screenshot_digest: context.screenshots.find((shot) => shot.viewport === slot.viewport &&
        shot.state === slot.state && shot.locale === slot.locale).digest,
      viewport: slot.viewport, state: slot.state, locale: slot.locale, adequacy: "adequate",
      limitations: ["source-css-viewport-unknown", "source-device-pixel-ratio-unknown"],
      verdict: "retained", rationale: "PRIVATE-OBSERVATION: synthetic coupled hierarchy remains legible.",
      adaptation_justification: null
    })),
    target_invention_relationship_ids: [...authority.target_invention_relationship_ids],
    source_duplication: false, human_authorship: false, owner_approval_granted: false
  };
  return { authority, context, review };
}

test("explicit sparse comparison slots cover recipes while inventions remain separate", () => {
  const f = fixture();
  assert.equal(validateSourceCraftAuthority(f.authority, f.context), f.authority);
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), true);
  assertPublishedSchema("source-craft-authority", f.authority);
  assertPublishedSchema("source-craft-review", f.review);
  assert.equal(f.authority.comparison_slots.length, 3);
  // No invented full viewport/state/locale cross-product requirement.
  assert.equal(f.context.required_viewports.length * f.context.required_states.length * f.context.required_locales.length, 12);
});

test("validators are pure and packet projection omits issuer, private rights and free prose", () => {
  const f = fixture();
  const before = structuredClone(f);
  validateSourceCraftAuthority(f.authority, f.context);
  validateSourceCraftReview(f.review, f.authority, f.context);
  const packet = sourceCraftPacketContract(f.authority);
  assert.deepEqual(f, before);
  assert.equal(packet.authority_contract_digest, canonicalDigest(f.authority));
  assert.notEqual(packet.authority_contract_digest, f.context.authority_digest);
  assert.doesNotMatch(JSON.stringify(packet), /PRIVATE-ASSERTION|synthetic-private|synthetic-rights-issuer/);
  assert.equal(packet.private_reviewer_only, true);
  assert.equal(packet.owner_approval_granted, false);
  assert.equal(packet.creator_access, false);
  packet.obligations.comparison_slots.pop();
  assert.equal(f.authority.comparison_slots.length, 3);
});

test("published packet contract accepts only the private, explicitly scoped projection", () => {
  const { authority } = fixture();
  const schema = JSON.parse(fs.readFileSync(new URL("../schemas/source-craft-authority.schema.json", import.meta.url), "utf8"));
  const validator = new Ajv2020({ strict: true, validateFormats: false }).addSchema(schema);
  const check = validator.compile({ $ref: `${schema.$id}#/$defs/packet` });
  const packet = sourceCraftPacketContract(authority);
  assert.equal(check(packet), true, JSON.stringify(check.errors));
  for (const mutate of [
    (item) => { item.creator_access = true; },
    (item) => { item.private_reviewer_only = false; },
    (item) => { item.obligations.rights_basis = authority.rights_basis; },
    (item) => { item.obligations.issuer_id = authority.issuer_id; },
    (item) => { item.obligations.capture_digests = []; },
    (item) => { delete item.obligations.task_frame_digest; },
    (item) => { delete item.obligations.cohort_digest; },
    (item) => { item.owner_approval_granted = true; }
  ]) {
    const invalid = structuredClone(packet); mutate(invalid);
    assert.equal(check(invalid), false);
  }
});

for (const key of ["project_id", "screen_id", "comparison_id", "candidate_id", "primary_reference_id",
  "pack_digest", "producer_state_digest", "task_frame_digest", "cohort_digest"]) test(`authority rejects mismatched ${key}`, () => {
  const f = fixture();
  f.context[key] = key.endsWith("digest") ? canonicalDigest("different") : "different";
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /binding mismatch/);
});

for (const [label, mutate] of [
  ["baseline replacement", (context) => { context.task_frame_digest = canonicalDigest({
    baseline_digest: canonicalDigest("different-synthetic-baseline"), task_frame: "Synthetic answering task." }); }],
  ["task frame change", (context) => { context.task_frame_digest = canonicalDigest({
    baseline_digest: canonicalDigest("synthetic-baseline"), task_frame: "Different synthetic purchasing task." }); }],
  ["cohort member replacement", (context) => { context.cohort_digest = canonicalDigest(["/synthetic-cohort/candidate-b/state.json"]); }],
  ["cohort expansion", (context) => { context.cohort_digest = canonicalDigest([
    "/synthetic-cohort/candidate-a/state.json", "/synthetic-cohort/candidate-b/state.json"]); }]
]) test(`unchanged grant rejects ${label} even when all named IDs match`, () => {
  const f = fixture();
  const originalAuthority = structuredClone(f.authority);
  mutate(f.context);
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /(?:task_frame|cohort)_digest binding mismatch/);
  assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), /(?:task_frame|cohort)_digest binding mismatch/);
  assert.deepEqual(f.authority, originalAuthority);
});

for (const key of ["task_frame_digest", "cohort_digest"]) test(`authority and packet schema require ${key}`, () => {
  const f = fixture();
  const packet = sourceCraftPacketContract(f.authority);
  assert.equal(packet.obligations[key], f.authority[key]);
  delete f.authority[key];
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /missing required fields/);
  assert.throws(() => assertPublishedSchema("source-craft-authority", f.authority));
});

for (const field of ["creator_access", "browser_access", "redistribution", "network_external",
  "source_duplication", "human_authorship", "owner_approval_granted"]) test(`authority never grants ${field}`, () => {
  const f = fixture(); f.authority[field] = true;
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /cannot grant/);
  assert.throws(() => assertPublishedSchema("source-craft-authority", f.authority));
});

for (const [name, mutate, pattern] of [
  ["missing authority", (f) => { f.authority = undefined; }, /authority must be an object/],
  ["implicit consent", (f) => { f.authority.status = "pending"; }, /explicitly authorize/],
  ["different purpose", (f) => { f.authority.purpose = "copy-source"; }, /explicitly authorize/],
  ["extra clone permission", (f) => { f.authority.clone_rights = true; }, /unsupported fields/],
  ["missing negative permission", (f) => { delete f.authority.creator_access; }, /missing required/],
  ["empty rights assertion", (f) => { f.authority.rights_basis.assertion = " "; }, /assertion is required/],
  ["missing rights evidence", (f) => { delete f.authority.rights_basis.evidence; }, /missing required/],
  ["rights hash substitution", (f) => { f.authority.rights_basis.evidence.digest = "sha256:not-a-digest"; }, /digest is invalid/],
  ["duplicate capture", (f) => { f.authority.capture_digests.push(f.authority.capture_digests[0]); }, /duplicates/],
  ["unnecessary source access", (f) => { f.authority.capture_digests.push(canonicalDigest("unused")); }, /exact bound set/],
  ["unbound capture", (f) => { f.context.captures.shift(); }, /not bound/],
  ["invented PNG dimensions", (f) => { f.context.captures[0].pixel_width = "1280"; }, /actual intrinsic/],
  ["invalid source DPR", (f) => { f.context.captures[0].device_pixel_ratio = 0; }, /pixel ratio is invalid/],
  ["invalid source CSS viewport", (f) => { f.context.captures[0].css_viewport = { width: 0, height: 100 }; }, /CSS viewport is invalid/],
  ["missing source relationship", (f) => { f.authority.comparison_slots.pop(); }, /recipe relationships/],
  ["source claiming invention", (f) => { f.authority.comparison_slots[2].relationship_id = "target-help"; }, /recipe relationships/],
  ["missing explicit invention", (f) => { f.authority.target_invention_relationship_ids = []; }, /invention relationships/],
  ["recipe labeled invention", (f) => { f.authority.target_invention_relationship_ids.push("identity-value"); }, /invention relationships/],
  ["duplicated slot IDs", (f) => { f.authority.comparison_slots[2].slot_id = f.authority.comparison_slots[0].slot_id; }, /duplicates/],
  ["renamed duplicate observation", (f) => { f.authority.comparison_slots.push({ ...f.authority.comparison_slots[0], slot_id: "duplicate" }); }, /repeat the same/],
  ["unplanned viewport", (f) => { f.authority.comparison_slots[0].viewport = "watch"; }, /viewport is outside/],
  ["unplanned state", (f) => { f.authority.comparison_slots[0].state = "unexecuted"; }, /state is outside/],
  ["unplanned locale", (f) => { f.authority.comparison_slots[0].locale = "fr-FR"; }, /locale is outside/]
]) test(`authority rejects ${name}`, () => {
  const f = fixture(); mutate(f);
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), pattern);
});

for (const role of ["creator_ids", "browser_ids", "critic_ids", "source_producer_ids"]) {
  for (const identity of ["issuer_id", "reviewer_provider_id", "reviewer_actor_id"]) {
    test(`canonical ${identity} cannot alias ${role}`, () => {
      const f = fixture();
      // Full-width Unicode, surrounding spaces and case changes cannot launder identity.
      f.authority[identity] = `  ${f.context.participants[role][0].toUpperCase()
        .replace(/[A-Z]/g, (character) => String.fromCharCode(character.charCodeAt(0) + 0xfee0))}  `;
      if (identity !== "issuer_id") f.context[identity] = f.authority[identity];
      assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /must be independent/);
    });
  }
}

test("issuer cannot be the reviewer, parent or any cohort source reviewer", () => {
  const f = fixture();
  f.authority.issuer_id = ` ${f.authority.reviewer_actor_id.toUpperCase()} `;
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /issuer cannot be the source reviewer/);
  f.authority.issuer_id = "KillSlopRouter";
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /impersonate the parent/);
  f.authority.issuer_id = "peer-source-actor";
  f.context.participants.issuer_excluded_ids = ["PEER-SOURCE-ACTOR", f.authority.reviewer_actor_id];
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /another candidate/);
  f.authority.issuer_id = "synthetic-rights-issuer";
  assert.equal(validateSourceCraftAuthority(f.authority, f.context), f.authority);
});

test("incomplete trusted role inventory fails closed", () => {
  const f = fixture(); f.context.participants.critic_ids = [];
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /critic_ids is incomplete/);
});

test("missing actual reviewer identity cannot be supplied by the authority itself", () => {
  const f = fixture(); delete f.context.reviewer_actor_id;
  assert.throws(() => validateSourceCraftAuthority(f.authority, f.context), /trusted reviewer_actor_id is required/);
});

for (const key of ["authority_digest", "candidate_result_digest", "browser_result_digest", "reviewer_provider_id", "reviewer_actor_id"]) {
  test(`review rejects substituted ${key}`, () => {
    const f = fixture(); f.review[key] = key.endsWith("digest") ? canonicalDigest("substituted") : "other-reviewer";
    assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), /binding mismatch/);
  });
}

for (const [name, mutate, pattern] of [
  ["no source review", (f) => { f.review = undefined; }, /review must be an object/],
  ["beauty score", (f) => { f.review.beauty_score = 99; }, /unsupported fields/],
  ["raw authority claim instead of file binding", (f) => { f.review.authority_digest = canonicalDigest(f.authority); }, /authority_digest binding/],
  ["missing slot", (f) => { f.review.slots.pop(); }, /exact bound set/],
  ["duplicate slot", (f) => { f.review.slots[2] = structuredClone(f.review.slots[0]); }, /duplicates/],
  ["other source image", (f) => { f.review.slots[0].source_capture_digest = f.authority.capture_digests[1]; }, /source capture digest binding/],
  ["other target image", (f) => { f.review.slots[0].target_screenshot_digest = canonicalDigest("other-shot"); }, /actual executed/],
  ["unexecuted locale", (f) => { f.context.screenshots[0].locale = "ko-KR"; }, /actual executed/],
  ["missing executed locale", (f) => { delete f.context.screenshots[0].locale; }, /executed screenshot locale/],
  ["slot locale switch", (f) => { f.review.slots[0].locale = "ko-KR"; }, /locale binding/],
  ["slot viewport switch", (f) => { f.review.slots[0].viewport = "mobile"; }, /viewport binding/],
  ["slot state switch", (f) => { f.review.slots[0].state = "error"; }, /state binding/],
  ["different relationship", (f) => { f.review.slots[0].relationship_id = "answer-action"; }, /relationship_id binding/],
  ["missing invention coverage", (f) => { f.review.target_invention_relationship_ids = []; }, /exact bound set/],
  ["empty rationale", (f) => { f.review.slots[0].rationale = " "; }, /rationale is required/],
  ["unstated limitations", (f) => { delete f.review.slots[0].limitations; }, /missing required/],
  ["inferred CSS viewport", (f) => { f.review.slots[0].limitations = ["source-device-pixel-ratio-unknown"]; }, /CSS viewport is unknown/],
  ["inferred DPR", (f) => { f.review.slots[0].limitations = ["source-css-viewport-unknown"]; }, /pixel ratio is unknown/],
  ["unjustified adaptation", (f) => { f.review.slots[0].verdict = "adapted"; }, /adaptation justification/],
  ["hidden adaptation", (f) => { f.review.slots[0].adaptation_justification = "Change the skin"; }, /non-adapted/],
  ["insufficient claimed retained", (f) => { f.review.slots[0].adequacy = "insufficient"; }, /must remain unassessed/],
  ["adequate claimed unassessed", (f) => { f.review.slots[0].verdict = "unassessed"; }, /must remain unassessed/],
  ["overall concealing insufficiency", (f) => { Object.assign(f.review.slots[0], { adequacy: "insufficient", verdict: "unassessed" }); }, /cannot conceal/]
]) test(`review rejects ${name}`, () => {
  const f = fixture(); mutate(f);
  assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), pattern);
});

for (const key of ["source_duplication", "human_authorship", "owner_approval_granted"]) test(`review cannot claim ${key}`, () => {
  const f = fixture(); f.review[key] = true;
  assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), /cannot grant/);
  assert.throws(() => assertPublishedSchema("source-craft-review", f.review));
});

test("justified hue/structural adaptation can be supported without mandatory skin preservation", () => {
  const f = fixture();
  f.review.slots[0].verdict = "adapted";
  f.review.slots[0].adaptation_justification = "Synthetic target brand changes hue; hierarchy, accent area and edge treatment remain coherent.";
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), true);
  assertPublishedSchema("source-craft-review", f.review);
});

test("observed craft loss remains false despite complete successful browser evidence", () => {
  const f = fixture();
  f.review.slots[0].verdict = "lost";
  f.review.slots[0].rationale = "Synthetic accent expanded into a slab and removed local edge hierarchy.";
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), false);
  assertPublishedSchema("source-craft-review", f.review);
});

test("insufficient evidence remains unassessed; neither PNG size nor browser PASS proves adequacy", () => {
  const f = fixture();
  f.context.captures[0].pixel_width = 1;
  f.context.captures[0].pixel_height = 1;
  f.review.adequacy = "insufficient";
  f.review.limitations = ["Synthetic crop cannot establish requested craft relationship."];
  for (const slot of f.review.slots.filter((item) => item.source_capture_digest === f.context.captures[0].digest)) {
    slot.adequacy = "insufficient";
    slot.verdict = "unassessed";
    slot.limitations.push("Synthetic pixels do not show the relationship.");
  }
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), false);
  assertPublishedSchema("source-craft-review", f.review);
});

test("overall insufficiency requires explicit limitations even with all slots assessable", () => {
  const f = fixture(); f.review.adequacy = "insufficient";
  assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), /review limitations is incomplete/);
  assert.throws(() => assertPublishedSchema("source-craft-review", f.review));
  f.review.limitations = ["Synthetic evidence cannot establish complete aggregate comparability."];
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), false);
  assertPublishedSchema("source-craft-review", f.review);
});

test("published review schema rejects overall adequacy concealing an insufficient slot", () => {
  const f = fixture();
  Object.assign(f.review.slots[0], { adequacy: "insufficient", verdict: "unassessed" });
  assert.throws(() => assertPublishedSchema("source-craft-review", f.review));
});

test("verified CSS/DPR metadata may remove unknown limits but is never calculated from PNG dimensions", () => {
  const f = fixture();
  for (const capture of f.context.captures) {
    capture.css_viewport = { width: 480, height: 600 };
    capture.device_pixel_ratio = 2;
  }
  // Full-page images/crops need not equal viewport times DPR.
  f.review.slots.forEach((slot) => { slot.limitations = []; });
  assert.equal(validateSourceCraftReview(f.review, f.authority, f.context), true);
  delete f.context.captures[0].css_viewport;
  assert.throws(() => validateSourceCraftReview(f.review, f.authority, f.context), /CSS viewport is unknown/);
});
