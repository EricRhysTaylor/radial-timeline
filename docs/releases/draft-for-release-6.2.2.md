## Radial Timeline 6.2.2

This is a focused Obsidian Plugins Page readiness release. It does not add new author-facing workflow features; it tightens the public listing, review disclosures, and release packaging around the current plugin build.

### Improvements

- Tightened README and directory-facing formatting so the Obsidian Plugins Page can render the plugin listing more cleanly.
- Shortened the manifest description so it no longer starts by repeating the plugin name.
- Clarified desktop support, privacy/security posture, external service use, and Pandoc export shell/file-system access in the README.
- Hardened release packaging with full production minification, CI-built release assets, and GitHub build-provenance attestations.
- Removed scorecard-noisy development dependencies and generated vault artifacts from the tracked repository.
- Repointed local build and audit references after the repo moved to the `RT LLC/Plugin/radial-timeline` folder.

### Notes

- No new runtime feature surface is introduced in this patch.
- This release is intended to support the updated Obsidian Plugins Page review and listing flow.
