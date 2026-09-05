## Radial Timeline 6.0.1

This is a focused polish and bug-fix release following 6.0.0.

### Improvements

- Inquiry minimap icons now use clearer file, missing-file, and book glyphs.
- Inquiry corpus settings are simpler: low-substance notes and scenes remain visible automatically without an extra setting.
- Triplet Analysis / AI Pulse completion layout is cleaner, with redundant model/mode pills removed and log status kept inside the progress card.
- Modal and settings CSS were cleaned up to reduce ERT UI drift.
- AI model registry snapshots, aliases, and drift reports were refreshed.

### Welcome Screen

- Fresh vaults can now create the initial **Book 1** project folder from the Welcome flow before the first scene is created.
- Restored the Welcome screen background logo visibility.

### Bug Fixes

- Book Designer no longer requires authors to manually create the Book 1 folder before generating the nonlinear demo project.
- Book Designer demo-project generation now writes cleaner frontmatter and avoids malformed YAML.
- Inquiry minimap targeting no longer treats empty scene placeholders as focus targets.
- The Pro entitlement card's Learn more action now points to a valid wiki page.
- Settings release-note headings render with the intended spacing.
