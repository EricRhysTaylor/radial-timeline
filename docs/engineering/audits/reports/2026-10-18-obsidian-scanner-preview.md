# Obsidian scanner preview and type-library correction — October 18, 2026

## Official preview

Triggered the owner-authorized preview against pushed commit
`ccac2d3b7c0e80f4a540f9f717e7f87cb149f867`. The dashboard accepted the request.
The returned dependency check passes: **No vulnerable dependencies found**.
License and the three existing CSS compatibility groups returned warnings.
The preview is now Completed. Its remaining source findings are the numeric
operand pair, settings definitions, and the `TimetableView.ts:364` assertion.
The former fetch warning and the two YAML assertions no longer appear. Preview
completion is not a public reclassification of the released version.

## Small confirmed correction

The public 7.6.0 scan reports two numeric-operand warnings in
`LocalSemanticIndex.ts:152`. That arithmetic is unchanged on current main.
A targeted lint reproduction with ambient type packages excluded reproduces
both warnings. The configured JavaScript libraries stop before APIs already
used by that module, including `flat`/`flatMap`. Missing declarations cause
inference to degrade to unknown, despite numeric values in the actual code.

Set `compilerOptions.lib` to `DOM` and `ES2020`, which includes the earlier
library declarations and supplies those existing APIs explicitly. This removes
both numeric-operand warnings in the same targeted probe. No assertions,
warning suppressions, arithmetic rewrites or runtime fallbacks were added.

This probe is not a claim that the entire project passes typechecking without
Node ambient declarations; desktop modules still require their Node types.

## Remaining assertion

The completed preview still flags the column-width parser's object assertion in
`TimetableView.ts`. Declare the incoming configuration value as `unknown`, keep
the existing object/finite-number guards, and let `Object.entries` accept the
narrowed value directly. The focused official-preset lint check has zero errors
or warnings. No runtime code changes: shipped artifacts remain byte-identical.

## Verification

- Production build passes.
- All three shipped artifacts (`main.js`, `styles.css`, `manifest.json`) are
  byte-identical before and after the type-library correction. Compiler and
  bundler emission targets are unchanged.
- Full 14-gate regression run is recorded with the delivery evidence.
- No native UI behavior changed. No CSS, license, languages, fonts, publishing
  capability or settings implementation was changed.

## Completed corrected preview

The preview of `ab0f31ed9af23c8f10a8f14b992554568bae8f30` is Completed.
The numeric-operand pair and Timetable assertion no longer appear. Dependencies
pass. The only remaining source warning is missing settings-search definitions;
license and 48 CSS compatibility locations remain.

## CSS spacing batch

Two of the six multicolumn locations flag `column-gap` on grid/flex components:
the timeline search option rows and compact legend copy. Combine each existing
row/column pair into the equivalent `gap` shorthand. Preserve both dimensions,
selectors, ordering, wrapping, and controls. No TypeScript or persisted data
changes are involved. The CSS stage of the next preview (`92e330ac`) confirms
both timeline locations no longer appear; the multicolumn group falls from six
locations to four, and total CSS locations from 48 to 46. The preview is now
Completed: dependencies pass, settings search remains the only source warning,
and no new source findings appeared.

The fixture comparison uses the actual before/after timeline stylesheet with
representative component markup at normal and narrow widths, light and dark.
Computed gaps and element rectangles match exactly. Screenshot comparisons of
the component area (0,0 to 500,560) have zero differing pixels in both themes;
the enabled checkbox can still toggle. This is browser fixture evidence.
The production build and all 14 gates pass.

Native follow-up in Output QA Vault: the initial locked response was display
sleep. Waiting three seconds and retrying `getApp('Obsidian')` once restored
access without a password. On this Mac, retry that response up to three times
with three-second intervals before asking the owner to intervene.

Installed JavaScript and manifest already matched the current build; copied
only the updated stylesheet into this controlled QA vault. Native search
matched all 12 scenes, Scene body toggled on and back off, and disabled AI
controls retained their explanations. The actual compact Timetable legend
renders readable labels/details and wraps its longer descriptions in the
narrow pane. This native check covers the current dark theme; the light/normal
layout comparisons above remain browser fixture evidence.

Do not rewrite the intentional underlines, multicolumn prose or flattened grid
wrappers merely to lower the tally. Settings definitions also require an actual
migration: on Obsidian 1.13+, non-empty definitions bypass `display()`. A dummy
method or partial replacement would either hide the warning without solving
search or replace the existing settings UI.

## Rating and next acceptance

The official directory documentation describes errors, warnings,
recommendations, passes and capability disclosures, but gives no numerical
Caution/Satisfactory cutoff or weighting formula. Warnings do not block
submission. Do not infer a threshold from the number of listed locations or
claim a preview Completed state is Satisfactory.

References:
- https://docs.obsidian.md/community-directory/manage-entry
- https://obsidian.md/help/community-directory
- https://docs.obsidian.md/plugins/guides/migrate-declarative-settings
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/gap

Allow the owner-reported 6-10 minutes per scan; do not duplicate a pending
review. The public Caution rating remains unresolved and no public release was
made during this pass.

Private evidence: Command Center / Agent Runs /
2026-10-18 Obsidian scanner previews.

## Owner decision: defer settings-search migration

The owner explicitly deferred `getSettingDefinitions()` on October 18. Preserve
the tabbed, styled settings interface and keep integrated suites together,
including PDF styles, the Design Wizard, previews and export controls. Global
search is useful only if it leads into a complete workflow; isolated controls
are not a sufficient benefit to justify replacing the current interface.

Do not add empty definitions, partial replacement panels, warning suppressions
or a broad settings refactor to pursue this warning. Revisit only when a
prototype demonstrates a useful route into the existing workflows, with native
search navigation and visual/persistence acceptance. This warning is deferred
for the upcoming release; no overall rating change is promised.

## Completed planetary/Unicode preview

`8b198a6c4510cd160e64c09054012cf5f18edac8` is Completed. Dependencies pass,
settings search is the only source-code warning, and the license warning
remains. CSS compatibility locations fall from 46 to 45: 38 text-decoration,
three display-contents, and four multicolumn locations. The planetary modal
location no longer appears. The preview does not report an overall rating.
