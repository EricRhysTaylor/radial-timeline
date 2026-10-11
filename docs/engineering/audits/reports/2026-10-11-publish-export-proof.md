# Publish export: actual PDF proof workspace

Date: October 11, 2026. Baseline: `502ad8f2`. This adds document proof to the existing manuscript export dialog after direct book/folder/file selection. Native verification used Obsidian 1.14.4 on macOS, dark theme, and the controlled Scrivener Import QA vault. All manuscript evidence below is invented QA material.

## Behavior and ownership

PDF manuscript mode places export controls beside an actual rendered PDF page. Generate proof uses the existing selection, assembler, cleanup, validation, template and Pandoc pipeline. Previous/Next and the page field navigate the PDF's real page count. Split output provides a file selector with the page count for each generated file. Open proof opens the saved PDF in Obsidian's full reader.

Proof jobs write PDFs and a portable `schemaVersion: 1` receipt beneath the configured export folder's `Proofs/<job-id>` directory. They skip scene word-count writes, compiled Markdown artifacts, and export-completion preference writes. Existing interactive preference controls retain their own persistence behavior. Proof generation does not change scene prose or frontmatter.

The receipt fingerprints the submitted rendering configuration, selected source bytes, local embedded assets found by Obsidian's metadata cache, BookMeta where applicable, the actual LaTeX template, and generated PDF bytes. All selected source text is captured before rendering the first split part, so later parts cannot silently read newer versions of those selected notes. This is not a transaction over every publishing input: metadata/assets/templates are tracked and checked for freshness rather than atomically frozen.

Vault changes mark the visible proof **Needs refresh**. Configuration changes are checked when export UI state updates; actual dependency bytes are also checked after generation, on page/file navigation, and before final export. Missing inputs produce an explicit stale reason. The old proof remains available to inspect. The status names the actual effective PDF style and surfaces the existing template-access fallback notice.

Final export renders the current manuscript again. It does not promote or guarantee byte identity with the proof. The dialog explicitly states this boundary. Word and Markdown keep their existing export paths; the PDF proof pane does not certify Word pagination.

## Design reference and implementation

The design reference is RT's existing ERT export shell and the screenshots in the earlier Publish audits. Keep the established modal surface, flat panels, typography, accent, buttons and spacing tokens. Refero's bundled form guidance supplements those product references. No new visual theme or keyboard command was introduced.

| Decision | Reason |
|---|---|
| Two independently scrolling columns | Keep actual pages visible while adjusting manuscript options. |
| Generated PDF, real page count | Style pictograms cannot establish the output's pagination or content. |
| Explicit stale status, retained old pages | Show when the displayed document no longer represents the current choices. |
| Vault-local proof and receipt | Preserve inspectable output without operational YAML in author notes. |
| One PDF.js viewer per modal | Cancel superseded work and destroy the loading task on close. |
| Display-density raster with a 2048-pixel width cap | Keep desktop text crisp while bounding canvas memory. |

The preview uses Obsidian's public `loadPdfJs()` and the documented [PDF.js document/page/render API](https://mozilla.github.io/pdf.js/examples/), with evaluation disabled. There is no schematic or browser-print fallback. Responsive CSS changes the workspace to one column below 1000px; that breakpoint has not received native acceptance yet.

## Native and artifact verification

| Check | Observed result |
|---|---|
| Generate a two-scene proof | Actual two-page PDF loaded; page 1 contains The Door. |
| Next page | Actual page 2 contains The Hall; navigation follows the real two-page count. |
| Change to Reverse order | Existing pages remain; status and warning border change to Needs refresh. |
| Refresh changed order | New PDF opens on The Hall as page 1; status returns to Current proof. |
| Modify a selected QA source | Vault watcher shows Needs refresh for manuscript/publishing changes. The temporary test text was restored byte for byte. |
| Split into two files | Both one-page PDFs generated; switching Proof file changes the visible scene from The Door to The Hall. Effective style is Basic. |
| Inspect saved split artifacts | Both PDFs rasterized with Poppler and opened for visual inspection; extracted prose/order and one-page counts agree with the native preview. |
| Source integrity | All seven source/BookMeta notes across the RT and plain-source QA fixtures match their pre-test SHA-256 hashes. Author Vault prose was not edited. |

The split native run includes the final style-name, count and display-density changes. The later source-error button guard passed the final build/tests but did not need a changed visual layout. Source-choice, ordinary-folder/file exports, PDF/Word/Markdown artifacts and range selection have prior acceptance in the direct-source and visual-QA reports; they were not all rerun as new proof cases in this pass.

Native computed-style inspection is pending the user's short Obsidian access window. The new controls, pane, file row, navigation and page frame all descend from the existing `.ert-ui` modal shell; source inspection confirms token scope, but it does not replace the playbook's inspector check.

## Post-feature audit

Report-first audit of the touched modal lifecycle, proof controls and asynchronous paths, common submission builder, runner capture/render/return path, source assembler type narrowing, proof helpers/viewer, CSS and regression tests. Existing normal-export behavior remains on the shared pipeline. No new settings migration, global shortcut, network request, or source YAML field was added.

- **Cleanup summary:** proof state belongs to the modal; renderer task ownership belongs to one small viewer; fingerprint/receipt logic belongs to a publishing helper. No parallel export engine was added.
- **Refactors performed during implementation:** extracted the existing submission object into one builder shared by proof, freshness checking and final export; narrowed the assembler's vault dependency to its actual `read` requirement.
- **Dead code removed:** removed the duplicate inline submission object. No unrelated code cleanup.
- **Naming:** Document proof, Current proof, Needs refresh, Proof file and Open proof describe actual artifacts and state. Existing style diagrams remain separate.
- **State/safety:** unique proof directories, source capture across split parts, ignored late page work, worker cleanup, explicit stale failures, disabled generation during invalid/loading source state and skipped export side effects are implemented. Regression tests cover these contracts.
- **Prioritized findings:** required native token inspection remains an acceptance item. No additional release-blocking code defect identified in the bounded paths reviewed. Some persisted settings controls may only expose stale state on the next common UI refresh/navigation; final export still checks current inputs and recompiles them. Broader continuous settings/template/font invalidation is follow-up work.
- **Verification:** all 15 final gates passed. Production build-only and TypeScript checks passed; 4,221 tests passed, 10 skipped. New coverage includes source/configuration staleness, direct-source independence from active book, one/two-part proof side effects, captured split source text, actual page count/navigation contract, display-density cap, and late page resolution after close. Final receipt: `/tmp/rt-publish-proof-release-gates.json`.
- **Existing debt:** report-only lint and unused-CSS warnings remain within the repository ratchets; no baseline increase was introduced.

## Deferred concerns and next work

Save reusable manuscript source, inclusion and order in plugin data or portable sidecars, so ordinary-folder users can reopen the same export job. Continue the design-first export workflow through destination review and a truthful final-delivery check. Exact proof promotion would require a separately designed immutable rendering-input contract.

Acceptance limits: no new full-length novel stress test, narrow-window/light-theme/VoiceOver/Windows/Linux certification, or native direct-file proof run. Canvas exposes a page label, not a PDF text layer; Open proof provides the complete reader. No continuous native filesystem/font/tool-version monitoring is claimed. Proof retention/cleanup is not implemented; saved proofs remain author-owned local artifacts. This is an implementation and bounded QA record, not a public release.

## Inspected evidence

- [First two-page proof](2026-10-11-publish-export-proof-evidence/first-proof.png)
- [Second page](2026-10-11-publish-export-proof-evidence/second-page.png)
- [Changed options need refresh](2026-10-11-publish-export-proof-evidence/stale-options.png)
- [Refreshed reverse order](2026-10-11-publish-export-proof-evidence/refreshed-order.png)
- [Source change needs refresh](2026-10-11-publish-export-proof-evidence/stale-source.png)
- [Split part 1](2026-10-11-publish-export-proof-evidence/split-part1.png)
- [Split part 2](2026-10-11-publish-export-proof-evidence/split-part2.png)
- [Saved PDF part 1](2026-10-11-publish-export-proof-evidence/artifact-part1.png)
- [Saved PDF part 2](2026-10-11-publish-export-proof-evidence/artifact-part2.png)
