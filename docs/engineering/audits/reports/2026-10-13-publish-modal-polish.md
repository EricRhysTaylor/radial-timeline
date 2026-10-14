# Manuscript export modal: spacing and copy polish

Date: 2026-10-13. Scope: Eric's requested cleanup of the existing export modal, especially the saved manuscript controls. This is a presentation change, not a new publishing feature.

## Changes

- Saved manuscript actions read **Update**, **Save**, **Remove**. Save retains the “Save as new” tooltip and its existing create-new behavior. Remove retains its confirmation.
- The Save as field, actions and helper form one group. Actions and helper align with the input, using the same 80px label column as Title, Author and Destination. The action row is 16px below the input.
- Saved selection and RT book dropdowns use that field grid too. A labelled Folder or Single file row now identifies the source path. The apparent second “Manuscript” in Eric's screenshot was a folder named Manuscript, not another section heading.
- Source details use 16px gaps. Export sections use a consistent 20px gap, replacing the combination of stack gap and card top margins.
- Routine “saved selection loaded” copy is suppressed. Unsaved changes, restored-source mismatches and errors remain visible.
- Shortened the introduction, purpose descriptions, PDF options, cleanup labels, proof and destination helpers. Removed the redundant split-output paragraph and manuscript output description. Folder and file exports hide the Content choice because only Manuscript is available; RT books retain Manuscript and Outline.
- Source action labels were shortened in English, German, Japanese, Korean and Chinese. Broader prose trimming is English only; existing translations remain available.

## Design reference ledger

The existing RT modal, ERT tokens and Eric's screenshot are the primary design reference. No new palette, typeface, icons or component system was introduced. Refero live style research informed only grouping and spacing: Linear Changelog (https://linear.app/changelog; style 11d3e58a-87d7-4a9a-bbf5-720f4fd3ffc6), and Memotron (https://memotron.app; style 1994e773-b551-4f96-bb86-1ce7ae8ab73d). The borrowed principles are plain compact copy, thin borders, consistent group spacing and separation around related actions. Their typography, palette and branded shapes were not adopted.

## Native visual and behavior verification

Used a separate Obsidian 1.14.4 profile and synthetic Working vault. No author manuscript content appears in the evidence. Inspected rendered screenshots of source details, purpose/output, layout, cleanup, presets, destination, checks, final actions and proof. Desktop uses the two-column PDF layout; a 1000×850 point window yields a 913 CSS-pixel viewport and the existing stacked proof layout.

| Check | Result |
| --- | --- |
| Saved action alignment | Input and actions have exactly the same left edge at desktop and narrow widths. |
| Resolved CSS values | Save group gap 16px 8px; details gap 16px; section stack gap 20px. Measured input-to-action gap 15.997px at both widths. Tokens resolve under ERT scope. |
| Save / Update / Remove | Updated title and author, saved a second named selection, removed only that saved record through confirmation, and restored the original selection. |
| Dirty notice | Editing a loaded selection reveals Unsaved changes even though the routine loaded notice starts hidden. |
| Source variants | Folder, single file and RT book paths inspected. RT book restores the Content controls; Outline retains its explanatory text and relevant options. |
| PDF | Generated a fresh 4-page proof and final PDF; native file checks passed 1/1. |
| Markdown | Single-file export completed; native file checks passed 1/1. |
| Word | Missing-author validation remained visible; supplying author enabled export, which passed native file checks 1/1. |
| Scrolling | Destination and final actions remain reachable at desktop and narrow widths. Controls overflow remains visible; the outer modal owns scrolling. |
| Author data | All three synthetic source Markdown files had identical SHA-256 hashes before and after save/update/remove/export tests. |

Evidence: [source before](2026-10-13-publish-modal-polish-evidence/before-source.png), [source after](2026-10-13-publish-modal-polish-evidence/after-source.png), [desktop PDF](2026-10-13-publish-modal-polish-evidence/after-layout.png), [final actions](2026-10-13-publish-modal-polish-evidence/after-final-actions.png), [narrow source](2026-10-13-publish-modal-polish-evidence/after-narrow-source.png), [narrow delivery controls](2026-10-13-publish-modal-polish-evidence/after-narrow-actions.png), [RT book](2026-10-13-publish-modal-polish-evidence/after-book-source.png), [single file](2026-10-13-publish-modal-polish-evidence/after-file-source.png), [Word delivery](2026-10-13-publish-modal-polish-evidence/after-word-delivery.png).

## Stabilization review

No architecture, persisted schema, source-selection algorithm or export engine changed. Removed the producer-less source-book-row CSS rule. New DOM groups use existing ERT tokens and direct modal lifecycle listeners. The previously fixed single-owner settings scrolling remains intact. No release-blocking finding in the changed surface.

Retained technical cleanup examples, validation details and source warnings: these explain consequential behavior rather than repeat adjacent controls. Broader translation edits, all-theme visual coverage and full-manuscript pagination acceptance were not part of this presentation pass. The native output checks confirm delivery/readability, not exhaustive content or pagination review of the produced documents.

## Automated verification

- Production build and TypeScript check passed.
- 40 targeted tests passed: export purpose/profile, manuscript proof, delivery and saved manuscripts.
- All 14 repository gates passed, including production build, TypeScript and the full unit suite. Existing nonblocking notices: one Obsidian lint rule and 243 producer-less CSS classes within the current ratchet.

Build copied to configured local vault plugin directories. Existing Obsidian windows need the plugin reloaded to use it. No public release requested or created.
