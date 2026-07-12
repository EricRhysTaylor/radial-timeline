import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { TimelineItem } from '../types';
import { parseWhenField } from '../utils/date';
import { createInMemoryApp, type InMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import { runPatternSync } from './patternSync';
import { runKeywordSweep } from './keywordSweep';
import { runRepairPipeline } from './RepairPipeline';
import { createSession, shiftSceneDays, editSceneWhen, setSceneTimeBucket } from './sessionDiff';
import { writeSessionChanges, clearProvenanceFields } from './frontmatterWriter';
import { readWhenHistory, appendWhenChanges, buildScaffoldStampMap } from './whenChangeLog';
import {
    buildTimelineSnapshot,
    buildSnapshotFromFiles,
    saveTimelineSnapshot,
    getLatestTimelineSnapshot,
    restoreTimelineSnapshot,
    TIMELINE_SNAPSHOT_FOLDER
} from './timelineSnapshot';
import { buildScaffoldPreview } from './scaffoldPreview';

function makeFile(path: string): TFile {
    return new (TFile as any)(path) as TFile;
}

function makeScene(
    path: string,
    overrides: Partial<TimelineItem> = {}
): TimelineItem {
    const basename = path.split('/').pop()?.replace(/\.md$/i, '') ?? path;
    return {
        title: basename,
        date: '',
        path,
        ...overrides
    };
}

function toIsoLocal(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
}

function makePluginWithBodies(bodyByPath: Record<string, string>): RadialTimelinePlugin {
    return {
        app: {
            vault: {
                cachedRead: async (file: TFile) => bodyByPath[file.path] ?? '',
                // No change log in this stub vault — stamp map reads as empty.
                getAbstractFileByPath: () => null
            }
        }
    } as unknown as RadialTimelinePlugin;
}

async function readFile(app: InMemoryApp, path: string): Promise<string> {
    const file = app.vault.getAbstractFileByPath(path);
    if (!(file instanceof TFile)) throw new Error(`Missing file: ${path}`);
    return app.vault.read(file);
}

describe('timeline repair normalizer', () => {
    it('scaffolds workable sequential When values for all-missing scenes across the built-in patterns', () => {
        const baseInputs = [
            { scene: makeScene('Book/01.md'), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md'), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md'), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md'), file: makeFile('Book/05.md'), manuscriptIndex: 4 }
        ];

        const anchor = new Date(2026, 0, 10, 8, 0, 0, 0);

        expect(runPatternSync(baseInputs.slice(0, 3), {
            anchorWhen: anchor,
            patternPreset: 'daily'
        }).map(entry => toIsoLocal(entry.proposedWhen))).toEqual([
            '2026-01-10 08:00',
            '2026-01-11 08:00',
            '2026-01-12 08:00'
        ]);

        expect(runPatternSync(baseInputs.slice(0, 4), {
            anchorWhen: anchor,
            patternPreset: 'beats2'
        }).map(entry => toIsoLocal(entry.proposedWhen))).toEqual([
            '2026-01-10 08:00',
            '2026-01-10 19:00',
            '2026-01-11 08:00',
            '2026-01-11 19:00'
        ]);

        expect(runPatternSync(baseInputs, {
            anchorWhen: anchor,
            patternPreset: 'beats4'
        }).map(entry => toIsoLocal(entry.proposedWhen))).toEqual([
            '2026-01-10 08:00',
            '2026-01-10 13:00',
            '2026-01-10 19:00',
            '2026-01-10 23:00',
            '2026-01-11 08:00'
        ]);

        expect(runPatternSync(baseInputs.slice(0, 3), {
            anchorWhen: anchor,
            patternPreset: 'weekly'
        }).map(entry => toIsoLocal(entry.proposedWhen))).toEqual([
            '2026-01-10 08:00',
            '2026-01-17 08:00',
            '2026-01-24 08:00'
        ]);
    });

    it('handles mixed valid and invalid When values without pretending the invalid ones were valid', () => {
        const entries = runPatternSync([
            {
                scene: makeScene('Book/01.md', { when: new Date(2026, 0, 10, 8, 0, 0, 0) }),
                file: makeFile('Book/01.md'),
                manuscriptIndex: 0
            },
            {
                scene: makeScene('Book/02.md', { when: new Date(2026, 0, 12, 8, 0, 0, 0) }),
                file: makeFile('Book/02.md'),
                manuscriptIndex: 1
            },
            {
                scene: makeScene('Book/03.md', { when: 'tomorrow-ish' as unknown as Date }),
                file: makeFile('Book/03.md'),
                manuscriptIndex: 2
            }
        ], {
            anchorWhen: new Date(2026, 0, 10, 8, 0, 0, 0),
            patternPreset: 'daily'
        });

        expect(entries[0].isChanged).toBe(false);
        expect(entries[1].originalWhen?.getTime()).toBe(new Date(2026, 0, 12, 8, 0, 0, 0).getTime());
        expect(entries[1].isChanged).toBe(true);
        expect(entries[2].originalWhen).toBeNull();
        expect(entries[2].originalWhenRaw).toBe('tomorrow-ish');
        expect(entries[2].isChanged).toBe(true);
    });

    it('Ripple in Preserve mode shifts only scaffolded rows; authored anchors and flashbacks stay put', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md'), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md', { when: new Date(2085, 3, 10, 8, 0, 0, 0) }), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md', { when: new Date(1933, 9, 4, 12, 0, 0, 0) }), file: makeFile('Book/05.md'), manuscriptIndex: 4 },
            { scene: makeScene('Book/06.md'), file: makeFile('Book/06.md'), manuscriptIndex: 5 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        // Sanity check the scaffold:
        expect(entries[0].source).toBe('authored');
        expect(entries[1].source).toBe('pattern');
        expect(entries[2].source).toBe('pattern');
        expect(entries[3].source).toBe('authored');
        expect(entries[4].source).toBe('authored');
        expect(entries[4].isFlashback).toBe(true);
        expect(entries[5].source).toBe('pattern');

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: 0,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 3,
            patternApplied: entries.length,
            cueRefined: 0
        });
        session.rippleEnabled = true;

        const before = entries.map(e => e.proposedWhen.getTime());
        const shifted = shiftSceneDays(session, 1, 5); // shift scene 02 forward 5 days

        // Scene 1 (the edit target) shifted +5d.
        expect(shifted.entries[1].editedWhen?.getTime()).toBe(before[1] + 5 * 86400_000);

        // Scene 2 (pattern, after edit) shifted +5d via ripple.
        expect(shifted.entries[2].editedWhen?.getTime()).toBe(before[2] + 5 * 86400_000);

        // Scene 3 (AUTHORED anchor) is NOT shifted.
        expect(shifted.entries[3].editedWhen).toBeNull();
        expect(shifted.entries[3].proposedWhen.getTime()).toBe(before[3]);
        expect(shifted.entries[3].source).toBe('authored');

        // Scene 4 (FLASHBACK / authored) is NOT shifted.
        expect(shifted.entries[4].editedWhen).toBeNull();
        expect(shifted.entries[4].proposedWhen.getTime()).toBe(before[4]);
        expect(shifted.entries[4].source).toBe('authored');

        // Scene 5 (pattern) IS shifted — ripple continues past anchors.
        expect(shifted.entries[5].editedWhen?.getTime()).toBe(before[5] + 5 * 86400_000);
    });

    it('Ripple in Overwrite mode shifts every row including originally-authored ones', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md'), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { when: new Date(2085, 3, 5, 8, 0, 0, 0) }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: false // OVERWRITE
        });

        // In Overwrite mode the pipeline never marks anything as authored.
        expect(entries.every(e => e.source === 'pattern')).toBe(true);

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: 0,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 0,
            patternApplied: entries.length,
            cueRefined: 0
        });
        session.rippleEnabled = true;

        const before = entries.map(e => e.proposedWhen.getTime());
        const shifted = shiftSceneDays(session, 0, 3);

        expect(shifted.entries[0].editedWhen?.getTime()).toBe(before[0] + 3 * 86400_000);
        expect(shifted.entries[1].editedWhen?.getTime()).toBe(before[1] + 3 * 86400_000); // shifted
        expect(shifted.entries[2].editedWhen?.getTime()).toBe(before[2] + 3 * 86400_000); // shifted
    });

    it('Ripple shifts downstream scenes by whole calendar days, preserving their own time of day', () => {
        // Daily scaffold: scenes at day 1..4, all 08:00.
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md'), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md'), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md'), file: makeFile('Book/04.md'), manuscriptIndex: 3 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: entries.length,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 0,
            patternApplied: entries.length,
            cueRefined: 0
        });
        session.rippleEnabled = true;

        // Move scene 2 from Apr 2 08:00 back to Apr 1 20:00 (evening of the
        // previous day). The raw delta is -12h, but the calendar-day delta is
        // -1 — downstream scenes must back up exactly one day and KEEP their
        // own 08:00, not smear to 20:00 of the previous day.
        const shifted = editSceneWhen(session, 1, new Date(2085, 3, 1, 20, 0, 0, 0));

        expect(shifted.entries[2].editedWhen?.getTime()).toBe(new Date(2085, 3, 2, 8, 0, 0, 0).getTime());
        expect(shifted.entries[3].editedWhen?.getTime()).toBe(new Date(2085, 3, 3, 8, 0, 0, 0).getTime());
    });

    it('Ripple ignores same-day time changes — rearranging one day never moves the rest of the book', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md'), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md'), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: entries.length,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 0,
            patternApplied: entries.length,
            cueRefined: 0
        });
        session.rippleEnabled = true;

        // Scene 2 moves from morning to night of the SAME day.
        const shifted = setSceneTimeBucket(session, 1, 21);

        expect(shifted.entries[1].editedWhen?.getHours()).toBe(21);
        expect(shifted.entries[2].editedWhen).toBeNull(); // untouched
    });

    it('Ripple override shifts authored anchors but flashbacks stay pinned', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md'), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { when: new Date(2085, 3, 10, 8, 0, 0, 0) }), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md', { when: new Date(1933, 9, 4, 12, 0, 0, 0) }), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md'), file: makeFile('Book/05.md'), manuscriptIndex: 4 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });
        expect(entries[3].isFlashback).toBe(true);

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: 0,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 3,
            patternApplied: entries.length,
            cueRefined: 0
        });
        session.rippleEnabled = true;
        session.rippleIncludeAnchored = true;

        const before = entries.map(e => e.proposedWhen.getTime());
        const shifted = shiftSceneDays(session, 1, 5);

        // Authored anchor (scene 03) shifts under the override.
        expect(shifted.entries[2].editedWhen?.getTime()).toBe(before[2] + 5 * 86400_000);
        // Flashback stays pinned even under the override.
        expect(shifted.entries[3].editedWhen).toBeNull();
        expect(shifted.entries[3].proposedWhen.getTime()).toBe(before[3]);
        // Pattern scene after the flashback still shifts.
        expect(shifted.entries[4].editedWhen?.getTime()).toBe(before[4] + 5 * 86400_000);
    });

    it('Scaffold-stamped dates (from the change log) ripple in preserve mode without the override', async () => {
        // Simulates the reopen-after-apply round trip: the dates exist in
        // frontmatter (no plugin metadata there), and the change log records
        // that scene 03's current When was machine-written. Scene 04 was also
        // logged, but its current When no longer matches the logged write —
        // a hand-edit returns ownership to the author.
        const app = createInMemoryApp({});
        await appendWhenChanges(app as never, [
            { v: 1, ts: '2085-04-01T00:00:00Z', path: 'Book/03.md', title: '03', prev: null, next: '2085-04-03 08:00', source: 'pattern', tool: 'scaffold' },
            { v: 1, ts: '2085-04-01T00:00:01Z', path: 'Book/04.md', title: '04', prev: null, next: '2085-04-09 08:00', source: 'pattern', tool: 'scaffold' }
        ]);
        const scaffoldStamps = await buildScaffoldStampMap(app as never);

        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { when: new Date(2085, 3, 2, 8, 0, 0, 0) }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { when: new Date(2085, 3, 3, 8, 0, 0, 0) }), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md', { when: new Date(2085, 3, 4, 8, 0, 0, 0) }), file: makeFile('Book/04.md'), manuscriptIndex: 3 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true,
            scaffoldStamps
        });

        expect(entries[2].source).toBe('authored');
        expect(entries[2].stampedWhenSource).toBe('pattern');
        // Logged value differs from the current date — stamp does not hold.
        expect(entries[3].stampedWhenSource).toBeUndefined();

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: 0,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 4,
            patternApplied: 0,
            cueRefined: 0
        });
        session.rippleEnabled = true;

        const before = entries.map(e => e.proposedWhen.getTime());
        const shifted = shiftSceneDays(session, 1, 2);

        // Stamped scene ripples; the untouched author-typed date holds.
        expect(shifted.entries[2].editedWhen?.getTime()).toBe(before[2] + 2 * 86400_000);
        expect(shifted.entries[3].editedWhen).toBeNull();
    });

    it('flashback rows carry a human-readable elapsed-time label', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { when: new Date(2085, 3, 2, 8, 0, 0, 0) }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { when: new Date(1933, 9, 4, 12, 0, 0, 0) }), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md', { when: new Date(2085, 3, 3, 8, 0, 0, 0) }), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md', { when: new Date(2085, 3, 4, 8, 0, 0, 0) }), file: makeFile('Book/05.md'), manuscriptIndex: 4 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        expect(entries[2].isFlashback).toBe(true);
        expect(entries[2].flashbackLabel).toMatch(/^\d+ years? earlier$/);
    });

    it('detects flashback scenes by year-distance from neighbors and suppresses backward-time alerts', () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { when: new Date(2085, 3, 2, 8, 0, 0, 0) }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { when: new Date(1933, 9, 4, 12, 0, 0, 0) }), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md', { when: new Date(2085, 3, 3, 8, 0, 0, 0) }), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md', { when: new Date(2085, 3, 4, 8, 0, 0, 0) }), file: makeFile('Book/05.md'), manuscriptIndex: 4 }
        ], {
            anchorWhen: new Date(2085, 3, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        expect(entries[2].isFlashback).toBe(true);
        expect(entries[0].isFlashback).toBe(false);
        expect(entries[1].isFlashback).toBe(false);
        expect(entries[3].isFlashback).toBe(false);
        expect(entries[4].isFlashback).toBe(false);

        // Flashback row must NOT carry a backward-time alert (the time jump is intentional).
        expect(entries[2].hasBackwardTime).toBe(false);
        expect(entries[3].hasBackwardTime).toBe(false); // neighbor of flashback also suppressed
    });

    it('preserves authored When dates as anchors and only fills the gaps around them', async () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md'), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { when: new Date(2026, 0, 12, 8, 0, 0, 0) }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md'), file: makeFile('Book/03.md'), manuscriptIndex: 2 },
            { scene: makeScene('Book/04.md'), file: makeFile('Book/04.md'), manuscriptIndex: 3 },
            { scene: makeScene('Book/05.md', { when: new Date(2026, 0, 20, 8, 0, 0, 0) }), file: makeFile('Book/05.md'), manuscriptIndex: 4 }
        ], {
            anchorWhen: new Date(2099, 0, 1, 8, 0, 0, 0), // deliberately far away — should be ignored
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        expect(entries.map(e => e.source)).toEqual(['pattern', 'authored', 'pattern', 'pattern', 'authored']);
        expect(toIsoLocal(entries[0].proposedWhen)).toBe('2026-01-11 08:00'); // 1 day before anchor 02
        expect(toIsoLocal(entries[1].proposedWhen)).toBe('2026-01-12 08:00'); // authored
        expect(toIsoLocal(entries[2].proposedWhen)).toBe('2026-01-13 08:00'); // pattern from 02
        expect(toIsoLocal(entries[3].proposedWhen)).toBe('2026-01-14 08:00'); // pattern from 02
        expect(toIsoLocal(entries[4].proposedWhen)).toBe('2026-01-20 08:00'); // authored
        expect(entries[1].isChanged).toBe(false);
        expect(entries[4].isChanged).toBe(false);
    });

    it('text cues do not rewrite authored anchors', async () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { when: new Date(2026, 0, 1, 8, 0, 0, 0), synopsis: 'They regroup the next morning.' }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { synopsis: 'Three days later, they return.' }), file: makeFile('Book/02.md'), manuscriptIndex: 1 }
        ], {
            anchorWhen: new Date(2026, 0, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: true
        });

        const refined = await runKeywordSweep(entries, async () => '', { includeSynopsis: true });
        expect(refined[0].source).toBe('authored');
        expect(toIsoLocal(refined[0].proposedWhen)).toBe('2026-01-01 08:00');
        expect(refined[1].source).toBe('keyword');
    });

    it('refines the scaffold from explicit text cues like "next morning" and "three days later"', async () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { synopsis: 'Arrival.' }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { synopsis: 'They regroup the next morning.' }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { synopsis: 'Three days later, they return.' }), file: makeFile('Book/03.md'), manuscriptIndex: 2 }
        ], {
            anchorWhen: new Date(2026, 0, 10, 19, 0, 0, 0),
            patternPreset: 'daily'
        });

        const refined = await runKeywordSweep(entries, async () => '', { includeSynopsis: true });

        expect(refined.map(entry => entry.source)).toEqual(['pattern', 'keyword', 'keyword']);
        expect(toIsoLocal(refined[1].proposedWhen)).toBe('2026-01-11 08:00');
        expect(toIsoLocal(refined[2].proposedWhen)).toBe('2026-01-14 08:00');
    });

    it('scaffolds the whole book and only applies simple text cues when enabled', async () => {
        const scenes = [
            makeScene('Book/01.md', { actNumber: 1, subplot: 'A', synopsis: 'Opening scene.' }),
            makeScene('Book/02.md', { actNumber: 1, subplot: 'A', synopsis: 'This happens after dawn, though not stated directly.' }),
            makeScene('Book/03.md', { actNumber: 2, subplot: 'B', synopsis: 'Separate thread.' })
        ];
        const files = new Map(scenes.map(scene => [scene.path!, makeFile(scene.path!)]));
        const plugin = makePluginWithBodies({
            'Book/01.md': 'Body one',
            'Book/02.md': 'The next stretch clearly lands the following morning.',
            'Book/03.md': 'Body three'
        });

        const configBase = {
            anchorWhen: new Date(2026, 0, 10, 8, 0, 0, 0),
            anchorSceneIndex: 0,
            patternPreset: 'daily' as const,
            useTextCues: false,
            preserveAuthoredDates: false
        };

        const withoutCues = await runRepairPipeline(scenes, files, plugin, configBase);

        expect(withoutCues.entries).toHaveLength(3);
        expect(withoutCues.entries.map(entry => entry.source)).toEqual(['pattern', 'pattern', 'pattern']);
        expect(withoutCues.cueRefined).toBe(0);
        expect(toIsoLocal(withoutCues.entries[1].proposedWhen)).toBe('2026-01-11 08:00');
        expect(toIsoLocal(withoutCues.entries[2].proposedWhen)).toBe('2026-01-12 08:00');

        const withCues = await runRepairPipeline(scenes, files, plugin, {
            ...configBase,
            useTextCues: true
        });

        expect(withCues.entries).toHaveLength(3);
        expect(withCues.entries[1].source).toBe('keyword');
        expect(toIsoLocal(withCues.entries[1].proposedWhen)).toBe('2026-01-11 08:00');
        expect(withCues.cueRefined).toBe(1);
        expect(withCues.entries[2].source).toBe('pattern');
    });

    it('does not treat weak cues like "still" or "meanwhile" as temporal signals', async () => {
        const entries = runPatternSync([
            { scene: makeScene('Book/01.md', { synopsis: 'Arrival.' }), file: makeFile('Book/01.md'), manuscriptIndex: 0 },
            { scene: makeScene('Book/02.md', { synopsis: 'She was still there.' }), file: makeFile('Book/02.md'), manuscriptIndex: 1 },
            { scene: makeScene('Book/03.md', { synopsis: 'Meanwhile, elsewhere.' }), file: makeFile('Book/03.md'), manuscriptIndex: 2 }
        ], {
            anchorWhen: new Date(2026, 0, 10, 8, 0, 0, 0),
            patternPreset: 'daily'
        });

        const refined = await runKeywordSweep(entries, async () => '', { includeSynopsis: true });

        // Weak cues should NOT change source from pattern
        expect(refined.map(entry => entry.source)).toEqual(['pattern', 'pattern', 'pattern']);
        // No cue chips should be generated
        expect(refined[1].cues).toBeUndefined();
        expect(refined[2].cues).toBeUndefined();
    });

    it('builds compact preview labels for each pattern and reflects anchor changes', () => {
        const daily = buildScaffoldPreview('daily', new Date(2026, 11, 27, 0, 0, 0, 0), 82);
        expect(daily.startLabel).toBe('Start: Dec 27, 2026 · 12:00 AM');
        expect(daily.helperLabel).toBe('Scaffolds 82 scenes in narrative order.');
        expect(daily.steps.map(step => step.spacingLabel)).toEqual([
            'Day 1',
            'Day 2',
            'Day 3',
            'Day 4',
            'Day 5'
        ]);

        const twoBeatMorning = buildScaffoldPreview('beats2', new Date(2026, 0, 10, 8, 0, 0, 0), 5);
        expect(twoBeatMorning.steps.map(step => step.spacingLabel)).toEqual([
            'Morning',
            'Evening',
            'Morning',
            'Evening',
            'Morning'
        ]);

        const twoBeatEvening = buildScaffoldPreview('beats2', new Date(2026, 0, 10, 19, 0, 0, 0), 5);
        expect(twoBeatEvening.startLabel).toBe('Start: Jan 10, 2026 · 7:00 PM');
        expect(twoBeatEvening.steps.map(step => step.spacingLabel)).toEqual([
            'Evening',
            'Morning',
            'Evening',
            'Morning',
            'Evening'
        ]);

        const fourBeat = buildScaffoldPreview('beats4', new Date(2026, 0, 10, 13, 0, 0, 0), 5);
        expect(fourBeat.steps.map(step => step.spacingLabel)).toEqual([
            'Afternoon',
            'Evening',
            'Night',
            'Morning',
            'Afternoon'
        ]);

        const weekly = buildScaffoldPreview('weekly', new Date(2026, 0, 10, 8, 0, 0, 0), 4);
        expect(weekly.steps.map(step => step.spacingLabel)).toEqual([
            'Week 1',
            'Week 2',
            'Week 3',
            'Week 4'
        ]);
    });

    it('writes YAML only for changed scenes and leaves Chronologue materially more usable after apply', async () => {
        const app = createInMemoryApp({
            'Book/01 Scene.md': '---\nClass: Scene\n---\nScene one',
            'Book/02 Scene.md': '---\nClass: Scene\nWhen: 2026-01-02 08:00\n---\nScene two',
            'Book/03 Scene.md': '---\nClass: Scene\nWhen: ???\n---\nScene three'
        });

        const file1 = app.vault.getAbstractFileByPath('Book/01 Scene.md');
        const file2 = app.vault.getAbstractFileByPath('Book/02 Scene.md');
        const file3 = app.vault.getAbstractFileByPath('Book/03 Scene.md');

        if (!(file1 instanceof TFile) || !(file2 instanceof TFile) || !(file3 instanceof TFile)) {
            throw new Error('Expected TFiles');
        }

        const scenes = [
            makeScene('Book/01 Scene.md'),
            makeScene('Book/02 Scene.md', { when: new Date(2026, 0, 2, 8, 0, 0, 0) }),
            makeScene('Book/03 Scene.md', { when: '???' as unknown as Date })
        ];

        const entries = runPatternSync([
            { scene: scenes[0], file: file1, manuscriptIndex: 0 },
            { scene: scenes[1], file: file2, manuscriptIndex: 1 },
            { scene: scenes[2], file: file3, manuscriptIndex: 2 }
        ], {
            anchorWhen: new Date(2026, 0, 1, 8, 0, 0, 0),
            patternPreset: 'daily'
        });

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: entries.filter(entry => entry.isChanged).length,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 0,
            patternApplied: entries.length,
            cueRefined: 0
        });

        const result = await writeSessionChanges(app as never, session);

        expect(result.success).toBe(2);
        expect(result.failed).toBe(0);

        const scene1 = await readFile(app, 'Book/01 Scene.md');
        const scene2 = await readFile(app, 'Book/02 Scene.md');
        const scene3 = await readFile(app, 'Book/03 Scene.md');

        // Only the author-facing When is written — no plugin bookkeeping.
        expect(scene1).toContain('When: 2026-01-01 08:00');
        expect(scene1).not.toContain('WhenSource');
        expect(scene1).not.toContain('WhenConfidence');

        expect(scene2).toBe('---\nClass: Scene\nWhen: 2026-01-02 08:00\n---\nScene two');

        expect(scene3).toContain('When: 2026-01-03 08:00');
        expect(scene3).not.toContain('WhenSource');
        expect(scene3).not.toContain('WhenConfidence');

        const parsedWhens = [scene1, scene2, scene3]
            .map(content => content.match(/^---\n([\s\S]*?)\n---/m)?.[1] ?? '')
            .map(frontmatter => frontmatter.match(/^When:\s*(.+)$/m)?.[1] ?? null)
            .map(value => value ? parseWhenField(value) : null);

        expect(parsedWhens.every(value => value instanceof Date && !isNaN(value.getTime()))).toBe(true);
        expect(parsedWhens.map(value => value?.getTime())).toEqual([
            new Date(2026, 0, 1, 8, 0, 0, 0).getTime(),
            new Date(2026, 0, 2, 8, 0, 0, 0).getTime(),
            new Date(2026, 0, 3, 8, 0, 0, 0).getTime()
        ]);
    });

    it('Snapshot saves changed scenes only and restores their previous When', async () => {
        const app = createInMemoryApp({
            'Book/01 Scene.md': '---\nClass: Scene\nWhen: 2085-04-01 08:00\n---\nScene one',
            'Book/02 Scene.md': '---\nClass: Scene\n---\nScene two (no When)'
        });

        const file1 = app.vault.getAbstractFileByPath('Book/01 Scene.md');
        const file2 = app.vault.getAbstractFileByPath('Book/02 Scene.md');
        if (!(file1 instanceof TFile) || !(file2 instanceof TFile)) throw new Error('Expected TFiles');

        const scenes = [
            makeScene('Book/01 Scene.md', { when: new Date(2085, 3, 1, 8, 0, 0, 0) }),
            makeScene('Book/02 Scene.md')
        ];

        const entries = runPatternSync([
            { scene: scenes[0], file: file1, manuscriptIndex: 0 },
            { scene: scenes[1], file: file2, manuscriptIndex: 1 }
        ], {
            // Different anchor than scene 1's authored date, so scene 1 changes too.
            anchorWhen: new Date(2026, 0, 1, 8, 0, 0, 0),
            patternPreset: 'daily',
            preserveAuthoredDates: false
        });

        // Capture original raw value for snapshot (would normally come from YAML parser).
        entries[0].originalWhenRaw = '2085-04-01 08:00';
        // Both entries should be changed (proposed vs original differ).
        expect(entries[0].isChanged).toBe(true);
        expect(entries[1].isChanged).toBe(true);

        const session = createSession({
            entries,
            totalScenes: entries.length,
            scenesChanged: entries.filter(e => e.isChanged).length,
            scenesNeedingReview: 0,
            scenesWithBackwardTime: 0,
            scenesWithLargeGaps: 0,
            scenesAuthored: 0,
            patternApplied: entries.length,
            cueRefined: 0
        });

        // Build + save snapshot BEFORE write.
        const snapshot = buildTimelineSnapshot(session, {
            patternPreset: 'daily',
            preserveAuthoredDates: false,
            useTextCues: true
        });
        expect(snapshot.entries.length).toBeGreaterThan(0);
        expect(snapshot.entries[0].path).toBe('Book/01 Scene.md');
        expect(snapshot.entries[0].previousWhenRaw).toBe('2085-04-01 08:00');

        const snapshotFile = await saveTimelineSnapshot(app as never, snapshot);
        expect(snapshotFile.path.startsWith(`${TIMELINE_SNAPSHOT_FOLDER}/`)).toBe(true);

        // Now write the changes (mass overwrite).
        const writeResult = await writeSessionChanges(app as never, session);
        expect(writeResult.success).toBeGreaterThan(0);

        const afterApply = await readFile(app, 'Book/01 Scene.md');
        // Apply rewrote the When to the new (anchor) date.
        expect(afterApply).toContain('When: 2026-01-01 08:00');
        expect(afterApply).not.toContain('When: 2085-04-01 08:00');

        // Restore the snapshot.
        const meta = await getLatestTimelineSnapshot(app as never);
        expect(meta).not.toBeNull();
        const result = await restoreTimelineSnapshot(app as never, meta!);
        expect(result.failed).toBe(0);
        expect(result.restored).toBeGreaterThan(0);

        const afterRestore = await readFile(app, 'Book/01 Scene.md');
        expect(afterRestore).toContain('When: 2085-04-01 08:00');
        // Apply writes no provenance, and restore leaves none behind.
        expect(afterRestore).not.toContain('WhenSource');

        // The change log recorded the apply (not the snapshot restore, which
        // bypasses the writer chokepoint by design) and reads back per-scene.
        const history = await readWhenHistory(app as never, 'Book/01 Scene.md');
        expect(history.length).toBe(1);
        expect(history[0].prev).toBe('2085-04-01 08:00');
        expect(history[0].next).toBe('2026-01-01 08:00');
        expect(history[0].tool).toBe('scaffold');
    });

    it('Reset metadata round trip: snapshot captures provenance, clear wipes it, restore brings it back', async () => {
        const app = createInMemoryApp({
            'Book/01 Scene.md': '---\nWhen: 2085-04-01 08:00\nWhenSource: pattern\nWhenConfidence: high\nNeedsReview: true\nClass: Scene\n---\nBody text.'
        });
        const file = app.vault.getAbstractFileByPath('Book/01 Scene.md');
        if (!(file instanceof TFile)) throw new Error('Expected TFile');

        // Snapshot BEFORE the reset captures dates AND metadata.
        const snapshot = await buildSnapshotFromFiles(app as never, [file], 'scaffold');
        expect(snapshot.entries[0].previousWhenRaw).toBe('2085-04-01 08:00');
        expect(snapshot.entries[0].previousWhenSource).toBe('pattern');
        expect(snapshot.entries[0].previousNeedsReview).toBe('true');
        await saveTimelineSnapshot(app as never, snapshot);

        // Reset: provenance gone, date untouched.
        expect(await clearProvenanceFields(app as never, file)).toBe(true);
        const afterClear = await readFile(app, 'Book/01 Scene.md');
        expect(afterClear).not.toContain('WhenSource');
        expect(afterClear).not.toContain('NeedsReview');
        expect(afterClear).toContain('When: 2085-04-01 08:00');
        expect(afterClear).toContain('Class: Scene');

        // Even the reset is undoable.
        const meta = await getLatestTimelineSnapshot(app as never);
        expect(meta).not.toBeNull();
        const result = await restoreTimelineSnapshot(app as never, meta!);
        expect(result.failed).toBe(0);

        const afterRestore = await readFile(app, 'Book/01 Scene.md');
        expect(afterRestore).toContain('When: 2085-04-01 08:00');
        expect(afterRestore).toContain('WhenSource: pattern');
        expect(afterRestore).toContain('WhenConfidence: high');
        expect(afterRestore).toContain('NeedsReview: true');
        expect(afterRestore).toContain('Body text.');
    });
});
