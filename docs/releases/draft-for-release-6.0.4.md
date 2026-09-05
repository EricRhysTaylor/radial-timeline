## Radial Timeline 6.0.4

This is a focused publishing and timeline workflow release.

### Improvements

- Revamped Settings → Publish around clearer Core and Pro tiers, preparing the publishing system for the upcoming Pandoc Design Wizard.
- Core now includes bundled PDF layouts, while Signature Pro unlocks the expanded designed publishing layouts.
- Improved the bundled Pandoc publishing templates, including Standard Manuscript, Modern Classic, Contemporary Literary, and Signature Literary.
- Added stronger Book Details and Book Pages handling so common front matter and back matter can be generated from book metadata without requiring separate matter notes.
- Added export previews, warning cards, layout pictograms, and template summaries to make PDF style selection and readiness easier to understand before export.
- Added Saga timeline support: view all novels defined in Book Manager profiles together in Narrative Mode.
- Added narrative timeline part/chapter markers that reflect the active PDF layout, including outer-ring P/C notation for layouts with parts and chapters.
- Added Timeline title-bar quick actions for Search, Print, Commands, Radial Timeline modals, and export workflows.
- Updated bundled PDF font handling, including Source Serif 4 support for Contemporary Literary PDFs and clearer install guidance when a required font asset is missing.

### Documentation

- Updated the wiki for Saga timeline scope, publishing placards, Settings → Publish, bundled layouts, Book Details, Book Pages, and Pandoc setup.

### Bug Fixes

- Fixed PDF export failures caused by missing, stale, or incompatible bundled Pandoc template files.
- Fixed front matter and back matter export issues, including Book Pages order, BookMeta-only pages appearing when matter was disabled, and inline LaTeX metadata leaking into PDFs.
- Fixed Auto configure publishing so retired starter examples are refreshed while edited author files are preserved.
- Fixed Markdown and PDF output buttons so their active state matches the Manuscript/Outline toggle styling.
