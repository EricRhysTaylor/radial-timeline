import { describe, expect, it } from 'vitest';
import { TFile } from 'obsidian';
import { createInMemoryApp } from '../../tests/helpers/inMemoryObsidian';
import { applySceneNumberUpdates, SceneReorderVerificationError } from './SceneReorderService';

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
