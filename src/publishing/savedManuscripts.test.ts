import { describe, expect, it } from 'vitest';
import type { App } from 'obsidian';
import { TFile, TFolder } from '../../tests/mocks/obsidian';
import type { SavedManuscriptSource } from '../types';
import { getReviewedManuscriptSelection } from '../utils/exportContext';
import { readSavedManuscripts, restoreSavedManuscript, saveManuscriptRecord } from './savedManuscripts';

function fixture() {
    const files = ['Draft/1 Start.md', 'Draft/2 Middle.md', 'Draft/3 Research.md'].map(path => new TFile(path));
    const app = { vault: {
        getMarkdownFiles: () => files,
        getAbstractFileByPath: (path: string) => path === 'Draft' ? new TFolder(path) : files.find(file => file.path === path) || null,
    } } as unknown as App;
    const record: SavedManuscriptSource = {
        schemaVersion: 1, id: 'draft', name: 'Submission draft',
        source: { kind: 'folder', path: 'Draft', title: 'A manuscript', author: 'Writer', paths: ['Draft/2 Middle.md', 'Draft/1 Start.md'] },
        candidatePaths: ['Draft/2 Middle.md', 'Draft/1 Start.md', 'Draft/3 Research.md'],
    };
    return { app, files, record };
}

describe('saved manuscript sources', () => {
    it('restores persisted metadata, exclusions and order after a JSON round trip', () => {
        const { app, record } = fixture();
        const saved = readSavedManuscripts(JSON.parse(JSON.stringify([record])))[0];
        const restored = restoreSavedManuscript(app, saved);
        expect(restored.source).toEqual(record.source);
        expect(getReviewedManuscriptSelection(app, restored.source).files.map(file => file.path)).toEqual(record.source.paths);
        expect(restored.addedPaths).toEqual([]);
        expect(restored.missingPaths).toEqual([]);
        restored.source.paths.reverse();
        expect(saved.source.paths).toEqual(record.source.paths);
    });
    it('shows newly discovered notes without including or reordering them', () => {
        const { app, files, record } = fixture();
        files.push(new TFile('Draft/0 New.md'));
        const restored = restoreSavedManuscript(app, record);
        expect(restored.addedPaths).toEqual(['Draft/0 New.md']);
        expect(restored.candidatePaths).toEqual([...record.candidatePaths, 'Draft/0 New.md']);
        expect(restored.source.paths).toEqual(record.source.paths);
    });
    it('keeps a renamed or missing selected note visible and blocks incomplete output', () => {
        const { app, files, record } = fixture();
        files[1] = new TFile('Draft/2 Renamed.md');
        const restored = restoreSavedManuscript(app, record);
        expect(restored.missingPaths).toEqual(['Draft/2 Middle.md']);
        expect(restored.addedPaths).toEqual(['Draft/2 Renamed.md']);
        expect(() => getReviewedManuscriptSelection(app, restored.source)).toThrow('missing');
        restored.source.paths = ['Draft/2 Renamed.md', 'Draft/1 Start.md'];
        expect(getReviewedManuscriptSelection(app, restored.source).files.map(file => file.path)).toEqual(restored.source.paths);
    });
    it('restores one Markdown file and rejects an unavailable source instead of substituting another', () => {
        const { app, files, record } = fixture();
        record.source = { ...record.source, kind: 'file', path: files[0].path, paths: [files[0].path] };
        record.candidatePaths = [files[0].path];
        expect(restoreSavedManuscript(app, record).source.paths).toEqual([files[0].path]);
        files.shift();
        expect(() => restoreSavedManuscript(app, record)).toThrow('Markdown');
    });
    it('updates one named record without mutating others or retaining references to draft edits', () => {
        const { record } = fixture();
        const other = { ...structuredClone(record), id: 'other', name: 'Other draft' };
        const edited = { ...structuredClone(record), name: 'Revised submission' };
        const records = saveManuscriptRecord([record, other], edited, true);
        edited.source.title = 'Later unsaved edit';
        expect(records[0].source.title).toBe(record.source.title);
        expect(records[1]).toBe(other);
        expect(record.name).toBe('Submission draft');
        expect(() => saveManuscriptRecord(records, { ...edited, id: 'copy', name: 'Other draft' }, false)).toThrow('already uses');
        expect(() => saveManuscriptRecord([], edited, true)).toThrow('no longer exists');
    });
    it.each([
        { schemaVersion: 2 }, { candidatePaths: [] },
        { source: { kind: 'book', bookId: 'one' } },
        { source: { kind: 'folder', path: 'Draft', paths: ['Other/Else.md'], title: '', author: '' } },
    ])('rejects unsupported or invalid saved data without deleting it: %j', changes => {
        const { record } = fixture();
        const input = [{ ...record, ...changes }];
        const before = JSON.stringify(input);
        expect(() => readSavedManuscripts(input)).toThrow('unavailable');
        expect(JSON.stringify(input)).toBe(before);
    });
});
