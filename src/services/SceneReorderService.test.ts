import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import type { TimelineItem } from '../types';
import { applySceneNumberUpdates, countRippleRenamesAfterUpdates, SceneReorderVerificationError } from './SceneReorderService';

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
