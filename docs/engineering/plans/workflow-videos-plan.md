# Workflow videos — plan

**Goal:** short videos, 45–90 seconds each, that show one workflow from start to finish, opened from the setting, dialog or wiki section that explains it. Radial Timeline first; Editorialist can follow the same pattern.

**Status (2026-11-11):** the video list and the play icon are built and wired for the first two videos. No video is published yet, so no icon shows. Eric records and decides the order.

## How a video reaches authors

- **Host:** the Radial Timeline YouTube channel, already linked from Settings → Resources → YouTube Video. One playlist for these videos.
- **Link:** every video opens through a registered, counted /go/ link, `https://community.radialtimeline.com/go/rt-video-<key>`. This is the same convention the Story Vault links follow (`src/settings/bonusVaults.test.ts`), so a video can be re-recorded or moved without a plugin release.
- **Link out, never embed.** An embedded player contacts YouTube as soon as the dialog opens, which the README's External Services section would have to disclose. A link contacts nothing until the author clicks it.

## Where the icon goes

- **Code:** `src/settings/workflowVideos.ts` lists the videos. In `src/settings/wikiLink.ts`, `addVideoLink` puts a `circle-play` icon on a settings heading and `addVideoLinkToElement` puts one in a modal badge or badge pill. The icon takes the class of the wiki link beside it, so the two match and no new CSS is needed. A video without a slug adds nothing.
- **Wired now:**
  - `pdf-export`: the Export & publishing heading in Settings → Publish (`PublishSection.ts`), the design wizard's header badge (`DesignedStyleWizardModal.ts`), and the Manuscript export badge (`ManuscriptOptionsModal.ts`).
  - `community-share`: the status pill at the top of Settings → Community (`CommunityShareSection.ts`).
- **Wiki:** GitHub wikis can't play video. Put a thumbnail at the top of the section the video explains, linking to its /go/ link. For example, at the top of Publishing: `wiki/images/video-pdf-export.webp` with the alt text "Watch: Design a PDF style and export your manuscript".
- **Release notes:** link a video when the feature it shows ships or changes.

## Making a video

- **Frame:** record 16:9 on a high-density display so Obsidian's interface stays readable. Cut a vertical version for YouTube Shorts only when the action stays inside one dialog.
- **Footage:** record in the Story Vaults (Pride & Prejudice, The Odyssey, Sherlock), so no private manuscript appears on screen.
- **Captions:** always on; most viewers watch muted. Voice-over is optional.
- **Shape:** open on the result, show three to five steps, end on a card naming the wiki page.
- **Example, `pdf-export`:**
  - 0–5 s: the finished PDF spread.
  - 5–20 s: Settings → Publish, choose a layout.
  - 20–45 s: the design wizard: trim size, fonts, chapter headings, with the live preview.
  - 45–70 s: the Manuscript export dialog, choose PDF, press Export.
  - 70–90 s: open the PDF; end card "Full guide: Publishing in the wiki".

## Publishing a video

1. Upload it to the channel with captions, and add it to the playlist.
2. Register `rt-video-<key>` on the Community site's /go/ links, pointing at the video (where `rt-welcome-youtube` lives).
3. Set its `goSlug` in `src/settings/workflowVideos.ts`. The icon appears everywhere that video is wired.
4. Add the wiki thumbnail.
5. Mention it in the next release notes draft.

A new video also needs its key in `WorkflowVideoKey`, a title under `ui.workflowVideos` in `en.ts`, and a call at each place it explains. Add those when the video is about to be recorded, not before, so the code never carries keys for videos nobody is making.

## Keeping videos current

The pre-release eyeball checklist asks: if a release changes a screen a published video shows, re-record the video or point its /go/ link at a newer one.

## The list

| Key (proposed) | Video | Why | Linked from |
|---|---|---|---|
| `pdf-export` (wired) | Design a PDF style and export the manuscript | Pro workflow with the most steps | Settings → Publish, design wizard, Manuscript export, wiki Publishing |
| `community-share` (wired) | Share your progress on the Community | Shows exactly what is and isn't shared | Settings → Community, wiki Settings-Community |
| `pandoc-setup` | Install Pandoc and fonts for export | Issues #29 and #34 were authors stuck here | Settings → Publish, wiki Publishing |
| `story-vault` | Add a Story Vault and look around | The first thing a new author sees | Welcome screen, Story Vault dialog, wiki Sample-Vault |
| `import-manuscript` | Bring in an existing manuscript, including from Scrivener | The biggest hurdle for new authors | Onboarding dialog, wiki Onboard-Existing-Manuscript |
| `ai-setup` | Connect AI, including a local model | Four outside contributors asked for local models in #14 | Settings → AI → API keys, wiki Settings-AI |
| `book-designer` | Plan a book with Book Designer | Book Designer's badge already links to the wiki | Book Designer badge, wiki Book-Designer |
| `reorder-scenes` | Reorder scenes by dragging the wheel | The core move in Narrative mode | Wiki Narrative-Mode |
| `scene-time` | Place a scene in story time | Shows Chronologue; for example, a time jump between two ships' timelines | Chronologue placement dialog, wiki Chronologue-Mode |
| `planet-calendar` | Give a planet its own calendar | For example, a colony world with a 30-hour day | Settings → Core → Planetary time |
| `timetable-lens` | The Timetable and its lens | For example, a saved "Kade's POV" view that lights up the wheel | Wiki Timetable |
| `progress-and-lamps` | Make a progress graphic and light a Desk Lamp | Pairs with `community-share` | Settings → Social, wiki Desk-Lamps |

Later: Gossamer beat scoring, running an Inquiry, writing goals and sessions, exporting the wheel as an image.

## Open questions

- **"Design your own…" is still beta-only in 8.0.1** (the `plugin.betaFeatures` check in `PublishSection.ts`). Either record `pdf-export` after it ships, or record editing a bundled layout with the pencil button, which already ships.
- **Editorialist** would use the same list-and-link pattern in its own repository, with a slug prefix of its own. One video links the two plugins: the Manuscript export dialog already points authors to Editorialist (the `rt-export-editorialist` link in `ManuscriptOptionsModal.ts`).
