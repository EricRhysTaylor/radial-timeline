The Inquiry tab controls how Inquiry scans your vault, manages prompts, tunes corpus thresholds, and writes action notes.

<p align="center"><img src="images/settings-inquiry.png" alt="Settings → Inquiry tab" width="600"></p>
<p align="center"><sub>Settings → Inquiry</sub></p>

For the operating guide to the Inquiry View itself, see [Inquiry](Inquiry).

<a name="prompts"></a>
## Inquiry Prompts

*   **Built-in questions**: Each zone (Setup, Pressure, Payoff) ships with 4 core questions; Pro adds 5 more per zone, for 9 built-in questions per zone.
*   **Custom questions**: Add your own prompts per zone on top of the built-ins. The Core surface allows 3 custom questions per zone; Pro raises the limit to 8.
*   **Order and defaults**: Drag to reorder questions within a zone, toggle individual questions on or off, and use the restore button to return to the built-in defaults.

> [!NOTE]
> The behavior of these prompts in the live view is documented in [Inquiry](Inquiry#prompts).

<a name="sources"></a>
## Inquiry Sources

*   **Books for Inquiry**: Choose which book profiles Inquiry scans. Use **Open Book Manager** to edit the profiles themselves.
*   **Material rules**: Class table controlling which YAML classes are scanned and whether each applies to the **Book**, **Saga**, and/or **Reference** scope.
*   **Supporting material folders**: Add support-material vault paths beyond the book folders. Supports wildcards (e.g., `/Book 1-7 */`) and `/` for vault root.
*   **Presets**: **Default** (recommended), **Light** (fast, lower token usage), and **Deep** (comprehensive, higher token usage) apply preconfigured source selections.

### How Inquiry Identifies Books

Inquiry uses the book profiles you configure in **Settings -> Core -> Books**.

Each book profile contributes one book folder to Inquiry. In **Book** scope, Inquiry uses the active book profile. In **Saga** scope, it can scan across the included book profiles together.

**Supporting material folders** are separate. They add reference material alongside your book profiles.

<a name="corpus"></a>
## Corpus (CC)

*   **Thresholds**: Tune the word-count tiers (`Empty`, `Sketchy`, `Medium`, `Substantive`) used in Corpus cards. Counts are content-only (frontmatter excluded). A reset control restores the defaults.

Corpus automatically marks notes in the `Empty` and `Sketchy` tiers.

> [!NOTE]
> See [Corpus & Material Modes](Inquiry#corpus-material-modes) for how Inquiry uses these settings in actual runs.

## Configuration

*   **Auto-populate Pending Edits**: Automatically write Inquiry action notes to the `Pending Edits` YAML field on hit scenes after each run. The target field is fixed to `Pending Edits`.
