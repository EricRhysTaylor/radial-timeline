# Manuscript export controls clipped after Readers → PDF

## Result

Fixed the desktop PDF export layout so scrolling the modal reaches Destination, export checks and Generate PDF. The proof remains visible beside the settings on wide windows and its PDF page retains its own scrolling. Narrow windows retain the existing stacked layout with a non-sticky proof.

## Reproduction and cause

Reproduced in a separate Obsidian 1.14.4 instance using a synthetic two-scene RT book, starting with Markdown, selecting Readers, then PDF and generating a real proof. The outer manuscript modal and the height-constrained settings column were both scroll containers. The workspace's scrollable overflow extended into the outer container even though the settings column clipped its contents. Scrolling the outer modal to its end moved the workspace offscreen while the destination and final actions remained outside the visible bounds.

Before the fix, the settings column was approximately 804 CSS pixels high with 3,467 pixels of scrollable content. At the outer modal's maximum scroll, the action row began around y=1,348 while the modal ended around y=938. The controls existed; the scroll arrangement made them unreachable through that scrolling path. This is independent of preset choice and also occurs before generating the proof.

## Change

Removed the settings column's height cap and nested scroll container. The existing modal now owns scrolling of the complete settings form. The desktop proof panel sticks within that form's scroll area, while the PDF page inside it still scrolls independently. The single-column media rule makes the proof static. No export settings, source selection, file generation or source-note logic changed.

## Validation

- `SKIP_BACKUP=1 npm run build`: passed, including TypeScript, ERT locks, CSS bundling/duplicate checks, quality checks and production build. The explicit skip prevents an unrelated automatic backup commit; the verified change is committed separately.
- Targeted Vitest: 31 tests passed across export purposes, profile model, proof freshness and delivery.
- Native Obsidian: exact Markdown → Readers → PDF sequence passed after loading the rebuilt stylesheet. A seven-page synthetic proof rendered; scrolling the modal reached Destination and the enabled Generate PDF button, with the proof beside it.
- Native final export: Generate PDF created the final synthetic PDF and file checks passed for 1/1 final files. The resulting Review exported files control remained reachable. This verifies delivery reachability, not full content acceptance of the synthetic PDF.
- Native narrow window: 913 CSS pixels wide; proof position resolved to static, settings overflow to visible, and final actions were inside the modal. Visual inspection confirmed the destination and delivery controls. Hidden Obsidian dropdown measurement elements account for a small computed horizontal overflow; visible controls were not clipped.
- Native format changes: Word and Markdown both hid the proof and exposed their corresponding Generate actions at the bottom of the modal. Returning through Readers → PDF restored the expected proof layout and reachable final actions.
- Inspector values: desktop settings overflow `visible`, proof position `sticky`, top `0px`; narrow proof position `static`. Existing ERT gap resolves to `8px`.
- Original Author Vault session was not driven or reloaded. QA ran only in `Demo Vaults/Testing Vaults/2026-10-13 Publish controls/Working`. The normal build copied the stylesheet to configured local plugin folders; running Obsidian sessions need a plugin reload to load it.

## Visual evidence

All images contain synthetic QA material, not author manuscript content. Inspected before/after and narrow screenshots:

- [Before: outer scroll reaches blank space](2026-10-13-publish-export-scroll-evidence/before-outer-scroll.png)
- [After: destination, Generate PDF and proof](2026-10-13-publish-export-scroll-evidence/after-destination-and-proof.png)
- [After: completed final export](2026-10-13-publish-export-scroll-evidence/after-final-export.png)
- [After: narrow-window delivery controls](2026-10-13-publish-export-scroll-evidence/after-narrow-actions.png)
