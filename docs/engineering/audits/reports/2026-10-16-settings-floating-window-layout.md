# Settings layout audit — Obsidian 1.14 floating windows

Date: 2026-10-16

Reviewed all eight Radial Timeline settings tabs against the supplied screenshots and their renderers/shared CSS. This is a layout correction; no settings values, scene YAML, or feature behavior were changed.

| Tab | Findings and corrections |
| --- | --- |
| Core | Removed the forced two-row Quick Links grouping so links wrap together. Stacked Act labels above a full-width input. Narrowed beat-row gaps/status gutter and bounded numeric columns; act selectors show the configured act name, while section headings and tooltips retain scene ranges. Very narrow panes use two lines per beat. Color-grid breakpoints now measure the settings pane. |
| Social | Shared hero-list grid keeps icons beside wrapped text. Preview controls stack below their label at narrow widths. Shared ordinary setting rows can wrap control groups instead of compressing descriptions. |
| Community | Shared hero-list and badge fixes cover long aggregate-sharing text and long badge titles. Ordinary connection controls can wrap. |
| Inquiry | Hero icons remain beside text. Book-source rows have flexible columns and a compact two-line layout. Material-rule rows become labeled cards at narrow widths, retaining Book/Saga/Reference control labels. |
| Publish | Shared hero/badge fixes and ordinary button-group wrapping apply. Existing dedicated PDF-style preview rows retain their specialized layout selectors. |
| AI | Both enabled and disabled hero lists use the shared icon/text grid. Existing full-width credential rows are excluded from the generic horizontal-row contract. Strategy/capacity and Local LLM status breakpoints now measure the settings pane. |
| Advanced | Shared hero/badge and ordinary setting-row fixes apply; toggle rows retain their separate layout contract. |
| Pro | Hero prose switches to one column based on pane width. License controls stack below their description and wrap within the pane. |

## Verification

- `SKIP_BACKUP=1 npm run build`: passed; TypeScript, CSS duplicate and namespace checks included. Local configured plugin folders received the build.
- Focused settings/navigation/lifecycle/Inquiry tests: 12 passed.
- Isolated Chromium layout fixtures using captured Obsidian 1.14.4 CSS and the rebuilt plugin CSS: light and dark at 18 pane widths from 480 to 1000 px, including immediately around the layout breakpoints, inside a 1500 px viewport. These specifically verify pane queries independently of window width.
- Fixture checks: no right-edge overflow among tested controls/cells; Act labels input below description; hero icon/text alignment; Inquiry source rows contained; first beat-title input at least 145 px at the tested single-line widths (279 px at 480 px using the two-line layout). Core and Inquiry screenshots inspected.
- Repository gates: all 14 passed, including 4,557 unit tests (24 skipped); existing report-only lint and unused-CSS notices remain.

## Coverage limits

Native Obsidian inspection confirmed the floating settings document and the reported shared wrapping mechanism. Native post-build interaction/reload verification was not completed: keyboard-based inspection was stopped after a focus change. The Chromium fixtures reproduce the affected markup patterns; they are not an exhaustive native traversal of every setting, expanded state, translated string, provider state, or custom act label. Reload Radial Timeline to load the updated JavaScript controls.
