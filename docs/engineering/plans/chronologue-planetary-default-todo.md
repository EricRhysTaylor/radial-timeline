# Chronologue Planetary Default

## Status

Implemented as a Chronologue setting with `Earth`, `Planetary`, and `Remember last`.

## Problem

Chronologue currently requires the alternate calendar/planetary overlay to be manually armed each time. For writers using an alien or custom planetary calendar as their primary story calendar, this makes Earth time feel like the default even after a planetary profile is configured.

## Options

1. Global default setting
   - Add a Chronologue setting: `Default calendar view: Earth / Planetary / Remember last`.
   - Pros: simple mental model, easy to document.
   - Cons: less flexible for multi-book vaults with different calendar needs.

2. Per-book default setting
   - Store the preferred Chronologue calendar view with book scope.
   - Pros: best fit for different worlds or series in one vault.
   - Cons: more UI and migration work.

3. Auto-arm when a planetary profile is active
   - Enter Chronologue with the planetary/alien calendar overlay active whenever `enablePlanetaryTime` and an active valid profile are present.
   - Pros: matches the user expectation that the world calendar is primary.
   - Cons: could surprise users who only use planetary time as an occasional comparison layer.

4. Remember last Chronologue sub-mode
   - Persist the last Earth/planetary/runtime sub-mode and restore it on next Chronologue entry.
   - Pros: minimal configuration, preserves user behavior.
   - Cons: less explicit and harder to explain in docs.

## Implemented Plan

Implement a setting with three choices: `Earth`, `Planetary`, and `Remember last`. Default it to `Earth` for backward compatibility. When set to `Planetary`, Chronologue auto-arms the planetary sub-mode only if the active planetary profile validates; otherwise it falls back to Earth.

## Implementation Notes

- Added the setting under Chronologue.
- Kept keyboard state separate from logical sub-mode. Auto-arming does not pretend Alt is physically pressed.
- Updated `ChronologueShiftController` to initialize the planetary sub-mode from settings.
- Included the default and remembered calendar view in change detection so the view refreshes when the setting changes.
- Documented the model as: Earth date remains the anchor; Planetary default changes what Chronologue displays first.

## Acceptance Criteria

- With default `Earth`, current behavior is unchanged.
- With default `Planetary` and a valid active profile, opening Chronologue immediately shows planetary labels and hover metadata.
- With `Remember last`, switching sub-modes in Chronologue persists and restores across view reloads.
- Invalid or missing planetary profiles fall back gracefully to Earth time.
- Docs explain how to make a world calendar the default Chronologue display.
