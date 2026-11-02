import { describe, expect, it } from 'vitest';
import { parseOutlineHeadings, preserveOutlineEdits } from './outlineImport';

describe('formatted outline import', () => {
    it('keeps edited titles and text while recalculating acts', () => {
        const original = [{ id: '2', title: 'Revised title', body: 'Reviewed text', act: null }];
        const parsed = [{ id: '2', title: 'Old title', body: 'Original text', act: 2 }];
        expect(preserveOutlineEdits(parsed, original)).toEqual([{ id: '2', title: 'Revised title', body: 'Reviewed text', act: 2 }]);
    });
    it('maps act headings, keeps nested content, and leaves prose before the first heading alone', () => {
        const source = '---\nClass: Outline\n---\nIntro\n## Act 1\n### First\nText\n#### Detail\nMore\n### Second\nNext\n## Act 2\n### Third\nEnding';
        expect(parseOutlineHeadings(source, 3, 2, 3)).toEqual([
            { id: '2', title: 'First', body: 'Text\n#### Detail\nMore', act: 1 },
            { id: '6', title: 'Second', body: 'Next', act: 1 },
            { id: '9', title: 'Third', body: 'Ending', act: 2 },
        ]);
    });
    it('ignores fenced headings and preserves callouts in the body', () => {
        const text = '## Idea\n```md\n## Not an idea\n```\n> [!info] Suggestion\n> Keep attribution.\n## Next\nBody';
        const entries = parseOutlineHeadings(text, 2, null, 3);
        expect(entries.map(entry => entry.title)).toEqual(['Idea', 'Next']);
        expect(entries[0].body).toContain('> [!info] Suggestion\n> Keep attribution.');
    });
    it('never guesses act numbers from unrelated headings or out-of-range acts', () => {
        expect(parseOutlineHeadings('## Act 8\n### One\nText\n## Notes\n### Two\nText', 3, 2, 3).map(entry => entry.act)).toEqual([null, null]);
    });
});
