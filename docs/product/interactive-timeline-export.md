# Interactive Timeline export — what the JSON file contains

Wiki-source copy for the "Export timeline data (JSON)" command. The in-app
consent dialog states only the essentials; this page carries the full
explanation. When the public wiki page is written, it should be drawn from
here (contract: `Platform/COMMUNITY-SHARE-AMENDMENT-1-INTERACTIVE-TIMELINE.md`,
§1 Export).

## What the export is

The exported JSON file is the source for your Interactive Timeline share.
Exporting shares nothing: the file is written to `Radial Timeline/Community/`
in your vault and stays there until you upload it to your Community share on
the website and activate the share.

## Always included (structural fields)

These fields describe the shape of your book and are visible as soon as an
activated share is public: scene numbers, acts, subplot names, status,
publish stage, item type, scene and act counts, book title, and author
attribution.

## Held for later reveal (revealing fields)

Scene titles, synopses, character names, POV, and story dates are included
in the file but treated as revealing: they stay hidden on your public
timeline until you reveal each scene individually from your My Share page.
Uploading the file does not reveal anything by itself.

## Generic ring names

If your subplot names could themselves reveal plot, enable **Generic ring
names** at export time. Subplot rings are then exported as "Subplot 1,
Subplot 2…". Scene titles are not affected by this toggle — they are a
revealing field, hidden until you choose to reveal each scene.

## Privacy boundary

Nothing leaves your vault until you upload the file yourself. The plugin
never uploads automatically, and the share can be paused or disconnected
from the plugin at any time (take-offline, delete, and export live on the
website's My Share page).
