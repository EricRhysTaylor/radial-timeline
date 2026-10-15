# Verse source conditioning and importer audit

October 14, 2026. Scope: deterministic single-file HTML/text extraction, nested division identity, the Faerie Queene source preprocessor, and its path through the existing Markdown/import model. No provider requests or public release actions.

## Outcome and cleanup

The single-file adapter now retains repeated child numbers under their parent path: Book I / Canto I and Book II / Canto I are distinct. Contents deduplication remains scoped to a repeated full path. Gutenberg `div.verse` and older `span.i0/i2` lines retain line breaks, while their containing stanzas retain paragraph breaks. Existing prose extraction and splitting tests remain passing.

The maintained source preprocessor exposes Smith's two volumes as 75 canto/fragment sources and six separate proems, without `Class: Scene`, speculative metadata or synthetic saved results. It validates source scope, nine-line stanzas, ordinal sequence and source arguments before creating output; refuses existing output; and records hashes. The verified II.x numbering discrepancy is disclosed rather than silently repaired. The 1590 alternative ending of Book III is kept out of the continuing narrative. Original HTML retains the supporting documents and critical apparatus.

## Prioritized risks and findings

- **Acceptance limitation:** native Obsidian modal/reload testing is pending because computer control reported the Mac locked. Headless pipeline checks are separate evidence. Do not claim native import acceptance or publish the new collection on this basis.
- **Expected next stage:** scene metadata, summaries, analyses and a verse-aware release contract do not exist yet. The workspace is ready for a user-operated AI import, not a finished sample. No fake manifest or Inquiry session was added to bypass that state.
- **Source-format limit:** raw Smith HTML includes historical display headings, apparatus and textual variants. The explicit source conditioner is required for this declared edition. The generic HTML fix does not claim arbitrary scholarly-edition parsing.
- **Interpretation limit:** canto-level analysis needs a verse-aware reading convention. The selected local role and guides define it, but actual model compliance still requires review. Existing act assignment is positional, not a newly inferred architecture for the poem.

No additional release-blocking implementation finding was identified in this scoped review. Broader navigation/terminology ideas remain documented design directions.

## Architecture, persistence and naming

No architectural refactor or alternate AI ingestion engine was introduced. Source conditioning is deterministic preprocessing. Actual scene proposals still use the shared Markdown adapter, split-confirmation model, extraction functions and OnboardingService. No changes to AI routing, cost counting, saved-result persistence, UI chrome, defaults, schema migrations or provider access were made.

No dead runtime code was removed. No feature setting, shortcut or new manifest was added. Documentation now uses the current **Import manuscript**, **Structure only — no AI** and **AI assisted** names rather than the obsolete beta command. Plugin availability documentation reflects the three published archives and Faerie Queene's preparation state.

## Verification

- Clean pre-change baseline: 408 test files passed; 4,483 tests passed, 23 skipped.
- Five regression cases first reproduced nested-canto loss, abbreviated heading loss and verse-line flattening; all pass after the adapter fixes.
- Final full suite with the real conditioned source supplied: 409 test files passed; **4,489 tests passed, 23 skipped**.
- Opt-in real-source acceptance: 75 canto sources retain all bodies and source-reference metadata through the shipped adapter, split-confirmation model and deterministic proposal builder; six proems stay outside narrative folders. No unsupported dates or fabricated summaries are introduced.
- Python demo tooling suite: **20 tests passed**, including nine new source tests.
- `npm run build-only` passed, including TypeScript and script typechecks. Local vault deployment is file evidence; native reload remains pending.
- All **14 repository gates passed**. Installed Faerie Queene `main.js`, `styles.css` and `manifest.json` match the local release directory byte for byte. Existing report-only lint and unused-CSS notices remain outside this change. Native reload is still unverified.

## Deferred work

After the first user AI results: accept actual canto metadata and references; validate model handling of narrator/frame shifts and allegory; complete remaining bounded imports and analyses. Then add the verse-aware imported-scene/source release contract and exact-package acceptance.

Evaluate an explicit keep-source-units import choice, canto-aware review terminology, and stanza/line navigation for Inquiry only against the observed workflow. These are not shipped features. No broad UI or persistence framework is required for this source-preparation milestone.
