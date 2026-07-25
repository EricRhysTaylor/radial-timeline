## Radial Timeline 7.0.1

A small compliance release. Obsidian's community directory now scans every plugin release automatically, and 7.0.1 brings Radial Timeline fully in line with its current review ruleset. No new features.

### Changes

- Fixed every actionable finding from the directory scanner, and removed the lint-suppression comments it blocks — shipped code now carries none.
- Aligned our local review tooling with the exact scanner version the directory uses, so what passes here passes there.
- Community settings confirmations now use Radial Timeline's own styled dialogs instead of the browser's built-in popup.
- Destructive buttons in manuscript onboarding use Obsidian's standard destructive styling.
- Removed the plugin's last use of browser storage (a one-shot Book Manager highlight) — Radial Timeline now stores nothing in Local Storage.
- Small internal cleanups flagged by the scanner: safer mode comparisons, modern DOM helpers, dead code removed.
- The release pipeline now runs the community-scan checks before any release can ship.
