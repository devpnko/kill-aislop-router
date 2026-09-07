# Design journey: completion criteria and remaining work

KSR's routing/authority tests, executed browser evidence, independent aesthetic
review, and Owner satisfaction are separate outcomes. A passing scanner, a
`ran` adapter, a synthetic dogfood fixture, or a package version cannot stand in
for all four.

## Implemented in the design-state-proof patch

- Official static prototypes require reviewed state/locale scenarios before
  browser child spawn. The exact bytes read through a pinned descriptor are
  rendered for every case; the browser does not reopen mutable prototype bytes.
- Native actions and visible assertions run at every required viewport and
  configured color scheme. Hidden markers and no-op/intercepted controls cannot
  establish successful state coverage.
- Each case has digest-bound screenshots and traces. Ingest and resume validate
  the complete matrix against the executed host/scenario authority. Marker-only
  legacy reports are not upgraded in place.
- Runtime audit behavior, exact-three direction/color matrices, baseline
  immutability, provider independence, source-reference isolation, and Owner
  stops remain in force.

This patch does not implement the following capabilities. They remain explicit
work items, not implied by the browser fix.

## Next implementation slices

| Slice | Contract and acceptance criteria | Dependency / authority |
|---|---|---|
| Ready-to-use design host | One explicit KSR parent entrypoint exposes creator, critic, browser readiness and the exact next action. An approved creator produces scoped candidates; a different participant critiques them. Missing capability stays pending. Test installed-package execution, failed child recovery, permissions, and identity continuity. | KSR host implementation plus a supported provider. The existing read-only Codex review adapter must not be silently converted to a writer or granted network access. |
| Feedback and revision rounds | Bind feedback to immutable parent run/candidate/evidence digests. Record keep/change/combine instructions and allowed dimensions. Append a new round and new candidates; never replace old evidence or inherit an old approval. Retest changes and require fresh independent comparison and real Owner choice. | Resolve the committed post-V2 base first; do not mix this feature into the existing dirty V2 worktree or pretend the optional adaptive atlas is already implemented. |
| Meaningful diversity | Evaluate visible hierarchy, navigation, density, task composition, and action placement using rendered candidates. Reject color/font-only skins as new directions. Test intentionally near-identical candidates, genuinely distinct candidates, and preserved product identity. | Independent critic calibration with Owner-visible comparisons. Keep the default exact-three route; an atlas is separately optional. |
| Reference-to-rendering calibration | Trace a reference-derived principle to target-specific rendered hierarchy, component geometry, typography and color roles, with conditions and tradeoffs. Compare applied CSS/fonts and rendered evidence rather than relying solely on JSON claims. | Preserve rights, provenance, and creator/source-pixel separation. Do not infer permission to distribute or expose source captures. |
| Real product benchmark | Follow three representative service journeys from planning/baseline through candidates, Owner feedback, revision, and final comparison. Record identity preservation, task success, distinctiveness, preference, iterations and cost/time separately. | Real project access, accepted task scope, independent reviewers, and actual Owner choices. Synthetic test approvals do not satisfy this gate. |

Implementation belongs to KillSlopRouter maintainers. Product baselines,
source edits and preference/approval decisions belong to their respective
project Owners. Consumer projects and their approved baselines remain out of
scope; never change them to make router tests pass.

## Repeatable design-state UAT

1. Use a clean fixture/prototype copy, not a live product or approved baseline.
2. Keep the reviewed brief, required states/locales, native scenarios, and host
   permissions fixed. Confirm dry-run names missing bindings before any spawn.
3. Run a working prototype. Inspect each state/locale/viewport/scheme row and its
   screenshot/trace; confirm real click/keyboard actions and visible results.
4. Test separate defects: no-op save, hidden success/error, hidden secondary
   locale, mobile pointer interception, and state-specific clipping. Verify
   failed evidence blocks ingest and never becomes a passed Owner checkpoint.
5. Delete or alter one matrix row or evidence file in a disposable copy. Resume
   must reject missing/changed proof; it must not spawn a replacement child
   silently or reuse historical approval.
6. Restore unchanged bound inputs and explicitly retry an unaccepted failed
   attempt. For intentional prototype changes or legacy accepted marker-only
   evidence, start a new run instead. Existing completed results stay immutable.

These checks demonstrate execution integrity and UI mechanics. They do not
assert that a design is beautiful, diverse, commercially effective, or approved.
