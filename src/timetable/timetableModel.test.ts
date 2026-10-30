import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import {
    appliedPalette,
    belongsInTimetable,
    buildRingLayout,
    buildTableRow,
    compareChronologicalRows,
    compareManuscriptRows,
    displayName,
    distinctColorSlots,
    dueStatus,
    dueStepNeedsConfirm,
    elapsedSincePrevious,
    filterSignature,
    groupProgress,
    medianOf,
    narrowColoring,
    planColoring,
    planConfiguredColoring,
    readRuntimeSeconds,
    readSavedColoring,
    readWhen,
    runningTotals,
    sceneNumberFill,
    sceneVitals,
    steppedDue,
    toggledPicks,
    withActDividers,
    withDayDividers,
    wordBar,
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
        expect(plan.legend).toEqual([{ value: 'Shail', colorIndex: 0, count: 3 }, { value: 'Trisan', colorIndex: 1, count: 2 }]);
        expect(plan.values.get('b')).toBe('Shail');
        expect(plan.values.has('d')).toBe(false);
    });

    it('takes color slots in the order it is given', () => {
        const plan = planColoring([{ path: 'a', value: 'x' }, { path: 'b', value: 'x' }, { path: 'c', value: 'y' }], 8, [10, 3]);
        expect(plan.kind === 'ok' && plan.legend).toEqual([{ value: 'x', colorIndex: 10, count: 2 }, { value: 'y', colorIndex: 3, count: 1 }]);
    });

    it('lists numbers in order, keeping the most frequent value’s color', () => {
        const plan = planColoring([{ path: 'a', value: 2 }, { path: 'b', value: 2 }, { path: 'c', value: 1 }, { path: 'd', value: 3 }], 8, [5, 3, 15]);
        expect(plan.kind === 'ok' && plan.legend).toEqual([
            { value: '1', colorIndex: 3, count: 1 },
            { value: '2', colorIndex: 5, count: 2 },
            { value: '3', colorIndex: 15, count: 1 },
        ]);
    });

    it('caps painted categories while keeping all categories available, and rejects an empty column', () => {
        const plan = planColoring([{ path: 'a', value: 'x' }, { path: 'b', value: 'y' }], 1);
        expect(plan.kind === 'ok' && plan.legend).toHaveLength(1);
        expect(plan.kind === 'ok' && plan.categories).toHaveLength(2);
        expect(planColoring([{ path: 'a', value: undefined }])).toEqual({ kind: 'none' });
    });

    it('treats an unfilled template field as no value, and colors a list by its first real item', () => {
        const plan = planColoring([
            { path: 'a', value: '{{Character}}' },
            { path: 'b', value: ['{{Character}}', 'Chae Ban'] },
            { path: 'c', value: ['Trisan', ' {{ Character }} '] },
        ]);
        expect(plan.kind).toBe('ok');
        if (plan.kind !== 'ok') return;
        expect(plan.legend.map(entry => entry.value)).toEqual(['Chae Ban', 'Trisan']);
        expect(plan.values.has('a')).toBe(false);
        expect(plan.values.get('b')).toBe('Chae Ban');
        expect(plan.members.get('c')).toEqual(['Trisan']);
    });

    it('offers a supporting character that is never listed first and counts duplicates once per scene', () => {
        const plan = planColoring([{ path: 'a', value: ['Shail', 'Trisan', 'Trisan'] }, { path: 'b', value: ['Shail', 'Trisan'] }]);
        expect(plan.kind === 'ok' && plan.categories).toEqual([{ value: 'Shail', count: 2 }, { value: 'Trisan', count: 2 }]);
    });

    it('uses an explicit palette beyond the eight most frequent, painting a secondary member when chosen', () => {
        const rows = Array.from({ length: 12 }, (_, index) => ({ path: String(index), value: ['Lead', `Supporting ${index}`] }));
        const plan = planColoring(rows, 8, [5], ['Supporting 11']);
        expect(plan.kind === 'ok' && [...plan.values]).toEqual([['11', 'Supporting 11']]);
        expect(plan.kind === 'ok' && plan.legend).toEqual([{ value: 'Supporting 11', count: 1, colorIndex: 5 }]);
        expect(plan.kind === 'ok' && plan.categories).toHaveLength(13);
    });

    it('keeps an old saved pick available after full discovery moves it outside the most frequent eight', () => {
        const rows = Array.from({ length: 12 }, (_, i) => ({ path: String(i), value: ['Lead', `Supporting ${i}`] }));
        const plan = planConfiguredColoring(rows, { picks: ['Supporting 11'] }, [], new Date(2026, 9, 26));
        expect(plan.kind === 'ok' && plan.legend.some(entry => entry.value === 'Supporting 11')).toBe(true);
    });

    it('keeps every item a scene lists, in order', () => {
        const plan = planColoring([{ path: 'a', value: ['[[Characters/Shail|Shail]]', 'Trisan', 'Chae Ban'] }]);
        expect(plan.kind === 'ok' && plan.members.get('a')).toEqual(['Shail', 'Trisan', 'Chae Ban']);
    });
});

describe('narrowColoring', () => {
    const members = new Map([
        ['a', ['Trisan', 'Chae Ban']],
        ['b', ['Chae Ban', 'Shail', 'Trisan']],
        ['c', ['Shail', 'Chae Ban']],
        ['d', ['Trisan']],
    ]);

    it('keeps the scenes that list a pick anywhere, in its color', () => {
        expect([...narrowColoring(members, ['Chae Ban'])]).toEqual([['a', 'Chae Ban'], ['b', 'Chae Ban'], ['c', 'Chae Ban']]);
    });

    it('keeps only the scenes that list every pick, each in the color of the pick it lists first', () => {
        expect([...narrowColoring(members, ['Trisan', 'Chae Ban'])]).toEqual([['a', 'Trisan'], ['b', 'Chae Ban']]);
        expect(narrowColoring(members, ['Trisan', 'Shail', 'Chae Ban']).size).toBe(1);
    });

    it('supports alternative scalar values and periods with any matching pick', () => {
        const periods = new Map([['a', ['month:2085-04']], ['b', ['month:2085-05']], ['c', ['month:2085-06']]]);
        expect([...narrowColoring(periods, ['month:2085-04', 'month:2085-06'], 'any').keys()]).toEqual(['a', 'c']);
    });

    it('is empty when no scene lists them all', () => {
        expect(narrowColoring(members, ['Shail', 'Trisan', 'Nobody']).size).toBe(0);
    });
});

describe('readSavedColoring', () => {
    it('reads the column and the picks, dropping anything that is not a name and repeats', () => {
        expect(readSavedColoring({ property: 'note.Character', picks: ['Trisan', 3, 'Chae Ban', 'Trisan'] }))
            .toEqual({ schemaVersion: 2, property: 'note.Character', picks: ['Trisan', 'Chae Ban'] });
        expect(readSavedColoring({ property: 'note.Place' })).toEqual({ schemaVersion: 2, property: 'note.Place', picks: [] });
    });

    it('reads versioned choices and rejects unknown versions, invalid ranges and oversized palettes', () => {
        const saved = { schemaVersion: 2, property: 'note.When', picks: ['range:inside'], palette: ['range:inside'], match: 'any', grouping: { kind: 'range', start: '2085-04-01', end: '2085-05-31' } };
        expect(readSavedColoring(saved)).toEqual(saved);
        expect(readSavedColoring({ ...saved, schemaVersion: 3 })).toBeNull();
        expect(readSavedColoring({ ...saved, grouping: { ...saved.grouping, end: '2085-02-30' } })).toBeNull();
        expect(readSavedColoring({ ...saved, palette: Array.from({ length: 9 }, (_, i) => String(i)) })).toBeNull();
    });

    it('reopens every date group of a version 1 choice, which saved only the groups present on the day it was applied', () => {
        const due = { schemaVersion: 1, property: 'note.Due', picks: [], palette: ['due:week', 'due:later'], match: 'any', grouping: { kind: 'due' } };
        expect(readSavedColoring(due)).toEqual({ schemaVersion: 2, property: 'note.Due', picks: [], match: 'any', grouping: { kind: 'due' } });
        expect(readSavedColoring({ ...due, palette: ['month:2085-04'], grouping: { kind: 'month' } })?.palette).toBeUndefined();
        expect(readSavedColoring({ schemaVersion: 1, property: 'note.Place', picks: [], palette: ['Mars'] })?.palette).toEqual(['Mars']);
    });

    it('is null when nothing usable is saved', () => {
        expect(readSavedColoring(null)).toBeNull();
        expect(readSavedColoring(undefined)).toBeNull();
        expect(readSavedColoring('note.Character')).toBeNull();
        expect(readSavedColoring({ property: '' })).toBeNull();
        expect(readSavedColoring({ picks: ['Trisan'] })).toBeNull();
    });
});

describe('appliedPalette', () => {
    const dueGroups = ['due:overdue', 'due:today', 'due:week', 'due:later', 'due:completed', 'date:unset', 'date:invalid'];

    it('saves no palette when every Due or range group is kept, so groups reached later still color', () => {
        expect(appliedPalette({ kind: 'due' }, new Set(dueGroups), false, undefined)).toBeUndefined();
        expect(appliedPalette({ kind: 'range', start: '2085-04-01', end: '2085-04-30' }, new Set(['range:before', 'range:inside', 'range:after', 'date:unset', 'date:invalid']), true, undefined)).toBeUndefined();
    });

    it('keeps a Due group the author left checked even when no scene is in it today', () => {
        const kept = new Set(dueGroups.filter(value => value !== 'due:completed'));
        expect(appliedPalette({ kind: 'due' }, kept, true, undefined)).toEqual(['due:overdue', 'due:today', 'due:week', 'due:later', 'date:unset', 'date:invalid']);
    });

    it('leaves day, month and year open unless chosen by hand, and always saves categories', () => {
        const months = new Set(['month:2085-04', 'month:2085-05']);
        expect(appliedPalette({ kind: 'month' }, months, false, undefined)).toBeUndefined();
        expect(appliedPalette({ kind: 'month' }, months, false, ['month:2085-04'])).toEqual(['month:2085-04']);
        expect(appliedPalette({ kind: 'month' }, months, true, undefined)).toEqual(['month:2085-04', 'month:2085-05']);
        expect(appliedPalette(undefined, new Set(['Shail']), false, undefined)).toEqual(['Shail']);
    });
});

describe('toggledPicks', () => {
    it('adds a value at the end, or drops it when picked', () => {
        expect(toggledPicks([], 'Trisan')).toEqual(['Trisan']);
        expect(toggledPicks(['Trisan'], 'Chae Ban')).toEqual(['Trisan', 'Chae Ban']);
        expect(toggledPicks(['Trisan', 'Chae Ban'], 'Trisan')).toEqual(['Chae Ban']);
    });
});

describe('distinctColorSlots', () => {
    it('starts with the most vivid ring color and keeps neighbours apart', () => {
        const order = distinctColorSlots(DEFAULT_SETTINGS.subplotColors);
        expect(order).toHaveLength(16);
        expect(new Set(order).size).toBe(16);
        const [first, second] = order.map(slot => DEFAULT_SETTINGS.subplotColors[slot].toLowerCase());
        expect(first).toBe('#98ce00');
        expect(second).toBe('#314cb6');
    });

    it('puts greys and unreadable colors last, in slot order', () => {
        expect(distinctColorSlots(['#cccccc', '#ff0000', 'teal', '#0000ff'])).toEqual([3, 1, 0, 2]);
    });
});

describe('belongsInTimetable', () => {
    const at = (path: string, fm?: Record<string, unknown>) => buildTableRow(path, path.split('/').pop() ?? path, fm, settings);
    const books = ['Book 2', 'Book 3/'];

    it('keeps scenes, beats and sketches anywhere in a book folder', () => {
        expect(belongsInTimetable(at('Book 2/Act 1/5 Arrival.md', { Class: 'Scene' }), books)).toBe(true);
        expect(belongsInTimetable(at('Book 2/Drafts/Idea.md', { Class: 'Sketch' }), books)).toBe(true);
    });

    it('keeps a scene removed from the timeline (no Class, scene ID kept) wherever it sits', () => {
        const removed = at('Book 2/Act 1/5 Arrival.md', { ID: 'scn_1a2b3c4d', Act: 1, Subplot: ['Search for Lost Crew'] });
        expect(removed.kind).toBe('unclassed');
        expect(removed.removedScene).toBe(true);
        expect(removed.act).toBe(1);
        expect(removed.subplots).toEqual(['Search for Lost Crew']);
        expect(belongsInTimetable(removed, books)).toBe(true);
        expect(at('Book 2/Act 1/5 Arrival.md', { Class: 'Scene', ID: 'scn_1a2b3c4d' }).removedScene).toBe(false);
    });

    it('keeps other notes at a book folder’s top level', () => {
        expect(belongsInTimetable(at('Book 2/78 Dry Tank.md'), books)).toBe(true);
        expect(belongsInTimetable(at('Book 3/Title Page.md', { Class: 'Frontmatter' }), books)).toBe(true);
    });

    it('leaves out other notes in a book’s subfolders (feedback, cuts, publishing material)', () => {
        expect(belongsInTimetable(at('Book 2/Feedback/Manuscript Assessment.md'), books)).toBe(false);
        expect(belongsInTimetable(at('Book 2/Cut/Old Opening.md', { Class: 'Cut' }), books)).toBe(false);
    });

    it('keeps notes outside every book folder, and lets the deepest book folder decide', () => {
        expect(belongsInTimetable(at('Research/Ships.md'), books)).toBe(true);
        expect(belongsInTimetable(at('Book 2/Book 2b/Notes.md'), [...books, 'Book 2/Book 2b'])).toBe(true);
    });
});

describe('dueStatus', () => {
    const today = new Date(2026, 9, 24, 15, 30);

    it('counts calendar days from today', () => {
        expect(dueStatus('2026-10-20', false, today)).toMatchObject({ kind: 'late', days: -4 });
        expect(dueStatus('2026-10-24', false, today)).toMatchObject({ kind: 'soon', days: 0 });
        expect(dueStatus('2026-10-31', false, today)).toMatchObject({ kind: 'soon', days: 7 });
        expect(dueStatus('2026-11-05', false, today)).toMatchObject({ kind: 'later', days: 12 });
    });

    it('is never late across a daylight-saving change', () => {
        expect(dueStatus('2026-11-02', false, new Date(2026, 10, 1, 23, 0))).toMatchObject({ kind: 'soon', days: 1 });
    });

    it('treats a complete scene’s Due as the day it was done', () => {
        expect(dueStatus('2026-10-02', true, today).kind).toBe('done');
    });

    it('has nothing to say about an empty or unreadable Due', () => {
        expect(dueStatus(undefined, false, today).kind).toBe('none');
        expect(dueStatus('soon', false, today).kind).toBe('none');
    });
});

describe('sceneVitals', () => {
    const today = new Date(2026, 9, 24);

    it('reads the stage whatever its case, and defaults to Zero', () => {
        expect(sceneVitals({ Class: 'Scene', 'Publish Stage': 'author' }, settings, today).stage).toBe('Author');
        expect(sceneVitals({ Class: 'Scene' }, settings, today).stage).toBe('Zero');
    });

    it('keeps Pending Edits and the Synopsis in full, or null when empty', () => {
        expect(sceneVitals({ 'Pending Edits': '\n  Cut the bell scene\nThen fix Act 2' }, settings, today).pending).toBe('Cut the bell scene\nThen fix Act 2');
        expect(sceneVitals({ 'Pending Edits': '' }, settings, today).pending).toBeNull();
        expect(sceneVitals({ Synopsis: 'Mara finds the lamp log torn out.' }, settings, today).synopsis).toBe('Mara finds the lamp log torn out.');
        expect(sceneVitals({ Synopsis: ['First beat', 'Second beat'] }, settings, today).synopsis).toBe('First beat\nSecond beat');
        expect(sceneVitals({}, settings, today).synopsis).toBeNull();
        expect(sceneVitals({ Summary: 'Mara learns the log was torn out by her predecessor.' }, settings, today).summary).toBe('Mara learns the log was torn out by her predecessor.');
        expect(sceneVitals({ Summary: '' }, settings, today).summary).toBeNull();
    });

    it('marks a complete scene done rather than late', () => {
        expect(sceneVitals({ Status: 'Complete', Due: '2026-10-02' }, settings, today).due.kind).toBe('done');
        expect(sceneVitals({ Status: 'Working', Due: '2026-10-02' }, settings, today).due.kind).toBe('late');
    });
});

describe('medianOf and wordBar', () => {
    it('finds the median of odd and even lists', () => {
        expect(medianOf([2140, 980, 1650])).toBe(1650);
        expect(medianOf([1000, 2000])).toBe(1500);
        expect(medianOf([])).toBeNull();
    });

    it('puts the median at the midpoint and caps the bar at twice it', () => {
        expect(wordBar(1650, 1650)).toEqual({ fill: 0.5, over: false });
        expect(wordBar(3420, 1650)).toEqual({ fill: 1, over: true });
        expect(wordBar(825, 1650).fill).toBeCloseTo(0.25);
    });
});

describe('steppedDue', () => {
    const today = new Date(2026, 9, 25, 9, 0);

    it('counts a late Due, or none, from today', () => {
        expect(steppedDue('2026-10-20', 1, today)).toBe('2026-10-26');
        expect(steppedDue('2026-10-20', 7, today)).toBe('2026-11-01');
        expect(steppedDue(undefined, 1, today)).toBe('2026-10-26');
        expect(steppedDue('someday', 7, today)).toBe('2026-11-01');
    });

    it('moves a future Due on from where it is, so each click adds up', () => {
        expect(steppedDue('2026-10-28', 1, today)).toBe('2026-10-29');
        expect(steppedDue(steppedDue('2026-10-28', 7, today), 7, today)).toBe('2026-11-11');
    });

    it('treats a Due of today like a late one', () => {
        expect(steppedDue('2026-10-25', 1, today)).toBe('2026-10-26');
    });

    it('crosses month and year ends', () => {
        expect(steppedDue('2026-12-30', 7, today)).toBe('2027-01-06');
    });
});

describe('dueStepNeedsConfirm', () => {
    const today = new Date(2026, 9, 25);

    it('moves a late Due at once and asks first for any other', () => {
        expect(dueStepNeedsConfirm(dueStatus('2026-10-20', false, today))).toBe(false);
        expect(dueStepNeedsConfirm(dueStatus('2026-10-27', false, today))).toBe(true);
        expect(dueStepNeedsConfirm(dueStatus('2026-12-01', false, today))).toBe(true);
        expect(dueStepNeedsConfirm(dueStatus(undefined, false, today))).toBe(true);
    });
});

describe('filterSignature', () => {
    it('names a filter with at least one condition, however it is grouped', () => {
        expect(filterSignature({ and: ['date(When).hour >= 12'] })).toBe('{"and":["date(When).hour >= 12"]}');
        expect(filterSignature('Status == "Todo"')).toBe('"Status == \\"Todo\\""');
        expect(filterSignature({ or: [{ and: [] }, { not: ['file.hasTag("cut")'] }] })).not.toBeNull();
    });

    it('is null for no filter, or one whose groups are all empty', () => {
        expect(filterSignature(undefined)).toBeNull();
        expect(filterSignature({ and: [] })).toBeNull();
        expect(filterSignature({ or: [{ and: [] }, '  '] })).toBeNull();
    });

    it('changes when the filter changes', () => {
        expect(filterSignature({ and: ['date(When).hour >= 12'] })).not.toBe(filterSignature({ and: ['date(When).hour >= 18'] }));
    });
});
