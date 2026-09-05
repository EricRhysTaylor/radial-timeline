## Radial Timeline 6.0.5

This is a localization, Inquiry, publishing, and timeline reliability release.

Note: Pandoc PDF Designer is still under development and is not yet released. Use one of the four built-in PDF templates for now.

### Improvements

- Added broader language support with expanded UI translations for Japanese, Chinese, Korean, and German, backed by English fallback text where coverage is still growing.
- Improved Inquiry Saga processing for multi-book analysis across Book Manager profiles, with stronger provider handling for large Gemini and OpenAI runs.
- Improved AI cost, cache, and provider-status reporting so Inquiry and runtime workflows show clearer estimates, cache reuse state, and provider errors.
- Added stronger fallback-safety gates to the release checks so silent defaults and hidden failure paths are harder to introduce.
- Improved Timeline Repair with stronger When-date scaffolding, text-cue detection, review snapshots, restore support, and safer frontmatter writes.
- Advanced the publishing system toward the Pandoc Design Wizard with generated style specs, LaTeX preview support, PDF wizard fixtures, font resolution checks, and visual QA baselines.
- Updated Radial Timeline branding with the RT logo replacing the generic shell icon in key timeline surfaces.
- Refined the year-elapsed timeline ring with flat endcaps for cleaner visual reading.

### Documentation

- Reworked the wiki around the current four timeline modes, Inquiry, Publishing, Settings, and refreshed screenshot assets.
- Added engineering guidance for fallback policy, wiki style, and release gates.

### Bug Fixes

- Fixed Inquiry Saga scope issues across Book Manager profiles and provider runs.
- Fixed AI cache and cost reporting so cache status, cache windows, and displayed estimates come from one source of truth.
- Fixed Timeline Repair and normalizer edge cases with expanded regression coverage.
- Fixed PDF publishing validation and font-resolution edge cases found while preparing the Pandoc Design Wizard.
