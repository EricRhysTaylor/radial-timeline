import { describe, expect, it } from 'vitest';
import { getPlotSystem, PLOT_SYSTEM_NAMES, PLOT_SYSTEMS, STARTER_BEAT_SETS } from './beatsSystems';

describe('built-in plot systems', () => {
    it('agree with themselves: names list, beat count, and beat details line up', () => {
        expect(PLOT_SYSTEM_NAMES).toEqual(Object.keys(PLOT_SYSTEMS));
        for (const [name, preset] of Object.entries(PLOT_SYSTEMS)) {
            expect(preset.name).toBe(name);
            expect(preset.beats.length).toBeGreaterThan(0);
            expect(preset.beatCount).toBe(preset.beats.length);
            if (preset.beatDetails) expect(preset.beatDetails.map(b => b.name)).toEqual(preset.beats);
            expect(new Set(preset.beats).size).toBe(preset.beats.length);
        }
    });

    it('resolves built-ins by name and starter sets as uniform presets', () => {
        const [firstName] = PLOT_SYSTEM_NAMES;
        expect(getPlotSystem(firstName)).toBe(PLOT_SYSTEMS[firstName]);
        expect(getPlotSystem('no such system')).toBeNull();
        for (const starter of STARTER_BEAT_SETS) {
            const preset = getPlotSystem(starter.name);
            expect(preset).not.toBeNull();
            expect(preset!.beatCount).toBe(preset!.beats.length);
            expect(preset!.beatDetails?.length).toBe(preset!.beats.length);
            expect(preset!.beats.every(b => b.trim().length > 0)).toBe(true);
        }
    });

    it('starter set ids are unique and namespaced', () => {
        const ids = STARTER_BEAT_SETS.map(s => s.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.every(id => id.startsWith('starter:'))).toBe(true);
    });
});
