import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    buildRingLayout,
    buildTableRow,
    compareChronologicalRows,
    compareManuscriptRows,
    displayName,
    elapsedSincePrevious,
    groupProgress,
    planColoring,
    readRuntimeSeconds,
    readWhen,
    runningTotals,
    sceneNumberFill,
    withActDividers,
    withDayDividers,
} from './timetableModel';

const settings = { ...DEFAULT_SETTINGS, enableCustomMetadataMapping: false } as RadialTimelineSettings;
const row = (basename: string, fm?: Record<string, unknown>) => buildTableRow(`Book 2/${basename}.md`, basename, fm, settings);

describe('buildTableRow', () => {
    it('sorts notes into the kinds the table draws differently', () => {
        expect(row('67.4 Revenge', { Class: 'Scene', Act: 2 }).kind).toBe('scene');
        expect(row('2.01 SETUP', { Class: 'Beat', Act: 1 }).kind).toBe('beat');
        expect(row('School by Cascade', { class: 'sketch' }).kind).toBe('sketch');
        expect(row('78 Dry Tank', undefined).kind).toBe('unclassed');
        const backdrop = row('Wars', { Class: 'Backdrop' });
        expect(backdrop.kind).toBe('otherClass');
        expect(backdrop.className).toBe('Backdrop');
    });

    it('reads the number, act and rings the way the wheel does', () => {
        const scene = row('67.4 Revenge', { Class: 'Scene', Act: 2, Subplot: ['Entiat Chelan Arc', 'Main Plot'] });
        expect(scene.prefix).toBe('67.4');
        expect(scene.act).toBe(2);
        expect(scene.subplots).toEqual(['Entiat Chelan Arc', 'Main Plot']);
    });

    it('puts a scene with no Act or Subplot where the wheel puts it', () => {
        const scene = row('5 Arrival', { Class: 'Scene' });
        expect(scene.act).toBe(1);
        expect(scene.subplots).toEqual(['Main Plot']);
    });

    it('leaves a note the timeline can’t see without an act or rings it never had', () => {
        const stub = row('78 Dry Tank', undefined);
        expect(stub.act).toBeNull();
        expect(stub.subplots).toEqual([]);
        expect(row('Idea', { Class: 'Sketch', Subplot: 'Trisan Arc' }).subplots).toEqual(['Trisan Arc']);
    });
});

describe('compareManuscriptRows', () => {
    it('orders by act, then number, then name, with act-less notes last', () => {
        const rows = [
            row('10 Late', { Class: 'Scene', Act: 1 }),
            row('Unplaced', undefined),
            row('2 Second', { Class: 'Scene', Act: 2 }),
            row('9.5 Between', { Class: 'Sketch', Act: 1 }),
            row('1 First', { Class: 'Scene', Act: 2 }),
        ].sort(compareManuscriptRows);
        expect(rows.map(r => r.basename)).toEqual(['9.5 Between', '10 Late', '1 First', '2 Second', 'Unplaced']);
    });
});

describe('withActDividers', () => {
    it('adds a divider before each act when a group spans acts', () => {
        const lines = withActDividers([row('1 A', { Class: 'Scene', Act: 1 }), row('2 B', { Class: 'Scene', Act: 2 })]);
        expect(lines.map(line => line.type === 'act' ? `act ${line.act}` : line.row.basename)).toEqual(['act 1', '1 A', 'act 2', '2 B']);
    });

    it('adds none when the group is a single act', () => {
        const lines = withActDividers([row('1 A', { Class: 'Scene', Act: 2 }), row('2 B', { Class: 'Scene', Act: 2 })]);
        expect(lines.every(line => line.type === 'row')).toBe(true);
    });
});

describe('buildRingLayout', () => {
    it('keeps the wheel’s ring order and colors, then adds sketch-only rings', () => {
        const layout = buildRingLayout(
            ['Main Plot', 'Backdrop', 'Entiat Chelan Arc'],
            new Map([['Main Plot', 0], ['Entiat Chelan Arc', 1]]),
            [row('Idea', { Class: 'Sketch', Subplot: ['Zed Arc', 'Main Plot'] })]
        );
        expect(layout.order).toEqual(['Main Plot', 'Entiat Chelan Arc', 'Zed Arc']);
        expect(layout.colorIndex.get('Entiat Chelan Arc')).toBe(1);
        expect(layout.offWheel.has('Zed Arc')).toBe(true);
        expect(layout.offWheel.has('Main Plot')).toBe(false);
    });
});

describe('sceneNumberFill', () => {
    it('uses the wheel’s fill, pointed at the table’s pattern defs', () => {
        expect(sceneNumberFill({ Class: 'Scene', Status: 'Working', 'Publish Stage': 'Zero' }, settings, 'tt-')).toBe('url(#tt-plaidWorkingZero)');
        expect(sceneNumberFill({ Class: 'Scene', Status: ['Todo'] }, settings, 'tt-')).toBe('url(#tt-plaidTodoZero)');
        expect(sceneNumberFill({ Class: 'Scene', Status: 'Complete', 'Publish Stage': 'Press' }, settings, 'tt-')).toBe(settings.publishStageColors.Press);
    });
});

describe('displayName', () => {
    it('drops the number prefix the number cell already shows', () => {
        expect(displayName('1 Training at Academy Field')).toBe('Training at Academy Field');
        expect(displayName('5.01 DEBATE')).toBe('DEBATE');
        expect(displayName('Untitled sketch')).toBe('Untitled sketch');
        expect(displayName('2085 Notes')).toBe('Notes');
    });
});

describe('Chronologue helpers', () => {
    const dated = (basename: string, when: string | undefined, act = 1) => {
        const fm = { Class: 'Scene', Act: act, ...(when ? { When: when } : {}) };
        return { row: row(basename, fm), when: readWhen(fm, settings).when };
    };

    it('reads When the way the timeline does, and whether it names a time', () => {
        expect(readWhen({ When: '2085-04-01 19:40' }, settings).hasClock).toBe(true);
        expect(readWhen({ When: '2085-04-01' }, settings).hasClock).toBe(false);
        expect(readWhen({}, settings).when).toBeNull();
    });

    it('orders by When, undated last, ties in manuscript order', () => {
        const items = [dated('3 C', '2085-04-02'), dated('9 Undated', undefined), dated('2 B', '2085-03-31'), dated('1 A', '2085-03-31')];
        expect(items.sort(compareChronologicalRows).map(item => item.row.basename)).toEqual(['1 A', '2 B', '3 C', '9 Undated']);
    });

    it('puts a divider before each new day', () => {
        const lines = withDayDividers([dated('1 A', '2085-03-31 09:00'), dated('2 B', '2085-03-31 21:00'), dated('3 C', '2085-04-01')]);
        expect(lines.map(line => line.type)).toEqual(['day', 'row', 'row', 'day', 'row']);
    });

    it('measures each gap from the previous dated row (Shift)', () => {
        const hour = 3600 * 1000;
        const whens = [new Date(2085, 2, 31, 9), null, new Date(2085, 2, 31, 12), new Date(2085, 3, 1, 12)];
        expect(elapsedSincePrevious(whens)).toEqual([null, null, 3 * hour, 24 * hour]);
    });

    it('reads Runtime and keeps a running total (Runtime)', () => {
        expect(readRuntimeSeconds({ Runtime: '2:30' }, settings)).toBe(150);
        expect(readRuntimeSeconds({}, settings)).toBeNull();
        expect(runningTotals([150, null, 60])).toEqual([150, 150, 210]);
    });
});

describe('groupProgress', () => {
    it('counts scenes, completions, words and overdue scenes only', () => {
        const items = [
            { Class: 'Scene', Status: 'Complete', Words: 1200 },
            { Class: 'Scene', Status: ['Todo'], Words: '800', Due: '2020-01-01' },
            { Class: 'Scene', Status: 'Working', Due: '2999-01-01' },
            { Class: 'Sketch', Words: 400 },
            { Class: 'Beat' },
        ].map((fm, index) => ({ row: row(`${index + 1} N`, fm), frontmatter: fm as Record<string, unknown> }));
        expect(groupProgress(items, settings)).toEqual({ scenes: 3, complete: 1, words: 2000, overdue: 1 });
    });
});

describe('planColoring', () => {
    it('gives each value a color slot, most frequent first, reading links and lists as the author sees them', () => {
        const plan = planColoring([
            { path: 'a', value: 'Trisan' },
            { path: 'b', value: ['[[Characters/Shail|Shail]]', 'Trisan'] },
            { path: 'c', value: 'Shail' },
            { path: 'd', value: '' },
            { path: 'e', value: 'Shail' },
        ]);
        expect(plan.kind).toBe('ok');
        if (plan.kind !== 'ok') return;
        expect(plan.legend).toEqual([{ value: 'Shail', colorIndex: 0 }, { value: 'Trisan', colorIndex: 1 }]);
        expect(plan.values.get('b')).toBe('Shail');
        expect(plan.values.has('d')).toBe(false);
    });

    it('refuses a column with too many values, or none', () => {
        expect(planColoring([{ path: 'a', value: 'x' }, { path: 'b', value: 'y' }], 1)).toEqual({ kind: 'tooMany', count: 2 });
        expect(planColoring([{ path: 'a', value: undefined }])).toEqual({ kind: 'none' });
    });
});
