Book Designer is the guided setup panel behind the **`Book designer`** command. It generates a manuscript scaffold tailored to your project: scene files, act distribution, subplot rotation, characters, and optional beat notes.

<a href="https://youtu.be/0vkLaI_LewM?si=-02Gem1HQwbI0E9E" target="_blank" rel="noopener">
  <p align="center">
    <img src="https://i.ytimg.com/vi/0vkLaI_LewM/maxresdefault.jpg" alt="Book Designer walkthrough" style="max-width: 80%; border-radius: 10px; box-shadow: 0 4px 8px rgba(0,0,0,0.1);" />
  </p>
  <p align="center" style="font-family: sans-serif; font-size: 16px; margin-top: 10px;">
    Book Designer walkthrough<br>
    Full video on YouTube
  </p>
</a>

## Open Book Designer

You can open Book Designer in two ways:
1.  **Command Palette**: Open the Command Palette (`Cmd + P` on Mac, `Ctrl + P` on Windows/Linux) and search for **`Radial timeline: Book designer`**.
2.  **Welcome Screen**: If your timeline is empty, click the **Book Designer** button on the welcome screen.

<div style="text-align: center; margin: 20px 0;">
  <img src="images/panel-book-designer.png" alt="Book Designer panel with preview donut chart" style="width: 550px; max-width: 100%; border-radius: 8px;" />
  <div style="font-size: 0.85em; margin-top: 8px; color: #666;">Book Designer — configure structure, subplots, and scene properties with live preview</div>
</div>

## Workflow

The panel is organized into three main sections:

### 1. Location & Structure
*   **Target location**: The folder path where your new book files will be created (e.g., `Book 1`). The folder will be created if it doesn't exist. Otherwise root of the vault will be used.
*   **Scenes to generate**: The total number of scene files to create.
*   **Target book length**: Used for numbering distribution. For example, if you generate 10 scenes with a target length of 60, scenes will be numbered 1, 8, 14 … 60, leaving gaps for future scenes.
*   **Acts to distribute scenes across**: Choose which acts (1..N) to populate, where **N** comes from your **Settings → Core → Acts → Act count**. Scenes are distributed evenly across the selected acts.

### 2. Content Configuration
*   **Subplots**: Enter your subplots, one per line. Scenes will be assigned to these subplots in a round-robin fashion. Each scene will belong to only one subplot.
*   **Characters**: Enter your main characters, one per line. These will be added to the YAML frontmatter of the generated scenes.

### 3. Scene Properties & Extras
*   **Scene properties**: Choose between **Core properties** (minimal) and **Advanced properties**. The advanced properties profile can be customized in settings.
*   **Generate Beats**: Optionally generate beat sheet files based on your selected beat system (e.g., Save the Cat, configured in Settings).

## Visual Preview
As you adjust the settings, the **Preview** donut chart updates in real time to show how scenes will be distributed across acts and subplots. This lets you inspect the structure before any files are generated. If you want a different shape afterward, reopen Book Designer and regenerate.

## Generate the Manuscript Scaffold
Once configured, click **Create Book**. The plugin will:
1.  Create the target folder.
2.  Generate individual markdown files for each scene, populated with the correct YAML frontmatter (scene number, act, subplot, characters, date).
3.  (Optional) Create beat sheet notes if selected.

You'll see a notification confirming the number of scenes and files created. Your Radial Timeline will immediately update to display your new story structure.

## Customizing Scene Properties

Book Designer supports two built-in scene property profiles:
1.  **Core properties**: A minimal profile with the essential fields required for Radial Timeline.
2.  **Advanced properties**: A richer profile with analysis, stats, and additional workflow fields.

### Adding Custom Properties
If your writing methodology uses fields beyond the built-in keys (for example Dramatica signposts or your own custom labels), you can add them to the advanced scene properties:
1.  Go to **Settings → Core → Scene properties**.
2.  Enable **Scene properties editor**.
3.  Add your custom keys to the list.
4.  In Book Designer, select **Advanced properties**.

> **Note**: Radial Timeline already tracks draft status (`Status` and `Publish Stage`), point of view (`POV`), and many other metadata fields in the built-in properties. Only add custom keys for data that your methodology requires beyond what the plugin already provides. See [Scene Properties](YAML-Frontmatter) for the full list of built-in fields.

## Custom Beat Systems

If you use a story structure not listed in the standard options:
1.  Go to **Settings → Core → Story beats system** and select **Custom**.
2.  Name your beat system and add beats in the **Custom story beat system editor**. Assign each beat to an act.
3.  In the Book Designer, enable **Generate Beats** to automatically generate beat notes for your custom system.

After generating beats, you can reorder or rename them in the editor. Row colors indicate sync status (green = aligned, orange = needs merge, red = duplicate). Use **Merge** to realign existing files after changes.

You can also create custom beat notes manually:
*   Create a new note for each major beat (e.g., "Pinch Point 1").
*   Add the following frontmatter (replace `Custom` with your system name):
    ```yaml
    Class: Beat
    Purpose: Why this beat exists in the structure.
    Beat Model: Your System Name
    ```
*   Radial Timeline will detect these notes and display them in Gossamer mode. The `Beat Model` value must match the system name in settings to be recognized.

> [!NOTE]
> Custom beat notes use the same properties structure as preset systems. Use the **Beat properties editor** in Settings → Core → Story beats system to add your own beat-specific fields and hover metadata. You can also save and switch between custom beat systems (saved sets).

## Advanced Metadata

Some writing methodologies rely on tracking complex properties rather than just linear beats. You can accommodate this using **Advanced properties**:

1.  Go to **Settings → Core → Scene properties**.
2.  Enable **Scene properties editor**.
3.  Add custom keys for your methodology.
4.  When you generate or edit scenes, these properties will be preserved, allowing you to use the plugin's timeline to visualize your story while maintaining your specific data structure in the notes.
