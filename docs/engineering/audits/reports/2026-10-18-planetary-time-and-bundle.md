# Planetary time and Unicode bundle cleanup — October 18, 2026

## Trigger and scope

The completed `92e330ac` preview confirms 46 CSS compatibility locations remain,
with settings search the only source warning and dependencies passing. Keep the
existing license, all nine languages, fonts and export capabilities. Avoid a
settings migration or rewriting intentional link/prose styles before release.

## Changes

1. Emit JavaScript as UTF-8 instead of expanding non-ASCII strings into Unicode
   escapes. The bundle falls from 12,082,730 to 10,534,590 bytes (12.8%). The
   isolated charset comparison has identical parsed program structure, names
   and decoded string values across 1,289,280 syntax nodes. Nothing is removed
   or dynamically unpacked. This remains above 5 MB; the Sync Standard size
   warning is unresolved.
2. Render planetary hour/minute fields directly into the Setting control
   element. Remove the redundant wrapper and its `display: contents`
   requirement. Preserve the existing spacing explicitly. The native local-time
   row and Convert-button area has zero differing pixels before/after.
3. Fix consecutive hour/minute changes using stale values captured when the
   controls were created. Native reproduction: controls show 01:01, but the
   result uses 00:01. Each callback now preserves the other component of the
   current canonical time. Both edit orders and hours above 23 have regression
   coverage, including generated YAML.

## Verification

- New behavioral tests reproduce both old failures: 24:05 becomes 00:05, and
  01:45 becomes 01:00. They pass after the fix, alongside conversion tests.
- Translation coverage and the i18n release gate pass for all nine languages.
- Native QA runs only in Output QA Vault, with the candidate installed and
  reloaded. Author Vault files and installed plugin are untouched.
- Native post-fix acceptance: hour 01 then minute 01 produces Earth 17:01,
  preserving the hour. Changing that hour to 24 preserves minute 01 and
  produces Earth 1970-01-01 16:01 for the QA profile. Native AX and screenshots
  record the original incorrect result and both corrected results.
- The full 14-gate run passes, including the production build and unit tests.
- Scanner acceptance of the removed compatibility location requires the next
  official preview. No public release or rating change is claimed.

Private evidence: Command Center / Agent Runs /
2026-10-18 Obsidian scanner previews / next-batch.
