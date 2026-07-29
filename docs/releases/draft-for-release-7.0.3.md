## Radial Timeline 7.0.3

Manuscript export was broken for anyone who installed from the Community Plugins browser. This fixes it.

### Fixes

- **PDF and Word export** — the bundled fonts and the Word reference document now ship inside the plugin, so export works on a fresh install with nothing to set up. Thanks to **@therisingtithes** ([#34](https://github.com/EricRhysTaylor/Radial-Timeline/issues/34)).
- **Font status** — Publish and Export now report what XeLaTeX can actually load, so a font no longer reads as missing when it's there, or as ready when it isn't. A failed export names the font that caused it.
