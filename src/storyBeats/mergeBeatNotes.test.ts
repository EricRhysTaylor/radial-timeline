import { describe, expect, it, vi } from 'vitest';
import type { App, TFile } from 'obsidian';
import type { BeatMatchedNote, BeatSystemStructuralStatus } from './types';
import { normalizeBeatTitle } from './beatSystemStatus';
import { applyBeatNoteMerge, planBeatNoteMerge } from './mergeBeatNotes';

const note = (path: string): BeatMatchedNote => ({ file: { path } as TFile, path, basename: path, title: path, missingBeatModel: false });
const status = (active: Record<string, BeatMatchedNote[]>, missingModel: Record<string, BeatMatchedNote[]> = {}): BeatSystemStructuralStatus => ({
    matches: {
        activeByBeatKey: new Map(Object.entries(active).map(([k, v]) => [normalizeBeatTitle(k), v])),
        missingModelByBeatKey: new Map(Object.entries(missingModel).map(([k, v]) => [normalizeBeatTitle(k), v])),
        exactByBeatKey: new Map(),
        looseByBeatKey: new Map()
    }
} as unknown as BeatSystemStructuralStatus); // SAFE: the planner reads only the match maps

describe('planBeatNoteMerge', () => {
    it('pairs each beat with its one note and flags notes that lack a Beat Model', () => {
        const plan = planBeatNoteMerge(
            [{ name: 'Catalyst', act: 1 }, { name: 'Midpoint', act: 2 }, { name: 'Unmatched', act: 3 }],
            status({ Catalyst: [note('c.md')] }, { Midpoint: [note('m.md')] })
        );
        expect(plan.updates).toEqual([
            { file: { path: 'c.md' }, act: 1, needsBeatModelFix: false },
            { file: { path: 'm.md' }, act: 2, needsBeatModelFix: true }
        ]);
        expect(plan.duplicates).toEqual([]);
    });

    it('skips a beat named twice in the set and a beat matching two notes', () => {
        const plan = planBeatNoteMerge(
            [{ name: 'Twice', act: 1 }, { name: 'twice', act: 2 }, { name: 'Split', act: 1 }],
            status({ Twice: [note('t.md')], Split: [note('s1.md'), note('s2.md')] })
        );
        expect(plan.updates).toEqual([]);
        expect(plan.duplicates).toEqual(['Twice', 'twice', 'Split']);
    });
});

describe('applyBeatNoteMerge', () => {
    it('stamps Act and Beat Model and adds Class only when absent', async () => {
        const frontmatter: Record<string, Record<string, unknown>> = { 'a.md': {}, 'b.md': { Class: 'Plot' } };
        const app = {
            fileManager: {
                processFrontMatter: vi.fn(async (file: TFile, cb: (fm: Record<string, unknown>) => void) => { cb(frontmatter[file.path]); })
            }
        } as unknown as App; // SAFE: only processFrontMatter is used
        await applyBeatNoteMerge(app, [
            { file: { path: 'a.md' } as TFile, act: 1, needsBeatModelFix: true },
            { file: { path: 'b.md' } as TFile, act: 3, needsBeatModelFix: false }
        ], 'My Set');
        expect(frontmatter['a.md']).toEqual({ Act: 1, 'Beat Model': 'My Set', Class: 'Beat' });
        expect(frontmatter['b.md']).toEqual({ Class: 'Plot', Act: 3, 'Beat Model': 'My Set' });
    });
});
