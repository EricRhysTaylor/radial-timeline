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

## Pride & Prejudice Story Vault coordination

- Confirm the plugin release tag contains commit `b8cc1b9f` (portable Timetable adoption). In a fresh profile, opening the candidate's Timetable must open the packaged Base without creating a second file.
- Build the next Pride & Prejudice edition from its canonical vault using `scripts/demo-vaults/pride-and-prejudice-next.json`; set the contract's edition to the actual release date. Test the exact dated archive with the plugin release, including its Canvas, images and saved Inquiry.
- Publish the accepted vault edition with the plugin release, verify the public download, then update the catalog URL, hash, size and edition. Until then, the existing catalog remains the published edition and the new vault is a candidate.
