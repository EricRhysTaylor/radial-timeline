import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import type { TimelineItem } from '../types';
import { applySceneNumberUpdates, countRippleRenamesAfterUpdates, planRenameSteps, SceneReorderVerificationError } from './SceneReorderService';

describe('applySceneNumberUpdates', () => {
    it('verifies reordered filenames and preserves reference ids', async () => {
        const app = createInMemoryApp({
            'Book/01 First.md': ['---', 'ID: scn_first', 'Class: Scene', '---', 'Body 1'].join('\n'),
            'Book/02 Second.md': ['---', 'ID: scn_second', 'Class: Scene', '---', 'Body 2'].join('\n'),
        });

        await applySceneNumberUpdates(app as never, [
            { path: 'Book/01 First.md', newNumber: '02' },
            { path: 'Book/02 Second.md', newNumber: '01' },
        ], {
            verification: {
                expectedOrderedPaths: ['Book/02 Second.md', 'Book/01 First.md'],
                expectedNumbersByPath: {
                    'Book/02 Second.md': '01',
                    'Book/01 First.md': '02',
                },
                movedItemPath: 'Book/02 Second.md',
                expectedMovedIndex: 0,
            }
        });

        expect(app.vault.getAbstractFileByPath('Book/01 Second.md')).toBeInstanceOf(TFile);
        expect(app.vault.getAbstractFileByPath('Book/02 First.md')).toBeInstanceOf(TFile);
    });

    it('fails verification when expected numbering does not match the result', async () => {
        const app = createInMemoryApp({
            'Book/01 First.md': ['---', 'ID: scn_first', 'Class: Scene', '---', 'Body 1'].join('\n'),
            'Book/02 Second.md': ['---', 'ID: scn_second', 'Class: Scene', '---', 'Body 2'].join('\n'),
        });

        await expect(applySceneNumberUpdates(app as never, [
            { path: 'Book/01 First.md', newNumber: '02' },
            { path: 'Book/02 Second.md', newNumber: '01' },
        ], {
            verification: {
                expectedOrderedPaths: ['Book/02 Second.md', 'Book/01 First.md'],
                expectedNumbersByPath: {
                    'Book/02 Second.md': '09',
                    'Book/01 First.md': '02',
                },
            }
        })).rejects.toBeInstanceOf(SceneReorderVerificationError);
    });
});

describe('planRenameSteps', () => {
    const move = (from: string, to: string) => ({ from, to, temp: `z${to}` });

    it('renames a run from its far end, each note once, with no temporary names', () => {
        // A beat or scene moved into a free number pushes 5→6→7 onward.
        expect(planRenameSteps([move('5', '6'), move('6', '7'), move('7', '8')])).toEqual([
            { from: '7', to: '8' }, { from: '6', to: '7' }, { from: '5', to: '6' },
        ]);
        expect(planRenameSteps([move('5.01', '4.01')])).toEqual([{ from: '5.01', to: '4.01' }]);
    });

    it('parks one note to open a loop: a scene moved back to 5 with 5..9 shifting up', () => {
        const steps = planRenameSteps([move('10', '5'), move('5', '6'), move('6', '7'), move('7', '8'), move('8', '9'), move('9', '10')]);
        expect(steps).toHaveLength(7);
        expect(steps.filter(step => step.to.startsWith('z'))).toHaveLength(1);
        // Every step lands on a name no other note holds at that moment.
        const held = new Set(['10', '5', '6', '7', '8', '9']);
        for (const step of steps) {
            expect(held.has(step.to)).toBe(false);
            held.delete(step.from);
            held.add(step.to);
        }
        expect([...held].sort()).toEqual(['10', '5', '6', '7', '8', '9']);
    });

    it('swaps two notes with one temporary name', () => {
        expect(planRenameSteps([move('01', '02'), move('02', '01')])).toEqual([
            { from: '01', to: 'z02' }, { from: '02', to: '01' }, { from: 'z02', to: '02' },
        ]);
    });
});

describe('applySceneNumberUpdates rename count', () => {
    it('renames each note once, never through a temporary name, when titles differ', async () => {
        const app = createInMemoryApp({
            'Book/05 Five.md': 'Body 5',
            'Book/06 Six.md': 'Body 6',
        });
        const renames: string[] = [];
        const rename = app.fileManager.renameFile.bind(app.fileManager);
        app.fileManager.renameFile = async (file: TFile, path: string) => { renames.push(path); await rename(file, path); };
        await applySceneNumberUpdates(app as never, [
            { path: 'Book/05 Five.md', newNumber: '06' },
            { path: 'Book/06 Six.md', newNumber: '07' },
        ]);
        // "06 Five" never collides with "06 Six": a number can be shared for a moment, a file name cannot.
        expect(renames.sort()).toEqual(['Book/06 Five.md', 'Book/07 Six.md']);
    });
});

describe('countRippleRenamesAfterUpdates', () => {
    const scene = (path: string, actNumber = 1): TimelineItem => ({ path, itemType: 'Scene', actNumber } as TimelineItem);

    it('counts the files the ripple rename renames beyond the move itself', () => {
        const items = [scene('Book/1 A.md'), scene('Book/2 B.md'), scene('Book/3 C.md'), scene('Book/5 D.md'), scene('Book/6 E.md')];
        const moved = [{ path: 'Book/1 A.md', newNumber: '2' }, { path: 'Book/2 B.md', newNumber: '1' }];
        // After the swap the ripple renumbers 5 D → 4 and 6 E → 5.
        expect(countRippleRenamesAfterUpdates(items, moved)).toBe(2);
    });

    it('is zero when the book is already numbered 1..n after the move', () => {
        const items = [scene('Book/1 A.md'), scene('Book/2 B.md'), scene('Book/3 C.md')];
        expect(countRippleRenamesAfterUpdates(items, [
            { path: 'Book/1 A.md', newNumber: '2' },
            { path: 'Book/2 B.md', newNumber: '1' },
        ])).toBe(0);
    });

    it('follows an act change and leaves the moved file out of the count', () => {
        const items = [scene('Book/1 A.md'), scene('Book/2 B.md'), scene('Book/4 C.md'), scene('Book/5 D.md')];
        // D keeps its number and moves to Act 2; C (4 → 3) is the one other file.
        expect(countRippleRenamesAfterUpdates(items, [{ path: 'Book/5 D.md', newNumber: '5', actNumber: 2 }])).toBe(1);
    });
});
