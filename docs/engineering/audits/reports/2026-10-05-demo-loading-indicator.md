# Demo import activity indicator — final audit

Scope: `DemoLibraryModal.ts`, `bonusVaults.ts`, `rt-ui.css`, and the demo import tests. Read-only final review under the feature-audit playbook; no additional fixes proposed.

## Behavior and cleanup

- Three decorative, 6px activity dots appear beside the existing import status. The status row precedes the cards so it remains visible in the smaller Settings window.
- Import callbacks retain ownership of the stage text. The modal's existing busy flag owns visibility; completion closes the modal, and failure rebuilds it with the indicator hidden and the error preserved. Closing during work still permits the existing import to finish, with a Notice on failure. No timers, new persisted state, estimated percentages, or artificial completion delay were added.
- The existing busy-pulse keyframes are reused. Reduced-motion users receive stationary dots. The live region remains polite and atomic; decorative dots are hidden from assistive technology.
- A repeated native Obsidian timeout through the tracked redirect was observed during QA. Archive transfers now use the explicit direct Storage URL, while the browser ZIP action uses the explicit counted `downloadUrl`. No retry/fallback chain was introduced. Direct imports consequently bypass `/go` click counts; separate-vault ZIP clicks retain plugin attribution. Website routes were not changed.
- Size, SHA-256, archive roots, safe unpacking, selected-book rebasing, and existing-content preservation remain unchanged. The fields are a compile-time catalog contract, not persisted author settings, so no migration is needed.

## Findings and risks

No blocking findings in this scope. The indicator cannot prevent a genuine network failure; the importer's actionable timeout message remains available. This is indeterminate activity feedback, not transfer-progress measurement.

No architectural refactors or unrelated dead-code removal were needed. Naming uses the existing `ert-demo-library` namespace, with archive transfer and browser link roles documented at the type definition. No deferred cleanup or follow-up work is required for this change.

## Verification

- `npm run build-only` passed, including application/script type checks, code-quality checks, shipped assets, and duplicate CSS checks.
- Full Vitest run: 365 files passed, 3 skipped; 3,991 tests passed, 7 skipped. The published Sherlock archive also passed the opt-in four-book import test in the targeted run (20 tests passed).
- Native QA: a tracked Odyssey request timed out and the modal cleared its busy cue and restored its controls. After switching archive transfers to their direct URLs, Odyssey and Pride & Prejudice imported successfully and produced their completion notices. The QA vault contained a pre-existing sentinel note; imports were confined to Demo Projects.
- Visual QA used a temporary loading-state preview in the isolated QA window because successful direct transfers completed before a screenshot could capture the transient cue. Inspector values confirmed three dots, 6px width/height, the existing accent color, and an 8px row gap. The screenshot confirmed the status was visible above the cards.
- DevTools reduced-motion emulation returned computed `animation-name: none`; emulation was restored afterwards. The preview was closed, and Miki Projects was restored with A Study in Scarlet selected.

Feature behavior and build safety are preserved. Public plugin release remains a separate owner-requested operation.
