# Codebase Health Report — 2026-10-17

**Cadence:** Weekly / release stabilization continuation
**Audited by:** Codex
**Branch / commit:** `main` @ `98c534f9`
**Verification:** 14 standard gates pass; separate release-i18n check passes
**Tests:** 416 passed files / 4,676 tests; 6 files / 24 tests intentionally skipped
**Previous report:** `2026-09-04-codebase-health.md`

## Executive summary

No new runtime defect was confirmed in the Radial Timeline subset inspected in
this continuation. Standard gates and full locale readiness are green. Existing
large render functions and scanner CSS/settings findings remain targeted follow-up
work, not justification for a general refactor before the maintenance release.

Whole-source size/function/export inventories were refreshed; deeper inspection
covered recent drag geometry, scene removal, Timetable classification and the
frontmatter writer/change-log boundary. This is not manual acceptance of every
function or every visual surface. The separate Editorialist report records one
confirmed decision-recovery bug fixed during the same cross-project pass.

## Top metrics

| Metric | This cycle | Prior report |
| --- | ---: | ---: |
| Non-test TypeScript files | 684 | 580 |
| Largest TS file | InquiryView: 11,153 lines | 12,188 |
| `src/main.ts` | 1,585 lines | Not reported |
| Files over 600 lines, including catalogs | 81 | 89 |
| Functions at least 80 lines, AST | 376 | 188 with an older heuristic |
| Built CSS lines | 36,686 | 36,688 total |
| Built JavaScript bytes | 12,075,400 | About 5.9 MB |
| Built CSS bytes | 1,351,113 | Not reported |
| Zero-use export-name candidates | 2 | 136 before prior remediation |
| Producer-less CSS candidates | 243; ratchet passes | 473 before prior remediation |
| TODO / FIXME comments | 0 | Three v7 TODOs |
| SAFE comments | 667 | Not comparable |

Counts are newline-split spans and include nested callbacks. Catalogs are data,
not algorithmic complexity. The function-count method changed, so the numerical
increase does not establish a doubling of complexity. Size deltas since September
are not week-over-week measurements. Exports/CSS are heuristic candidates rather
than automatic deletion lists.

### Largest behavioral TypeScript files (excluding locale data)

| Lines | File |
| ---: | --- |
| 11,153 | `src/inquiry/InquiryView.ts` |
| 4,162 | `src/modals/ManuscriptOptionsModal.ts` |
| 3,951 | `src/settings/sections/BeatPropertiesSection.ts` |
| 3,822 | `src/view/TimeLineView.ts` |
| 3,320 | `src/inquiry/runner/InquiryRunnerService.ts` |
| 3,167 | `src/settings/sections/AiSection.ts` |
| 2,943 | `src/settings/sections/PublishSection.ts` |
| 2,676 | `src/SynopsisManager.ts` |
| 2,468 | `src/modals/DesignedStyleWizardModal.ts` |
| 2,056 | `src/settings/sections/AuthorProgressSection.ts` |

Locale files occupy nine of the raw top-ten source positions; they are excluded
from the behavioral table deliberately, not from source coverage.

## Findings

### CH-2026-10-17-#1 — Long settings render functions remain a bounded risk

- **Status:** Confirmed structure; no new performance defect established.
- **Category:** no action.
- **Severity:** YELLOW monitoring only.
- **Confidence:** High for spans; latency impact unmeasured.
- **Risk:** Broad edits could mix persistence, controls and rendering concerns.
- **Effort:** No extraction in this pass; scope future work to a reproduced defect.
- **Evidence:** `src/settings/sections/BeatPropertiesSection.ts:65-3950`,
  `src/settings/sections/AiSection.ts:96-3166`,
  `src/settings/sections/PublishSection.ts:220-2942`.
- **Suggested next action:** Continue narrow visual/interaction checks and profile
  an observed slow flow before choosing an optimization. Do not split files solely
  to reduce their line count.

### CH-2026-10-17-#2 — Two zero-use exports are not release blockers

- **Status:** Confirmed name-reference absence in source/tests/scripts/docs.
- **Category:** no action.
- **Severity:** GREEN.
- **Confidence:** High for repository references; bundler impact not attributed.
- **Risk:** The text-token wrapper could mislead future callers into using a
  different estimate than the shipped execution estimator. The other file is
  explicitly a UI reference example.
- **Effort:** No runtime change now; minutes if the wrapper is removed during
  related token work.
- **Evidence:** `src/ai/tokens/inputTokenEstimate.ts:45-47` and
  `src/ui/reference/ProPill.reference.ts:19`.
- **Suggested next action:** Keep reference material intentional; do not treat
  it as a shipped performance bug. Remove the unused token wrapper only with
  related token-estimator work, preserving the canonical estimator.

## Historical context

| Theme | Classification |
| --- | --- |
| InquiryView size | Stable or improving since September |
| Settings render functions | Chronic hotspot; no new refactor mandate |
| CSS producer-less candidates | Stable ratchet; improved from old pre-remediation report |
| Bundle size / scanner CSS | Intentional packaging and deferred compatibility work |
| Dead-export inventory | Improved after prior remediation; two small remnants |

## Do Nothing / Monitor

- Preserve all languages and embedded export assets; do not trade functionality
  for a smaller scanner score. Current nine catalogs pass 6,425/6,425 keys each.
- Preserve Gossamer's intentional receding labels; traces remain the acceptance
  priority. This pass makes no visual behavior change.
- The duration-format helper's composite output merits investigation only if an
  active caller starts supplying duration updates: current `proposedDuration`
  has no assignment site. It is not presented as a reproduced user-facing bug.
- Existing best-effort date-history logging is documented behavior, separate from
  authoritative scene writes. No new loss claim without a reproducible case.
- Conditional live-provider/Pandoc/demo tests remain opt-in. Their skipped count
  does not imply those runtime paths were validated by the default test suite.

## Product doctrine check

- Author trust: no new confirmed violation in inspected paths.
- Non-destructive workflows: scene removal retains the note and identity; no
  changes made to that behavior in this pass.
- Core/Pro gating and terminology: no gating/copy edits.
- Obsidian-native behavior: standard lint/compliance gates pass at their baselines.
- Manuscript/export safety: relevant unit gates pass; this does not substitute
  for rendered output inspection or a full export round trip.
- AI analysis/prose boundary: no change; no live provider request made.

## Verification and remaining scope

Fresh standard gates: production build, typechecks, quality, scanner readiness,
Obsidian lint, CSS drift/unused ratchet, compliance, spec coverage and tests all
pass. The separately run release-i18n gate verifies source and bundle sentinels.
The focused Paths/Timetable/frontmatter suite passes 73 tests. Local evidence is
in Agent Runs / `2026-10-17 codebase audit continuation`; normal gate logs are
under `.gate-logs/2026-10-18T01-17-42-259Z` (UTC naming, local audit date Oct 17).

The public scanner's CSS/settings concerns remain as documented in
`2026-10-17-obsidian-scanner-cleanup.md`; this continuation does not request a
Community preview or establish public reclassification. No public release or
Radial Timeline runtime change is performed here.

## Escalations and next cycle

- Architecture Drift: monitor existing settings functions; no new structural fix.
- Obsidian Ecosystem: retain scanner CSS/settings follow-up and verify affected
  UI surfaces before changing their layout or affordances.
- Next focused pass: native scanner CSS controls, then output/export round trips;
  verify at narrow/normal widths and both themes where relevant.
- Recheck after meaningful changes or at the next weekly cycle, October 24.

## Focused continuation — actual manuscript outputs

Native Manuscript export in Obsidian 1.14.4 generated Readers Word, Basic PDF
and clean Markdown from a synthetic three-scene book while imported review
blocks were still present. The configured reverse-narrative order was retained.
All expected prose, Unicode and long fenced/indented literals survived; review
blocks, stripped queries, cut archives, custom scene YAML and the other book were
excluded. The Markdown Open file action and reading view passed. All two Word
and five PDF rendered pages were visually inspected; literals fit the margins.

A separate Editor round Word output after cleanup retained the three scene IDs
and exported one author query as one correctly anchored comment, absent from
body text. Both rendered pages were inspected. The presets updated Words in the
three source scenes; comparisons prove all other original fields, prose, queries
and feedback survived export. This is not a byte-unchanged-source claim.

Local evidence: Command Center/Agent Runs/2026-10-17 mixed cleanup cut export
acceptance, including artifacts, PNGs and machine-readable content comparisons.
The accompanying Editorialist report records a fixed positional-ID decision leak
and an open recovered-round total-count issue. No Radial Timeline runtime code
changed. Remaining export coverage includes other layouts, split/outline outputs,
mobile and Word import round trip; no public release is certified by this pass.

Editor Word opened natively as a two-page document, but comment-balloon navigation
remains unverified because native automation lost the Word window. The comment
content and matching start/end/reference IDs passed structural inspection; the
rendered document pages passed visual review. No Word import round trip is claimed.
