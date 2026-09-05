# Sample Vaults — Engineering Spec

This document is the contract between the Radial Timeline plugin and the
sample vaults we publish (Pride & Prejudice, Sherlock Holmes, future
additions). Read this before touching any code path that reads `Sample
Vault Config.md`, writes the import marker, or gates Demo Mode.

## Goals

A recipient who unzips a sample vault should be one Community Plugins
install away from a working, fully-explorable demo — including with no
API key configured. The shipped zip contains **public-domain content
only**: no `.obsidian/`, no plugin binary, no plugin internal state. The
plugin materializes its runtime configuration from a single declarative
manifest the vault carries.

## Architectural principles

1. **Vault ships content only.** Sample vault zips contain no `.obsidian/`,
   no plugin binary, no `data.json`. The recipient installs the plugin
   from Community Plugins; the plugin then reads the vault's declarative
   manifest and writes its own `data.json` using its current schema.
   This sidesteps `data.json` schema drift entirely.

2. **Single declarative manifest.** Each sample vault contains one
   `Sample Vault Config.md` at `Radial Timeline/Demo/Sample Vault Config.md`
   (or anywhere in the vault — discovered by frontmatter scan, see below).
   This is the only file that travels with the vault carrying machine-
   readable configuration.

3. **First-run import is idempotent.** The plugin records a marker file
   when it successfully imports a sample. Subsequent loads detect the
   marker and skip re-import unless schema has bumped. User edits to
   plugin settings are never silently overwritten.

4. **Demo Mode is derived state.** When no usable API key is configured
   for the currently-selected model provider, the plugin enters Demo
   Mode automatically. Adding a key leaves Demo Mode automatically.
   It is never a persisted setting.

5. **Refresh, don't migrate.** When schema versions diverge, the plugin
   tells the recipient where to download a fresh zip. We do not maintain
   a plugin-side migration layer for sample-vault config — that's a
   buggy maintenance burden disproportionate to the value.

## Sample Vault Config.md — schema v1

The shipped file is a markdown note with YAML frontmatter. The body is
human-readable explanation; the frontmatter is the machine contract.

### Frontmatter fields (v1)

| Field | Type | Required | Notes |
|---|---|---|---|
| `rt_sample_vault` | bool | ✅ | Must be `true`. Identifies this as a Sample Vault Config (the plugin uses this for discovery). |
| `sample_id` | string | ✅ | Stable identifier (e.g. `pride-and-prejudice`). Used for marker filenames and compatibility logic. Path-independent. |
| `display_name` | string | ✅ | Human-facing name (e.g. `"Pride & Prejudice Sample Vault"`). Used in banners, status indicators, marketing copy. |
| `schema_version` | int | ✅ | Compatibility contract. Bumped only when the schema itself changes incompatibly. |
| `plugin_version_tested` | string | optional | Informational only — e.g. `"1.2.3"`. Tells humans which plugin version this vault was last regenerated against. Never used for runtime decisions. |
| `book_folder` | string | ✅ | Vault-relative path to the book folder (e.g. `"Pride & Prejudice"`). |
| `extra_corpus` | list[string] | optional | Additional folders to include in Inquiry's corpus (e.g. `[Characters]`). |
| `question_set` | string | optional | Identifier of the Inquiry question set to activate by default. |
| `act_labels` | list[string] | optional | The act label tuple to apply (e.g. `["Act 1", "Act 2", "Act 3"]`). Overrides any seasonal-default heuristic on first import. |

### Example

```yaml
---
rt_sample_vault: true
sample_id: pride-and-prejudice
display_name: "Pride & Prejudice Sample Vault"
schema_version: 1
plugin_version_tested: "1.2.3"
book_folder: "Pride & Prejudice"
extra_corpus:
  - Characters
question_set: p_and_p_zones
act_labels: ["Act 1", "Act 2", "Act 3"]
---
```

### Discovery

The plugin discovers `Sample Vault Config.md` by **scanning the vault for
any `.md` file whose frontmatter has `rt_sample_vault: true`**. This lets
recipients move/rename the file without breaking discovery. If multiple
files match, the plugin uses the one with the lexically smallest path and
logs a console warning naming the duplicates.

## First-run import state machine

When the plugin loads a vault, it runs this decision once per vault session:

| Marker state | Existing RT config in `data.json` | Action |
|---|---|---|
| Marker present, `sample_id` matches, `schema_version` matches | any | **No action.** Plugin proceeds normally. |
| Marker present, `schema_version` differs from vault's `Sample Vault Config.md` | any | Show one-shot **schema-drift banner** (see copy below). Do not modify config. |
| Marker missing, no book registered | n/a | **Run import.** Apply all declared fields. Write marker. |
| Marker missing, book registered, config **matches** what import would write | matches | Treat as already-imported. Write marker. No UI. |
| Marker missing, book registered, config **differs** from what import would write | differs | Show **one-shot "Restore demo defaults?" banner** (see below), defaulting to "Keep my settings". Do not modify config unless user opts in. |

### "Config matches" comparison

Compare only the fields declared in `Sample Vault Config.md`:
`book_folder`, `extra_corpus`, `question_set`, `act_labels`. Other plugin
state (model preferences, schedules, theme, hotkeys) is never inspected.

### Marker file

Path: `.radial-timeline/imports/<sample_id>.md` (hidden — `.radial-timeline/`
is the canonical disposable runtime state directory).

Format — markdown with frontmatter, for consistency with the rest of our
manifest layer:

```yaml
---
sample_id: pride-and-prejudice
schema_version: 1
imported_at: 2026-06-05T16:42:00Z
plugin_version: 1.2.3
---

# Sample Vault Import Marker

Records that the Pride & Prejudice sample vault was imported and
configured. Do not edit. Deleting this file will cause the plugin to
re-detect import state on next load.
```

Deleting `.radial-timeline/` is supported and intended — it forces a
clean re-detection. The state-machine row "marker missing, config matches"
handles this case gracefully (no surprise overwrite).

## Banner copy

### Schema-drift banner

> *"This sample vault was tested with Radial Timeline ≤[plugin_version_tested].
> Configuration may behave differently with the current plugin. A fresh
> copy of the sample is available at [radialtimeline.com/samples](https://www.radialtimeline.com/samples)
> — your current vault and any edits you've made will not be touched."*

Actions: `[Open download page]` `[Dismiss]`. Show once per session, suppress
on subsequent loads of the same schema-mismatch state.

### Restore-defaults banner

> *"This appears to be a [display_name], but your Radial Timeline settings
> differ from the sample defaults. Would you like to restore the demo
> configuration?"*

Actions: `[Keep my settings]` (default, prominent) and `[Restore demo defaults]`.

## Demo Mode

### Activation rule

Demo Mode is ON when:
- The currently-selected model provider has no API key configured, AND
- That state was not produced by the user explicitly setting an empty key
  (i.e. it's "key was never set" not "key was deleted").

Demo Mode is OFF the moment a usable key is configured for the active
provider. Switching providers re-evaluates. Demo Mode is never a stored
setting.

### Behavior in Demo Mode

| Surface | Behavior |
|---|---|
| Status bar (bottom-left) | Shows: `Demo Mode · read-only · add API key to run new analyses` |
| Read-only AI surfaces (frontmatter Pulse Triplet / Gossamer scores, `Radial Timeline/Recover/` snapshots, past Inquiry sessions) | Fully accessible. No changes. |
| "Run new Inquiry" button | Disabled. Tooltip: *"Add an API key in Settings → Models to run new analyses."* |
| "Run Gossamer pass" button | Same — disabled, same tooltip. |
| "Regenerate Pulse Triplet for this scene" | Same. |
| Any other generative AI action | Same. |
| Inquiry view shutdown / "red mode" | **Never trigger in Demo Mode.** The recipient should never see a panicked error state when they have no key — this is the explicit replacement for that UX. |

### Demo Mode vs. broken keys

Distinguish "no API key at all" (→ Demo Mode) from "wrong or expired API
key" (→ error toast on the failing request). Don't lump both under Demo
Mode or recipients with broken keys will think their key isn't being read.

## Maintenance — who keeps this current

### Plugin code changes that bump schema_version

Bump `schema_version` in this doc, in the `Sample Vault Config.md`
generator inside `package_sample_vault.py`, and in the plugin's reader,
when any of the following happen:

- Required field renamed or removed
- Field type changed incompatibly
- Field semantics changed (e.g. `extra_corpus` switches from path list to
  glob pattern list)

Forward-compatible additions (new optional fields) do **not** require a
schema bump.

### Published-samples table

When a new sample vault ships or an existing one is regenerated, update
this table. Source of truth is the `Sample Vault Config.md` inside the
shipped zip.

| sample_id | display_name | schema_version | last regenerated against plugin version |
|---|---|---|---|
| `pride-and-prejudice` | Pride & Prejudice Sample Vault | 1 | _(TODO: fill at first release)_ |

### Regeneration steps (for the publishing checklist)

1. Pull latest from the canonical source vault repo.
2. Update plugin to the target version locally and run the AI passes you
   want preserved (Pulse Triplet, Gossamer, Inquiry).
3. Run `vault_qa.py` against the canonical vault. Refuse to proceed if
   blockers remain.
4. Run `package_sample_vault.py` with the current `plugin_version_tested`
   value. The packager re-runs the QA gate and emits `dist/<display_name>/`.
5. Manually spot-check the dist — open it as an Obsidian vault on a
   clean profile, confirm Demo Mode renders correctly without an API key,
   confirm Inquiry sessions rehydrate from `Radial Timeline/Recover/`.
6. Zip the dist folder. Upload. Update the published-samples table above.
7. Tag the plugin release notes: "Sample vaults compatible with this
   release: pride-and-prejudice@v1, sherlock-holmes@vN, …"

## Open questions for the plugin team

1. **Where in the codebase does the discovery + first-run import live?**
   Probably a startup hook in the plugin's main load path, executed after
   the vault index is ready but before any view renders.

2. **Should the schema-drift banner offer a "download fresh copy" button
   that opens the browser**, or just give the URL as copyable text?
   Recommend the button — one fewer step for the recipient.

3. **`question_set` slug format.** Currently `Sample Vault Config.md` uses
   string slugs (e.g. `p_and_p_zones`). The plugin needs a matching
   registry of question sets keyed by these slugs. If you choose a
   different identifier scheme (UUIDs, paths), the packager script needs
   to know what shape to emit.

4. **Sample vault listing on radialtimeline.com.** The schema-drift banner
   links to `radialtimeline.com/samples`. That page needs to exist
   before shipping the schema-drift banner, or the link 404s.
