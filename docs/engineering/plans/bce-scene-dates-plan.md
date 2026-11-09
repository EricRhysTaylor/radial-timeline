# BCE Scene Dates

Status: built 2026-11-09. Tests: `src/utils/bceDates.test.ts` and the BCE block in
`src/timelineAudit/AuditPipeline.test.ts`. Author docs: `wiki/Chronologue-Mode.md`.

## The problem

A scene's `When` only counted years forward, so a book set in antiquity had to
use made-up positive years. The Odyssey Story Vault anchors Troy's fall at
"1184" and the homecoming at "1192", and its notes explain that these are
editorial coordinates because "Radial Timeline counts years forward and has no
BCE". Chronologue's start and end labels then read `1192 NOV 16` and
`1184 JUN 14`. Readers take those as BCE years, and the order looks backward.

Writing "BCE" after the current years would be false: they count up
(1184 → 1192), and BCE years count down.

## The author's form

An era goes at the end of the When, after any time:

```yaml
When: 1184-06-14 BCE
When: 1184-06-14 20:00 BCE
When: June 14, 1184 BCE
When: 1184 BCE
When: 44 BCE
```

- **Accepted eras**, in any case: `BCE`, `BC`, `B.C.E.`, `B.C.` for years
  before the common era; `CE`, `C.E.`, `AD`, `A.D.` for the common era. A CE
  marker changes nothing: `2024-03-15 CE` reads exactly like `2024-03-15`.
- **Every existing form takes an era**: `YYYY-MM-DD`, with `HH:MM`, `HH:MM:SS`,
  `T`, or `h:mm am/pm`; `M/D/YYYY`; `YYYY-MM`; `YYYY`; `June 1184`;
  `June 14, 1184`; `14 June 1184`.
- **Year digits.** Year-first numeric forms (`1184-06-14`, `1184-06`) keep
  their four-digit year, as ISO does, so 44 BCE is `0044-03-15 BCE` there.
  Where the year stands alone or comes last, a shorter year is fine as long as
  an era is written: `44 BCE`, `March 15, 44 BCE`, `3/15/44 BC`. Without an
  era, every form still asks for four digits, so no existing value starts
  parsing differently.
- **No year 0.** `0 BCE`, `0000-01-01 BCE` and `0000-01-01` are invalid, and
  the Date Audit reports them like any unreadable When. The year before 1 CE is
  1 BCE.
- **The canonical written form** is what Radial Timeline writes when it sets a
  When (Chronologue placement, Timeline Repair, the Date Audit):
  `1184-06-14 20:00 BCE`, or `1184-06-14 BCE` for a date-only When. A CE When
  is written exactly as before: `2024-03-05 14:30`, with no era.

`1184 BCE-06-14` (the era inside the date) was considered and rejected: it
splits the date, and no other form could follow the same pattern.

## How it is stored and computed

`parseWhenField` stays the single parser. It turns an era-marked year into an
astronomical year (1 BCE = 0, 1184 BCE = −1183) and builds the local `Date`
with `setFullYear`, because `new Date(year, …)` reads years 0–99 as 1900–1999.
Years from 100 on take the same `new Date(year, …)` path as before, so every
existing CE date has the same timestamp.

Everything downstream already compares `getTime()`, so sorting, Chronologue
placement, elapsed time, duration arcs, gap detection and overlap checks work
across eras with no change. Dec 31, 1 BCE to Jan 1, 1 CE is one day. The
calendar is the proleptic Gregorian one that JavaScript uses for every date
(the same as for an 1811 date today), so weekday names on ancient dates are
proleptic too.

## How labels read

- **A BCE year names its era**: `1184 BCE`. Chronologue's start label reads
  `1184 BCE` over `JUN 14`; the hover reads `Wed Jun 14, 1184 BCE`; the scene
  time bar, the Timetable's When cells and header (`· 1184 BCE`) and the Date
  Audit do the same.
- **A CE year names its era only when the book's dates cross eras.** Chronologue
  labels and Timetable cells then read `1 BCE` … `2 CE`. A book entirely in CE
  shows its years exactly as before, with no era. Hover, the time bar and other
  single-scene views show a CE year bare: in a mixed book, the BCE scenes carry
  the marker, so a bare year is unambiguous.
- **English** reads `BCE` and `CE` (`ui.date.eraBce`, `ui.date.eraCe` in
  `en.ts`). Intl's own English era names are BC and AD, so Radial Timeline
  replaces them. **Other languages** use the era names Intl already has for them:
  `v. Chr.`, `av. J.-C.`, `a. C.`, `紀元前`. These need no translation pass.
- One helper, `formatStoryDate` in `src/utils/date.ts`, does this for every
  Intl-formatted story date. `formatStoryYear` is its year-only form.
  `formatSceneWhen` and `formatTableWhen` use it. A CE date, or a format with
  no year, goes through Intl unchanged.

## What changes for existing books

Nothing for a CE When of four digits. Three edge cases that were already wrong
now read correctly:

- A four-digit year below 100 (`0050-06-01`) used to read as 1950. It now reads
  as 50 CE.
- `0000-…` used to read as 1900. It is now invalid.
- A CE year below 1000 was written back as `800-01-01 12:00`, which the parser
  could not read. It is now written as `0800-01-01 12:00`.

## Where the date is read, written and shown

Single sources:

| Site | What it does now |
|---|---|
| `src/utils/date.ts` `parseWhenField` | Reads the era, rejects year 0, builds the date with `setFullYear` below year 100. |
| `src/utils/date.ts` `formatWhenForYaml`, `formatWhenDate` | Writes `… BCE` for a BCE When; four-digit years. |
| `src/utils/date.ts` `formatStoryDate`, `formatStoryYear`, `datesSpanEras`, `eraYearOf`, `splitWhenEra` | The era helpers every caller uses. |
| `src/utils/date.ts` `generateChronologicalTicks` | Chronologue start, end and rim labels. CE named when the book crosses eras. |
| `src/utils/whenFormat.ts` | Hover and Timetable formats; `whenTextNamesDay` reads past the era. |

Callers changed:

| Site | Change |
|---|---|
| `src/utils/sceneTimeLabel.ts` | The next-day end date reads `(1184-06-15 BCE)`, not a `-1183-…` key. |
| `src/timelineRepair/frontmatterWriter.ts`, `src/services/SceneInsertService.ts`, `src/timeline/sharedSceneNotes.ts` | Every When written back goes through `formatWhenForYaml` / `formatWhenDate`. Two hand-built copies were removed. |
| `src/timelineRepair/patternSync.ts`, `src/modals/TimelineScaffoldModal.ts` | The repair review shows `formatWhenForYaml`. Its duplicate, `formatWhenForDisplay`, is deleted. |
| `src/timelineAudit/AuditPipeline.ts`, `src/timelineRepair/keywordSweep.ts` | A date found in scene text keeps its era (`PROSE_YEAR_SOURCE`, `PROSE_ERA_SOURCE`, `proseDateWhen`). Without this, a scene whose text says "June 14, 1184 BCE" would get a confident suggestion to move it to 1184 CE. Text with no era matches exactly as before. |
| `src/timelineAudit/AuditPipeline.ts` (AI prompt) | Only a book with a BCE When gets one added sentence asking the model to write BCE. Every other book's prompt is unchanged. A suggested `… BCE` date-only value stays date-only. |
| `src/modals/TimelineAuditModal.ts` | Proposed and differing dates show in the author's form. |
| `src/ai/prompts/onboarding.ts` | Import instructions ask for `1184-06-14 BCE` when a date falls before the common era. |
| `src/timetable/TimetableView.ts` | The When header's year (`· 1184 BCE`) and CE marking in a mixed table. |
| `src/timetable/coloringDates.ts` | Color-by-date groups: BCE keys carry the signed year (`year:-1183`), sort in time, and label with the era. A leap day is checked against its own year. CE category IDs are unchanged, so saved colors keep their keys. |
| `src/services/export/timelineExportFormat.ts` | The JSON export and Community share payload write 1184 BCE as `-001183-06-14`, the signed ISO form `new Date()` reads. |
| `src/utils/manuscript.ts`, `src/sceneTime/SceneTimeModal.ts`, `src/timelineRepair/scaffoldPreview.ts` | Outline/CSV export dates, the Scene Time "clock after" line and the repair anchor label name the era on BCE dates; CE output is the same call as before. |
| `src/chronologue/timeReferences/model.ts` | A Time Reference date takes a trailing era; year 0 is rejected. |
| `src/chronologue/placement/generateCandidates.ts`, `src/timelineRepair/sessionDiff.ts` | Rebuilt dates no longer pass through `new Date(year, …)` / `Date.UTC(year, …)`, which read years 0–99 as 19xx. |

Callers that needed no change, because they compare timestamps or format through
the helpers above: Chronologue placement and validation, undated followers,
duration and elapsed arcs, discontinuity and overlap detection, the scene hover
and synopsis, search (it indexes the hover date, so "1184 BCE" finds a scene),
`SceneDataService`'s internal `date` key (ISO `-001183-06-14`), and the
planetary calendar's Earth round trip (a negative ISO year parses back).

## Not built

- A per-book era setting. The era is written on each When, which keeps scene
  YAML readable on its own and needs no plugin state.
- Era-aware date pickers. The Timeline Repair anchor and the planetary
  calendar's Earth date use `<input type="date">`, which cannot hold a BCE year.
  For a BCE book, the anchor shows blank and keeps the book's own default date.
- Planetary calendars before their epoch. `planetaryTime.ts` can count a local
  year of 0 or below, and its Earth tick label (`hasYear`) recognizes only years
  1000–2999. That calendar has its own year model; it is separate work.
- Book Designer and its demo project start from today's date, so they never
  write a BCE When.
- The Community site reading `-001183-…` in a shared timeline. The plugin
  writes the standard form; the website's parser is in another repository.

## Re-dating the Odyssey (suggestion only)

The Story Vault is not changed by this work. If its editors want real
signed years, the vault's forward-counting offsets map onto BCE years by
reversing the count from the same anchor: Troy falls in 1184 BCE, and the
homecoming lands eight years of story later, in 1176 BCE.

| Now | Re-dated |
|---|---|
| `1184-06-14` (Troy falls, wanderings begin) | `1184-06-14 BCE` |
| `1185-10-21` (end of the wanderings told in Books 9–12) | `1183-10-21 BCE` |
| `1192-10-07` (the gods and Telemachus) | `1176-10-07 BCE` |
| `1192-11-16` (the household settled) | `1176-11-16 BCE` |

Rule: a year *Y* in the vault becomes (2368 − *Y*) BCE, so the 1184 anchor
stays fixed and each later year counts down. Month and day stay as written.
Elapsed time between scenes stays the same, give or take a leap day (both
spans hold two Feb 29s). The README and `Chronology.md` would
then drop the "no BCE" note. Whether 1184 BCE is the right anchor is an
editorial call for the vault's editors.
