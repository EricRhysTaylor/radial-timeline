# Obsidian Manuscript Timeline

A manuscript timeline for creative fiction writing projects that displays scenes organized by act, subplot, and chronological order in a radial format for a comprehensive view of project.

## Features

- Creates an interactive radial timeline visualization of your scenes
- Organizes scenes by act, subplot, and chronological order
- Shows scene details on hover including title, date, synopsis, subplots, and characters
- Color-codes scenes by status (Complete, Working, Todo, etc.)
- Supports both light and dark themes
- Allows clicking on scenes to open the corresponding file

## Support Development

If you find this plugin useful, consider supporting its continued development:

<a href="https://www.buymeacoffee.com/ericrhystaylor" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-blue.png" alt="Buy Me A Coffee" style="height: 60px !important;width: 217px !important;" ></a>

## Display Requirements

This plugin creates an information-dense visualization that is more legible on high-resolution displays:
- Recommended: High-resolution displays such as Apple Retina displays or Windows equivalent (4K or better)
- The timeline contains detailed text and visual elements that benefit from higher pixel density
- While usable on standard displays, you may need to zoom in to see all details clearly

## How to Use

1. Install the plugin in your Obsidian vault
2. Configure the source path in the plugin settings to point to your scenes folder
3. Ensure your scene files have the required frontmatter metadata (see below)
4. Run the "Create Manuscript Timeline" command using the Command Palette (Cmd/Ctrl+P) to generate the visualization
5. The timeline will be created in the "Outline" folder as an HTML file
6. Open the HTML file in Obsidian using the HTML Reader plugin to view and interact with your timeline
7. To update the timeline after making changes to your scene files, run the "Create Manuscript Timeline" command again

## Required Scene Metadata

Scene files must have the following frontmatter:
- Class: Scene - Identifies the file as a scene
- When - Date of the scene (required)
- Title - Scene title
- Subplot - Subplot(s) the scene belongs to
- Act - Act number (1-3)
- Status - Scene status (Complete, Working, Todo, etc.)
- Synopsis - Brief description of the scene
- Character - Characters in the scene
- Due - Optional due date for the scene
- Edits - Optional editing notes (scenes with Edits will display with purple number boxes)
- Publish Stage - Publishing stage (Zero, Author, House, Press)

### Example Metadata (use "Paste and Match Style" when copying to avoid formatting issues)

```yaml
---
Class: Scene
Synopsis: The protagonist discovers a mysterious artifact.
Subplot:
  - The Great War
  - Jinnis Pickle
Act: 1
When: 2023-05-15
Character:
  - John Mars
  - Celon Tim
Place:
  - Diego
  - Earth
Publish Stage: Zero
Status: Complete
Edits:
---
```

## Timeline Visualization Elements

The timeline displays:
- Scenes arranged in a circular pattern
- Acts divided into sections
- Subplots organized in concentric rings
- Scene numbers in small boxes
- Color-coded scenes based on status
- Month markers around the perimeter
- Progress ring showing year progress

Hover over a scene to see its details and click to open the corresponding file.

<a href="https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png" target="_blank" rel="noopener" style="display: inline-block; cursor: pointer;">
  <img src="https://raw.githubusercontent.com/ericrhystaylor/obsidian-manuscript-timeline/master/screenshot.png" alt="Example Timeline Screenshot" style="max-width: 100%; border-radius: 8px; border: 1px solid #444;" />
</a>
<div style="text-align: center; font-size: 0.8em; margin-top: 5px; color: #888;">
  Click image to view full size in browser
</div>

## Scene Ordering and Numbering

- Scenes are ordered chronologically based on the When date in the frontmatter metadata
- The plugin parses scene numbers from the Title prefix (e.g., "1.2" in "1.2 The Discovery")
- These numbers are displayed in small boxes on the timeline
- Using numbered prefixes in your scene titles helps Obsidian order scenes correctly in the file explorer
- If scenes have the same When date, they are sub-ordered by their scene number

## Technical Implementation

The Manuscript Timeline visualization was inspired by and draws on principles from [D3.js](https://d3js.org), a powerful JavaScript library for producing dynamic, interactive data visualizations. While the plugin doesn't directly use the D3 library to reduce dependencies, it implements several D3-style approaches:

- SVG-based visualization techniques
- Data-driven document manipulation
- Interactive elements with hover and click behaviors
- Radial layouts and polar coordinates
- Scale transformations and data mapping
- Dynamic color manipulation and pattern generation

The visualizations are built using pure SVG and JavaScript, offering a lightweight solution that maintains the elegance and interactivity of D3-style visualizations while being fully compatible with Obsidian's rendering capabilities.

## Installation

- Download the latest release
- Extract the files to your vault's `.obsidian/plugins/manuscript-timeline` folder
- Enable the plugin in Obsidian's Community Plugins settings

## Required Plugins

This plugin creates HTML files that can be viewed in Obsidian. For the best experience, you should have:

- **Core Plugins**: Make sure the "Outgoing Links" core plugin is enabled
- **Community Plugins**: The [HTML Reader](https://github.com/nuthrash/obsidian-html-plugin) plugin is recommended for viewing the generated timeline HTML files
  - **IMPORTANT**: HTML Reader must be set to **Unrestricted** mode in its settings for proper functionality of interactive elements and styling
  - Navigate to Settings → Community plugins → HTML Reader → Operating mode → Select "Unrestricted"
  - Without this setting, the timeline's CSS styles and internal link functionality will not work properly

No other plugins are required for basic functionality. The plugin uses Obsidian's native API to read frontmatter metadata from your Markdown files - Dataview is NOT required. The plugin then generates an interactive HTML timeline visualization based on this metadata.

## Development

Development of this plugin is private. The source code is provided for transparency and to allow users to verify its functionality, but it is not licensed for derivative works.

If you wish to contribute to the development of this plugin or report issues:
- [Open an issue on GitHub](https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/issues) to report bugs or suggest features
- Contact the author via GitHub for potential collaboration opportunities

Any modifications or derivative works require explicit permission from the author.

## License

© 2025 Eric Rhys Taylor. All Rights Reserved.

This Obsidian plugin is proprietary software.
- You may use this plugin for personal use only.
- You may not copy, modify, distribute, sublicense, or resell any part of this plugin.
- Commercial use of this software (e.g., as part of a paid product or service) is strictly prohibited without a separate license agreement.
- Attribution is required in any mention or reference to this plugin.

For licensing inquiries, please contact via GitHub.

## Author

Created by Eric Rhys Taylor

## Questions & Support

For questions, issues, or feature requests, please [open an issue on GitHub](https://github.com/EricRhysTaylor/Obsidian-Manuscript-Timeline/issues).