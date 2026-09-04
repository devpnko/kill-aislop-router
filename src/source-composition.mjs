const HARD_BOUNDARY =
  /(?:[\n.!?;]+|\s*[,:]\s*(?:but|however|yet|instead|whereas|while)\b\s*|\s+\b(?:but|however|yet|instead|whereas)\b\s+|\s*(?:하지만|그러나|그렇지만|반면|대신)\s*)/giu;

const ACTION_START_SOURCE =
  "(?:cop(?:y|ies|ied|ying)|clon(?:e|es|ed|ing)|mirror(?:s|ed|ing)?|" +
  "reproduc(?:e|es|ed|ing)|replicat(?:e|es|ed|ing)|imitat(?:e|es|ed|ing)|" +
  "mimic(?:s|ked|king)?|match(?:es|ed|ing)?|adopt(?:s|ed|ing)?|" +
  "borrow(?:s|ed|ing)?|reus(?:e|es|ed|ing)|recreat(?:e|es|ed|ing)|" +
  "emulat(?:e|es|ed|ing)|follow(?:s|ed|ing)?|use(?:s|d|ing)?|" +
  "lift(?:s|ed|ing)?|trac(?:e|es|ed|ing)|transplant(?:s|ed|ing)?)";

const TRANSFER_ACTION = new RegExp(
  `\\b${ACTION_START_SOURCE}\\b|(?:그대로\\s*)?(?:복사|복제|모사|재현|베끼|` +
  "따라\\s*하|차용|채택)(?:한다|하다|해|했다|하는|한다는|할)?",
  "giu"
);

const SOURCE_TERM =
  /\b(?:source|reference|referenced|inspiration|original)\b|(?:참조|레퍼런스|원본|소스)(?:\s*화면)?/giu;

const STRUCTURE_TERM =
  /\b(?:composition|layout|hierarch(?:y|ies|ical)|structure|grid|component\s+order|spatial\s+(?:order|arrangement)|navigation|sidebar|tab\s+order)\b|(?:구성|레이아웃|위계|구조|그리드|컴포넌트\s*순서|공간\s*배치|내비게이션|사이드바|탭\s*순서)/giu;

const NEGATION_BEFORE =
  /(?:\b(?:do\s+not|does\s+not|did\s+not|don['’]t|doesn['’]t|didn['’]t|not|never|avoid|without|must\s+not|cannot|can['’]t|reject(?:s|ed|ing)?|prevent(?:s|ed|ing)?|forbid(?:s|ding)?)\b|(?:금지|피해|피하|배제|방지|하지\s*말))[^,;.!?]{0,42}$/iu;

const NEGATION_AFTER =
  /^(?:[^,;.!?]{0,30})(?:\b(?:is|are|be)\s+(?:not\s+allowed|forbidden|prohibited|rejected)\b|(?:하지\s*않|하지\s*말|하지\s*못|금지|피해야|배제))/iu;

const NEGATION_REVERSAL = /\bnot\s+(?:only|merely|just)\s*$/iu;
const TARGET_TERM = /\b(?:target|candidate|our|new)\b|(?:대상|후보|우리|새로운)/iu;
const DIFFERENCE_TERM =
  /\b(?:differ(?:s|ed|ing)?|different|distinct|unlike|depart(?:s|ed|ing)?|away)\b|(?:다르|구별|차별|벗어나)/iu;

function addCoordinationBoundaries(value) {
  const actionLookahead = new RegExp(
    `\\s+\\b(?:and(?:\\s+then)?|then)\\b\\s+(?=${ACTION_START_SOURCE}\\b)`,
    "giu"
  );
  const koreanLookahead =
    /(?:않고|말고|그리고)\s*(?=(?:그대로\s*)?(?:복사|복제|모사|재현|베끼|따라\s*하|차용|채택))/gu;
  const withoutComma = new RegExp(
    `(\\bwithout\\b[^,\\n]{0,120}),\\s*(?=${ACTION_START_SOURCE}\\b)`,
    "giu"
  );
  return String(value)
    .replace(withoutComma, "$1\u241e")
    .replace(actionLookahead, "\u241e")
    .replace(koreanLookahead, "\u241e");
}

function candidateSegments(value) {
  return addCoordinationBoundaries(value)
    .split(HARD_BOUNDARY)
    .flatMap((segment) => segment.split("\u241e"))
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function matches(pattern, value) {
  pattern.lastIndex = 0;
  return [...value.matchAll(pattern)];
}

function isNegated(segment, action) {
  const before = segment.slice(Math.max(0, action.index - 80), action.index);
  const after = segment.slice(action.index + action[0].length,
    action.index + action[0].length + 48);
  const negatedBefore = NEGATION_BEFORE.test(before) && !NEGATION_REVERSAL.test(before);
  return negatedBefore || NEGATION_AFTER.test(after);
}

function isTargetDifferentiation(segment, actionIndex, sourceIndex) {
  if (sourceIndex <= actionIndex) return false;
  const between = segment.slice(actionIndex, sourceIndex);
  return TARGET_TERM.test(between) && DIFFERENCE_TERM.test(between) &&
    /\b(?:from|than)\b|(?:원본|참조|레퍼런스)(?:과|와|보다)/iu.test(
      segment.slice(Math.max(actionIndex, sourceIndex - 32), sourceIndex + 20)
    );
}

function actionTargetsSourceStructure(segment, action) {
  const sources = matches(SOURCE_TERM, segment);
  const structures = matches(STRUCTURE_TERM, segment);
  for (const source of sources) {
    for (const structure of structures) {
      const sourceEnd = source.index + source[0].length;
      const structureEnd = structure.index + structure[0].length;
      const sourceStructureDistance = Math.min(
        Math.abs(source.index - structureEnd),
        Math.abs(structure.index - sourceEnd)
      );
      const pairStart = Math.min(source.index, structure.index);
      const pairEnd = Math.max(sourceEnd, structureEnd);
      const actionDistance = action.index < pairStart
        ? pairStart - (action.index + action[0].length)
        : action.index - pairEnd;
      if (sourceStructureDistance <= 72 && actionDistance <= 96 &&
        !isTargetDifferentiation(segment, action.index, source.index)) return true;
    }
  }
  return false;
}

/**
 * Admission-time lexical guard for affirmative instructions or claims to
 * transfer a source's structural composition. It binds negation to each
 * transfer action instead of allowing a negated first clause to excuse a
 * later affirmative action. Digest-bound reviewer comparison remains the
 * authoritative source-composition gate.
 */
export function claimsSourceCompositionCopy(value) {
  return candidateSegments(value).some((segment) =>
    matches(TRANSFER_ACTION, segment).some((action) =>
      !isNegated(segment, action) && actionTargetsSourceStructure(segment, action)));
}

export function sourceCompositionSegments(value) {
  return candidateSegments(value);
}
