import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import { getManuscriptSourceFiles, getReviewedManuscriptSelection } from './exportContext';

const files = ['Draft/10 End.md', 'Draft/2 Middle.md', 'Draft/1 Start.md', 'Draftish/Other.md', 'Draft/image.png'].map(path => new TFile(path));
const app = { vault: {
    getMarkdownFiles: () => files.filter(file => file.extension === 'md'),
    getAbstractFileByPath: (path: string) => path === 'Draft' ? new TFolder(path) : files.find(file => file.path === path) || null,
} } as unknown as App;

describe('direct manuscript source', () => {
    it('offers a segment-scoped natural path order for explicit review', () => {
        expect(getManuscriptSourceFiles(app, 'folder', 'Draft').map(file => file.path)).toEqual(['Draft/1 Start.md', 'Draft/2 Middle.md', 'Draft/10 End.md']);
    });
    it('preserves reviewed order and exclusions without discovering new files', () => {
        const result = getReviewedManuscriptSelection(app, { kind: 'folder', path: 'Draft', paths: ['Draft/10 End.md', 'Draft/1 Start.md'], title: '', author: '' });
        expect(result.files.map(file => file.path)).toEqual(['Draft/10 End.md', 'Draft/1 Start.md']);
    });
    it.each([
        ['Draftish/Other.md'], ['Draft/1 Start.md', 'Draft/1 Start.md'], ['Draft/missing.md'], ['Draft/image.png'], [],
    ])('blocks invalid reviewed selections %j', (...paths: string[]) => {
        expect(() => getReviewedManuscriptSelection(app, { kind: 'folder', path: 'Draft', paths, title: '', author: '' })).toThrow();
    });
    it('cannot expand a single-file source to other notes', () => {
        expect(() => getReviewedManuscriptSelection(app, { kind: 'file', path: 'Draft/1 Start.md', paths: ['Draft/10 End.md'], title: '', author: '' })).toThrow('outside');
    });
});
