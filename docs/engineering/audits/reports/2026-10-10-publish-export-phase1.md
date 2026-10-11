# Publish export reliability implementation and hardening

Phase 1 implements the reliability and truth corrections approved after the [Publish audit](2026-10-10-publish-export-professionalization.md). It preserves existing PDF geometry, style IDs, export presets, cleanup options and manuscript selection policies. PDF ranges, ordinary-folder selection and the proof workspace remain the subsequent phase.

## Changes

- Markdown and outline readiness bypass publishing metadata and toolchain checks. The real manuscript runner now exports a selected Markdown excerpt without BookMeta, rather than reaching the PDF-named metadata error.
- Required metadata, selected-style compatibility, fonts, Pandoc and compatible LaTeX engines use one set of deliverable issues shared by the modal, Publish readiness and execution. Missing fields are visible before generation, with links to the relevant settings. Style-specific checks are labelled separately from overall export readiness.
- Book Details are described accurately as required for current PDF/Word workflows; Book Pages remain optional. The Publish export entry stays available even when PDF setup is incomplete. Word is included in the overview and export-tool descriptions.
- Basic is described as the existing 6×9, sans-serif, 1.5-spaced reading draft with scene openers. No existing document styling or saved custom styles were migrated.
- The duplicated BookMeta parser/resolver and old runtime metadata guards were removed from the command runner. Missing or ambiguous source metadata is not replaced by the active book's cached metadata.
- Rendering uses a unique hidden staging directory beside the destination. The renderer must complete and return a PDF/ZIP container signature before publication. A same-filesystem hard link publishes the completed file exclusively; an existing name gets a numbered sibling, and the existing file stays untouched. Staging files are removed on success and failure.
- Split failures retain all paths already created and show every completed file in the modal. Word rendering failures no longer claim PDF compilation failed.
- Each job captures its original book identity and layout/page options; successful PDF preferences attach to that book. The modal prevents duplicate submission while a request is in flight. Changing options clears stale errors and completed-file state.
- Scene-ID summaries distinguish known IDs, missing IDs and counting in progress.

## Hardening review

The cleanup removes duplicate metadata interpretation, the separate modal font-block flag, duplicated subprocess PATH construction and repeated engine filesystem probes. No secondary export engine, source-provider registry, new persistent schema or operational scene YAML fields were added. The unused configured-path-missing helper and obsolete syntax-only Pandoc path validator/tests were removed; actual executable availability now drives setup and readiness.

UTF fontspec templates cannot select pdflatex when XeLaTeX/LuaLaTeX is unavailable. Rendering itself also fails clearly when no compatible engine is detected. Existing source-note word-count maintenance remains an explicit export option; this phase does not change its saved setting.

The new readiness panel reuses the existing `ert-panel`, `ert-stack` and `ert-section-title` primitives inside the modal's `.ert-ui` root. It exposes status text and a polite status announcement. Runtime computed-style inspection, keyboard/focus review and visual acceptance require the native session; the Mac was locked during this implementation pass.

## Verification

Regression coverage exercises the actual command runner through selection and assembly, not just the progress model:

- A metadata-free Markdown excerpt includes the chosen scene, excludes the other scene, removes selected private comments and makes no source-note metadata writes.
- A second-part write failure reports the first completed output.
- Concurrent renderer calls isolate their temporary inputs and publish different complete files.
- Existing deliverables are preserved, and failed/empty renders publish nothing.
- The formatted validator blocks missing title/author, missing Pandoc/fonts and incompatible or missing PDF engines.
- A fontspec template cannot choose pdflatex.

The full unit suite and typecheck passed before the final gate pass. Real installed-tool tests (`RT_PUBLISH_LIVE_OUTPUT=1`) produced a Word archive whose document XML contained the expected revised prose while preserving the earlier file, and a PDF whose prose was read back by Poppler. All four existing bundled PDF smoke fixtures passed without changing their page counts: 2, 7, 2 and 7.

The final repo gates provide the authoritative final build/test result. Native acceptance is pending: the UI tool reported that the Mac was locked, and the user was asked to unlock it. No new native screenshot or visual acceptance is claimed.

## Remaining limits

- Atomic publication requires hard-link support in the destination filesystem. Local macOS output was exercised; an unsupported filesystem fails instead of overwriting an existing deliverable or silently changing publication strategy.
- Windows/Linux, custom/imported styles, populated Book Pages and a long manuscript still need native acceptance. Basic's description was corrected; a dedicated submission PDF layout is not added in this phase.
- PDF still uses the whole book in narrative order. Content/format independence, keyboard range controls, direct ordinary-folder/single-file selection and actual manuscript proof belong to the next phase.
- The local production build copies artifacts to configured vaults, but an Obsidian reload is required to load them. Native reload/verification could not be performed while the Mac was locked.

The pre-existing model-catalog working-tree changes are excluded from this implementation's commit.
