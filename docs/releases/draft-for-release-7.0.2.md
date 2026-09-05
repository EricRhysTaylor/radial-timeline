## Radial Timeline 7.0.2

A quick fix release for two bugs reported on GitHub — thank you both for the clear, reproducible reports.

### Fixes

- **Narrative Mode act placement** — scenes whose `Act` exceeded the book's act count wrapped around into the wrong act quadrant. Thanks to **@billie-anderson** ([#31](https://github.com/EricRhysTaylor/Radial-Timeline/issues/31)).
- **Bundled font install for Publish** — "Install bundled fonts" reported success without actually writing the fonts to the folder, and already-installed fonts moved there by hand weren't recognized. Thanks to **@therisingtithes** ([#29](https://github.com/EricRhysTaylor/Radial-Timeline/issues/29)).
