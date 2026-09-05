# Writing Workflow Feedback Response

## Removed From Current Scope

Per-scene word allocation is intentionally out of scope for now. Session words remain session-level totals, and touched scenes remain attribution/context selected with toggles in the save modal.

## Response Draft

Thanks for laying this out so clearly. A lot of what you described makes sense, and it helped identify places where the plugin was asking writers to think like the tool instead of the other way around.

For writing sessions, I agree that word targets are often more useful than time targets. The session tool now supports time, words, or words + time. In word mode, the live ring uses a typed-word meter rather than elapsed time. That meter only adds words as you type; paste, cuts, deletes, and rewrites do not subtract from it. When you save the session, the modal shows both the typed-word count and a separate snapshot-style manuscript delta, which can be negative if you cut more than you added.

The touched-scenes list still works like before: the save modal suggests scenes that were active, open, working, or modified, and you can toggle which scenes are associated with the session. Words are not split across scenes right now. They are saved as a session total, because automatic per-scene allocation gets unreliable quickly when editing, cutting, moving text, or working across multiple notes.

For Chronologue and planetary calendars, I agree that writers using a world calendar should not have to manually arm the alternate calendar every time. Chronologue now has a default calendar view setting: Earth, Planetary, or Remember last. Planetary mode still uses Earth dates as the anchor internally, but displays the active valid planetary profile first.

For Publish, the plugin can install bundled PDF templates and bundled font files into the vault-local Pandoc folder. It does not install external applications like Pandoc or LaTeX onto the computer. The Publish UI now makes that clearer, and bundled-font buttons perform the vault-local install directly instead of looking like a no-op.

The remaining documentation gap is the planetary calendar calculator workflow: it still explains Earth-anchored conversion more than world-calendar-first authoring. That should be addressed next by documenting the anchor model clearly and adding a follow-on design for world-date input if we want true alien-calendar-to-Earth conversion.

## Documentation Notes

- Time target: counts elapsed writing-session time.
- Word target: counts typed words only, additively.
- Words + time: word count drives the live ring; elapsed time remains visible.
- Save modal:
  - `Typed during session` is the additive keyboard count.
  - `Net manuscript change` is the start/end snapshot delta for open scene notes.
  - `Words to save` is editable and defaults to typed words when available.
- Touched scenes are selected with toggles and saved as session context, not word allocation.
- Publish install buttons install bundled templates/fonts into the vault, not Pandoc/LaTeX system apps.
