# Export review action alignment

Eric requested that Open file, the review checkbox and its description share a vertical center.

The file action row used a pill container without cross-axis alignment; the label used inline text and native checkbox margins. Replaced the container with the existing centered ERT inline row. The label now uses an explicit centered flex layout with an 8px token gap, and the checkbox has zero margin and cannot shrink. The text remains inside its associated label, preserving click and keyboard behavior. File opening, availability checks and review persistence are unchanged.

Native visual verification used Obsidian 1.14.4 in the isolated synthetic Working vault. Inspected desktop, 620px and 440px window captures, including the wrapped two-line review label. The common file-row code was exercised with a Word receipt, whose longer Open Word file label also fits. Desktop centers: button 658.494px; checkbox 658.490px; text 658.490px. Resolved gap 8px, checkbox margin 0px, row align-items center. Clicking the description checked the box and enabled Record review complete; clicking again cleared it. No completion was recorded.

Evidence: [before](2026-10-13-export-review-alignment-evidence/before.png), [after](2026-10-13-export-review-alignment-evidence/after.png), [narrow](2026-10-13-export-review-alignment-evidence/narrow.png), [checked](2026-10-13-export-review-alignment-evidence/checked.png), [wrapped](2026-10-13-export-review-alignment-evidence/wrapped.png).

Production build and TypeScript passed. All 13 delivery tests passed. All 14 repository gates passed; existing report-only lint and unused CSS notices remain within their baselines. No new workflow, schema or export behavior was introduced. Local plugin copies were rebuilt; existing Obsidian windows need RT reloaded.
