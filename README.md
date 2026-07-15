<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/master/logo.png">
    <source media="(prefers-color-scheme: light)" srcset="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/master/logo-light.png">
    <!-- Fallback img is the WHITE logo: renderers that ignore <picture> (e.g. the
         community.obsidian.md listing page, which is dark-themed) show this one. -->
    <img src="https://raw.githubusercontent.com/EricRhysTaylor/radial-timeline/master/logo.png" alt="Radial Timeline logo" width="360" style="border-radius: 0;">
  </picture>
</p>
<p align="center" style="font-family: sans-serif; font-size: 26px; margin-top: 12px; margin-bottom: 4px;">
  <span style="font-weight: 100; letter-spacing: 10px;">Radial Timeline™</span>
</p>
<p align="center" style="font-family: sans-serif; font-size: 16px; margin-top: 0; margin-bottom: 10px;">
  by Eric Rhys Taylor
</p>

<p align="center">
  <a href="https://github.com/EricRhysTaylor/radial-timeline/stargazers"><img src="https://img.shields.io/github/stars/EricRhysTaylor/radial-timeline?colorA=363a4f&colorB=e0ac00&style=for-the-badge" alt="GitHub star count"></a>
  <a href="https://obsidian.md/plugins?id=radial-timeline"><img src="https://img.shields.io/badge/dynamic/json?url=https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-plugin-stats.json&query=$.radial-timeline.downloads&label=Downloads&style=for-the-badge&colorA=363a4f&colorB=d53984" alt="Plugin downloads"></a>
  <a href="https://github.com/EricRhysTaylor/radial-timeline/blob/main/LICENSE"><img src="https://img.shields.io/static/v1.svg?style=for-the-badge&label=LICENSE&message=NON-COMMERCIAL&colorA=363a4f&colorB=b7bdf8" alt="License — non-commercial software license"></a>
  <a href="https://github.com/EricRhysTaylor/radial-timeline/issues?q=is%3Aissue+is%3Aopen+label%3Aenhancement"><img src="https://img.shields.io/github/issues/EricRhysTaylor/radial-timeline/enhancement?colorA=363a4f&colorB=00bfa5&style=for-the-badge&label=enhancements" alt="Open enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/radial-timeline/issues?q=is%3Aclosed+label%3Aenhancement"><img src="https://img.shields.io/github/issues-closed/EricRhysTaylor/radial-timeline/enhancement?colorA=363a4f&colorB=4a90e2&style=for-the-badge&label=closed%20enhancements" alt="Closed enhancements on GitHub"></a>
  <a href="https://github.com/EricRhysTaylor/radial-timeline/issues?q=is%3Aissue+is%3Aopen+label%3Abug"><img src="https://img.shields.io/github/issues/EricRhysTaylor/radial-timeline/bug?colorA=363a4f&colorB=e93147&style=for-the-badge&label=bugs" alt="Open bugs on GitHub"></a>
</p>

> [!NOTE]
> **Why Obsidian flags "Direct Filesystem Access" and "Shell Execution" on install:** both come from a single feature — the **Pandoc manuscript publishing pipeline**. Shell execution runs Pandoc (and its LaTeX engine) only when you export; filesystem access writes your export files and locates the Pandoc binary and fonts that live outside the vault. Neither is used for anything else. See [Privacy & Security](docs/privacy-and-security.md).

## What It Does

Radial Timeline® arranges your scenes by act, subplot, narrative or chronological order in a striking radial layout—revealing the structure, rhythm, and scope of your story. Each ring represents a subplot; hover interactions surface important details like scene synopsis and AI story pulses. Scenes highlight across subplots to show interrelationships. Multiple view modes present your novel like an X-ray.

| **Before** | **After** |
| --- | --- |
| Scrolling through line after line of spreadsheet tables and files, losing sight of how your B-plot interweaves with the main storyline. | One visual map showing every scene, every subplot, color coded and ordered in context and connected to the big picture. |

Radial Timeline® captures and visualizes four core timelines, letting you see manuscript order, story chronology, writing progress, and revision stage in one connected view.

- **Narrative time**: the sequence you reveal events to readers.
- **Chronological time**: when events happen in your story's world.
- **Author time**: your scene writing progress with target due dates tracking Todo, Working, Complete, and Overdue.
- **Progress stages**: manuscript revision stages from Zero draft through Press-ready.

The mode buttons run in this order: Progress, Narrative, Chronologue, and Gossamer. Narrative and Chronologue keep subplot colors front-and-center so you can compare structure without workflow noise. When you need to see Todo/Working/Overdue status or progress stage colors, switch to Progress Mode, where the combined outer ring is replaced by a single-subplot view and scenes inherit the author-status and progress-stage palette.

## Docs (How-to & Setup)

If you want the "how-to" details (setup, sets, properties, reordering, advanced options), they live in the wiki:

- [Wiki Home](https://github.com/EricRhysTaylor/Radial-Timeline/wiki)
- [How-to](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/How-to)
- [Settings](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Settings)
- [Commands](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Commands)
- [YAML Frontmatter](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/YAML-Frontmatter)

## Sets, Properties, and Templates

- **Sets** define the structural fields used in your notes.
- **Properties** are custom metadata fields added to notes.
- **Presets** are starter configurations for campaigns or workflows.
- **Templates** are used only for export formatting (e.g., Pandoc).

## Watch

[![Plan your novel with Radial Timeline in Obsidian — complete author walkthrough & setup guide](https://i.ytimg.com/vi/7noTSFaj8Eo/maxresdefault.jpg)](https://youtu.be/7noTSFaj8Eo)

Ongoing series on the [Radial Timeline YouTube channel](https://www.youtube.com/@RadialTimeline):

- **Volume 1 — Intro**: [Original home page intro video](https://youtu.be/7noTSFaj8Eo)
- **Volume 2 — Chronologue Mode**: [Chronologue Mode Volume 2](https://youtu.be/XKWq32LB0d0?si=VF6S1OELNKIAB-h-)
- **Volume 3 — Release 6 Overview**: [Overview of New Features](https://youtu.be/YO6hWevwSWc?si=SilQ6xgnQYReGgd0)
- **Volume 4 — Inquiry View**: [Inquiry View Volume 4](https://youtu.be/xfX0rP4-Hv4?si=gSTRnPwbM0wsnlEZ)
- **Volume 5 — Author Progress Report (APR)**: [Author Progress Report (APR) Volume 5](https://youtu.be/euJ2qOUZgco?si=hjx3aegx7bka7Z61)
- **Volume 6 — Gossamer Mode**: [Gossamer Mode Volume 6](https://youtu.be/DOUVYXFwigM?si=vBuzvxPteXVjVFmM)

## Installation

**From Obsidian**

- Open settings → community plugins.
- Click browse and search for "radial timeline".
- Click install and then enable.

**Manual installation**

- Download the latest main.js, styles.css, and manifest.json from the [releases](https://github.com/EricRhysTaylor/radial-timeline/releases) page.
- Extract the files to your vault's .obsidian/plugins/radial-timeline (may be hidden by file system).

## Desktop & Platform Support

Radial Timeline is a **desktop-only** Obsidian plugin.

- Supported target: Obsidian Desktop
- Not intended for: Obsidian Mobile
- Some publishing and file-reveal workflows depend on desktop filesystem and native shell access

## Language Support

Radial Timeline ships complete English interface text and partial interface translations for Japanese, Simplified Chinese, Korean, and German. Missing translated strings fall back to English. Traditional Chinese variants fall back to English until a dedicated Traditional Chinese locale is available.

## Privacy & Security

- No telemetry or analytics SDKs are shipped with the plugin.
- API keys use Obsidian secret storage when available.
- AI is optional and can be disabled with the **AI Off** toggle.
- Vault content should only leave the vault when you explicitly use enabled external features.
- Shell commands are run only to invoke Pandoc (and its LaTeX engine) when you export a manuscript, and to probe for those binaries with `which`/`where` during setup.
- Files outside the vault are read or written only to save exports where you choose and to locate the Pandoc executable.
- The only environment variable read directly is `PATH`, used to locate Pandoc. Subprocesses receive a minimal allowlisted environment (PATH, home, temp, and locale/TeX variables) — never the full set, so credentials in your session can't leak to child processes.

See [Privacy & Security](docs/privacy-and-security.md) for the detailed posture.

## External Services & Network Access

Radial Timeline may contact external services only in specific optional workflows:

- AI provider requests when you actively use enabled AI features
- Optional provider/model/pricing metadata refreshes governed by AI privacy settings
- Optional version/update checks

Upcoming **Social Connections** for the website launch is planned as an explicit integration surface and should remain opt-in, documented, and separately controllable.

## Known Conflicts

**Plugin conflicts**: If you experience visual glitches or strange behavior (such as the timeline overlapping with other UI elements), it may be due to a conflict with another plugin. Try disabling other plugins to isolate the issue. Please see [known plugin conflicts](https://github.com/EricRhysTaylor/Radial-Timeline/issues?q=label%3A%22Plugin+Conflict%22).

## Technical Notes

The radial timeline is designed for high pixel density displays (around 200 ppi or higher) for optimal visual quality.

- All Apple Retina displays — 2x pixel density.
- Recommend Windows systems with 4k displays or higher. (Tested down to 1440p 2560x1440)
- Tablets.

If you're experiencing visual quality issues on Windows, please check your display scaling settings.

## Acknowledgments

- [**04 Font**](http://www.04.jp.org/) by Yuji Oshimoto — Japanese freeware font. © 1998–2003 Yuji Oshimoto.
- [d3.js](https://d3js.org) — data-driven SVG visualizations.
- [Hero Patterns](https://heropatterns.com) by Steve Schoger — SVG motifs used in the Working-status scene fill, under the [Creative Commons Attribution 4.0 International License](https://creativecommons.org/licenses/by/4.0/).
- [JetBrains Mono](https://www.jetbrains.com/lp/mono/) by JetBrains — used for the title-bar writing session counter.
- [Obsidian](https://obsidian.md) — for a thriving plugin ecosystem and thoughtful feature development.
- [Save the Cat! Writes a Novel](https://www.jessicabrody.com/books/non-fiction/save-cat-writes-novel/about/) (2018), Jessica Brody — a practical articulation of the Save the Cat beats.
- [The Story Grid](https://storygrid.com), Shawn Coyne — a rigorous methodology for analyzing scenes and beat flow.
- [W3C SVG specification](https://www.w3.org/Graphics/SVG/) — for making vector graphics on the web dependable.

**Bundled fonts (PDF export)**

- **Latin Modern Roman** — used for the Signature template.
- **Sorts Mill Goudy** by Barry Schwartz — used for the Professional template.
- **Source Serif 4** by Frank Grießhammer — used for the Standard template.
- **Arial** — used for the Basic template.

All bundled fonts ship with their original license files in `assets/fonts/`.

## Feedback and Support

Check out the [Discussions](https://github.com/EricRhysTaylor/Radial-Timeline/discussions) group. If you encounter issues or have feature requests, please file an issue on the [GitHub repository issues page](https://github.com/EricRhysTaylor/radial-timeline/issues).

## Author

Created by Eric Rhys Taylor

Reviewed and approved for the Obsidian Community Plugins directory. Developed with best practices in mind.

## License & Intellectual Property

Radial Timeline® © 2025 Eric Rhys Taylor
Released under the **Radial Timeline Source-Available Non-Commercial License**.

- You may install and use the software for personal, educational, or professional creative work.
- You may use the software to create commercial creative works such as books, scripts, outlines, and related authored content.
- Redistribution, public forks, hosted versions, and commercial exploitation of the software itself are prohibited without written permission.
- Radial Timeline is protected by U.S. Copyright Registration TX0009593938 and U.S. Trademark Registration No. 8,251,843.
- The Radial Timeline visualization system is the subject of U.S. Provisional Patent Application No. 63/951,412 and is marked Patent Pending.

See the [Legal page](https://github.com/EricRhysTaylor/Radial-Timeline/wiki/Legal) on the wiki for a plain-English permission table, the [License](https://github.com/EricRhysTaylor/radial-timeline/blob/main/LICENSE) text, and the [Notice](https://github.com/EricRhysTaylor/radial-timeline/blob/main/NOTICE) file.

## Disclaimer & Limitation of Liability

This software is provided "as is" without warranty of any kind, express or implied.
