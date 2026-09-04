import assert from "node:assert/strict";
import test from "node:test";
import {
  claimsSourceCompositionCopy,
  sourceCompositionSegments
} from "../src/source-composition.mjs";

const blocked = [
  "We are copying the source composition.",
  "Imitate the reference hierarchy and component order.",
  "Clone the referenced layout exactly.",
  "Borrow the original grid and sidebar structure.",
  "Use the source spatial arrangement as-is.",
  "참조 화면의 구성과 위계를 그대로 복사한다.",
  "레퍼런스 레이아웃을 모사한다.",
  "원본의 컴포넌트 순서와 구조를 그대로 재현한다.",
  "Do not copy the reference colors, but reproduce the source composition.",
  "Avoid cloning its palette; however, adopt the reference hierarchy.",
  "Do not copy reference colors and reproduce source composition.",
  "Do not copy the source hierarchy and then recreate the reference layout.",
  "Without copying the palette, reproduce the source component order.",
  "참조 구성을 복사하지 않고 원본 위계를 재현한다."
];

const allowed = [
  "Do not copy the reference composition.",
  "Never reproduce the source hierarchy or component order.",
  "Avoid adopting the referenced layout.",
  "The candidate must differ structurally from the source composition.",
  "Compare the candidate with the source composition for independence.",
  "참조 화면의 구성과 위계를 복사하지 않는다.",
  "레퍼런스 레이아웃 모사를 금지한다.",
  "Source evidence is available only to the independent critic."
  ,"We are not copying the source composition."
  ,"The source hierarchy must not be reproduced."
  ,"Copy the target structure so it differs from the source layout."
];

test("source-composition copying catches inflection, contrast reversal, and Korean claims", () => {
  for (const value of blocked) {
    assert.equal(claimsSourceCompositionCopy(value), true, value);
  }
});

test("source-composition copying permits scoped anti-copy and reviewer language", () => {
  for (const value of allowed) {
    assert.equal(claimsSourceCompositionCopy(value), false, value);
  }
});

test("contrast connectors form independent negation scopes", () => {
  assert.deepEqual(
    sourceCompositionSegments(
      "Do not copy the reference colors, but reproduce the source composition."),
    ["Do not copy the reference colors", "reproduce the source composition"]
  );
});
