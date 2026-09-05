## Radial Timeline 6.2.3

This is a plugin-review compliance release. It clears every error reported by the Obsidian community plugin scanner and hardens the plugin for popout windows. It does not add new author-facing workflow features.

### Improvements

- Removed all `innerHTML` assignments from the plugin. Icons now use Obsidian's built-in Lucide icon API, and trusted SVG previews mount through a `DOMParser`-based helper, satisfying the scanner's strengthened source-code review.
- Replaced global `document` references with `activeDocument`/`ownerDocument` across the codebase so the timeline, synopsis, and inquiry surfaces render correctly in popout windows.
- Fixed a latent bug where the year-progress ring fragment failed to parse during dynamic updates, and removed stray comment text that was being injected into the Chronologue missing-When warning tooltip.
- Capped Inquiry briefing/engine popovers to the view height so long inner lists scroll instead of overflowing.
- Removed the embedded README from Core settings.
- Refreshed the README header for the community listing (centered markdown-first header, larger logo, restored badges and before/after table).

### Notes

- Engineering doctrine now hard-bans `innerHTML`/`outerHTML` with no escape hatch; the internal compliance gate enforces the same rule the Obsidian scanner applies.
- No new runtime feature surface is introduced in this patch.
