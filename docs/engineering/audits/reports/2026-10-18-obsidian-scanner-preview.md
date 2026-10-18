# Obsidian scanner preview and type-library correction — October 18, 2026

## Official preview

Triggered the owner-authorized preview against pushed commit
`ccac2d3b7c0e80f4a540f9f717e7f87cb149f867`. The dashboard accepted the request.
The returned dependency check passes: **No vulnerable dependencies found**.
License and the three existing CSS compatibility groups returned warnings.
The preview remains Pending/incomplete at this point; source checks have not
returned. This is not a completed public reclassification.

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

## Verification

- Production build passes.
- All three shipped artifacts (`main.js`, `styles.css`, `manifest.json`) are
  byte-identical before and after the type-library correction. Compiler and
  bundler emission targets are unchanged.
- Full 14-gate regression run is recorded with the delivery evidence.
- No native UI behavior changed. No CSS, license, languages, fonts, publishing
  capability or settings implementation was changed.

## Next acceptance

Read the completed official preview before undertaking a broader batch. Scan
this corrected commit when the current preview finishes; do not duplicate a
pending review of the same commit. Only a completed preview establishes the
remaining scanner findings. The public Caution rating remains unresolved and
no public release was made during this pass.

Private evidence: Command Center / Agent Runs /
2026-10-18 Obsidian scanner previews.
