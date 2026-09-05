## Radial Timeline 6.1.0

This release adds workflow enhancements and improved UI, with session tracking, daily goals, clearer timeline controls, and contextual scene insertion from the timeline.

### New Features

1. Added Goals & Sessions for tracking writing momentum.
   - Settings → Core dashboard for drafting pace, daily targets, weekly goal days, and local writing stats.
   - Title-bar numeric counter for quick session visibility.
   - Timeline popover for starting, pausing, and saving sessions.
   - Multi-mode count ring beside the center progress ring with animated ring feedback while a tracking session is active.
2. Added right-click Add Scene in Progress, Narrative, and Chronologue modes, using the selected scene as the anchor for placement, act, `When`, YAML mode, and subplot context.
3. Restyled the Radial Timeline mode buttons with a smaller, cleaner control treatment and updated the timeline legend.

### Visual Highlights

**Goals & Sessions**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/settings-writing-goal.png" alt="Settings Core Goals and Sessions panel" width="600">

**Timeline session controls**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/panel-session-start.png" alt="Timeline writing session and count popover" width="600">

**Right-click Add Scene**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/ui-rt-rightclick-menu.png" alt="Radial Timeline right-click menu" width="272">

**Add Scene confirmation**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/panel-rightclick-add-scene.png" alt="Add Scene confirmation panel" width="600">

**Radial Timeline mode buttons**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/view-rt-mode-buttons.png" alt="Radial Timeline mode buttons" width="358">

**Radial Timeline legend**

<img src="https://raw.githubusercontent.com/EricRhysTaylor/Radial-Timeline/master/wiki/images/ui-rt-legend.png" alt="Radial Timeline legend" width="600">

### Improvements

- Improved AI model handling with request profiles for provider-specific capabilities, including models that manage sampling or reasoning settings differently.
- Added ChatGPT 5.5 to the supported OpenAI models.

### Bug Fixes

- Fixed timeline count and mode-control styling regressions.
