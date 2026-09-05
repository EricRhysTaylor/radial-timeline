# Pre-Release Eyeball Checklist

Use this after the code/tests/gates are green and before shipping the next release.

## Always check

- Plugin loads cleanly in desktop Obsidian with no startup errors.
- Main view renders without clipped text, overlap, or obvious layout drift.
- Settings open cleanly and the last touched settings surfaces still feel aligned and readable.
- Every touched modal opens, closes, and confirms/cancels cleanly.
- Release version is consistent across `package.json`, `src/manifest.json`, `manifest.json`, and `versions.json`.
- `README.md` disclosures still match actual behavior.

## If timeline or interaction surfaces changed

- Hover, click, right-click, and selection flows still work.
- Scene labels, popovers, and highlights do not visibly regress.
- At least one large project and one smaller project still feel usable.

## If settings or modal chrome changed

- Desktop layout at normal scale looks intentional, not crowded.
- Buttons, toggles, badges, and helper text still align.
- No important action is pushed below the fold unexpectedly.

## If publish/export changed

- Run the relevant publishing smoke test.
- Open one generated output artifact manually.
- Check folder reveal/open flows on desktop.

## If AI surfaces changed

- Turn AI Off and confirm the UI reflects the disabled state correctly.
- Confirm at least one normal non-AI workflow still works with AI disabled.
- If AI networking changed, re-check the privacy/disclosure copy.

## If release/docs/review surfaces changed

- Community-plugin-facing metadata is still correct.
- Release notes match what actually changed.
- Privacy/security wording is still accurate.
