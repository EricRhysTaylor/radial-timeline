## Radial Timeline 7.1.1

A maintenance release: a simpler writing-session start panel, fixes to built-in story structures, safer recovery messaging, and copy aligned with the current Pro and Community framing.

### Writing session panel, simplified

The start panel now asks one question before you write: **what is this session aiming at?** Target leads the form, **Begin Session** is a proper button instead of a bare play arrow, and Session mode and stage sit below as the set-and-forget settings they are. The **Countdown sprint** toggle is now sticky — count-up writers set it once instead of unchecking it every session.

<p align="center"><img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/b68b5b61/wiki/images/panel-session-start.png" alt="Simplified writing session start panel — Target leads, Begin Session button, mode and stage below" width="360"></p>

### Fixes

- Corrected the recovery-folder relocation alert — its previous wording could be read as an instruction to delete your data.
- Built-in beat presets now carry real act boundaries; Classic Dramatic Structure aligns to its acts correctly.
- Fixed a subplot ring ordering bug that could scramble the ring stack.
- The Hero's Journey beat system now credits Christopher Vogler, whose twelve-stage structure it follows.
- Local LLM requests can now be cancelled cleanly mid-generation.
- Timeline data (JSON) exports now save to `Radial Timeline/Community/` inside the canonical plugin folder, replacing the older top-level `Radial Timeline Exports` folder.

### Copy & Community

- Pro is now advanced workflows.
- The Community tab leads with "Share your journey," and Community sharing enforces one campaign per book.
