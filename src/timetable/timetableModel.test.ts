import { describe, expect, it } from 'vitest';
import type { RadialTimelineSettings } from '../types';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { buildRingLayout, buildTableRow, compareManuscriptRows, sceneNumberFill, withActDividers } from './timetableModel';

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
