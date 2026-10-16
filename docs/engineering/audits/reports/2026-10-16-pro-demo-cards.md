# Pro settings demo-vault cards

Date: 2026-10-16

Updated the existing demo shelf to match the three launched demos on the live resource pages:

- Pride & Prejudice: https://www.radialtimeline.com/resources/pride
- The Odyssey: https://www.radialtimeline.com/resources/odyssey
- Sherlock Holmes: https://www.radialtimeline.com/resources/sherlock

The cards now bundle all three illustrations as 512px JPEGs through the standard embedded-asset manifest, replacing the one-off Pride & Prejudice base64 module. Artwork displays offline and ships inside `main.js`; no plugin-folder asset path or remote image request is required. Source illustrations came from `Web/RT Framer Website/images/` and were compared with the live pages. The wiki's existing demo-shelf screenshot was stale, so it was not used as the current presentation reference.

Descriptions now explain each demo's saved analysis. Each card's Explore action opens that selected demo's add/open controls; the general demo chooser still lists all available projects. Direct demo-page and ZIP links are available on each launched card. The unreleased card is labeled Secret vault, with no book title, author, or active link.

## Verification

- All three resource pages, all three direct archive URLs, and all three tracked ZIP links returned HTTP 200. Both download paths returned each demo's expected byte count and SHA-256. ZIP contents used the expected root folder.
- Download sizes: Pride & Prejudice 739,102 bytes; Odyssey 1,098,230 bytes; Sherlock Holmes 5,483,077 bytes.
- 23 importer tests passed with the downloaded published editions, including all twelve saved Sherlock Inquiry results. Updated the existing integration assertion to handle three briefings per book and each book's remapped number.
- Isolated browser checks rendered the actual settings-card and modal code with Obsidian CSS and stubbed host/import boundaries. Fourteen light/dark cases at pane widths 360, 480, 520, 521, 560, 680, and 900 px showed three decoded bundled images, six correct external links, an unnamed unreleased card, and no right-edge overflow. All three card actions selected the correct demo; the general chooser retained all three. Screenshots inspected.
- `SKIP_BACKUP=1 npm run build` passed and copied the build to configured local plugin folders. Repository gates were run before commit.

Native post-reload interaction was not exercised. Reload Radial Timeline to load the updated settings and modal code.
