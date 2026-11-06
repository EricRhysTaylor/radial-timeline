import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import {
    applyFrontmatterEdits,
    formatYamlField,
    insertFieldEdits,
    readFrontmatterText,
    removeFieldEdit,
    reorderFrontmatterFields,
    replaceValueEdit,
    yamlScalar,
} from './frontmatterText';

const read = (content: string) => {
    const text = readFrontmatterText(content);
    if (!text) throw new Error('no frontmatter');
    return text;
};
const field = (content: string, key: string) => {
    const text = read(content);
    return { text, field: text.fields.find(item => item.key === key)! };
};

describe('readFrontmatterText', () => {
    it('reports no frontmatter, and refuses malformed frontmatter', () => {
        expect(readFrontmatterText('Just prose')).toBeNull();
        expect(() => readFrontmatterText('---\nClass: Scene\nno closing fence')).toThrow();
        expect(() => readFrontmatterText('---\nClass: [\n---\n')).toThrow();
        expect(() => readFrontmatterText('---\n{ Class: Scene }\n---\n')).toThrow();
        expect(() => readFrontmatterText('---\nClass: a\nClass: b\n---\n')).toThrow();
    });
    it('reads an empty block', () => {
        expect(read('---\n---\nBody').fields).toEqual([]);
    });
    it('reads CRLF notes and every value shape', () => {
        const text = read('---\r\nA: 1\r\nB:\r\n  - x\r\nC: |\r\n  line\r\nD:\r\n---\r\nBody');
        expect(text.newline).toBe('\r\n');
        expect(text.fields.map(item => [item.key, item.value])).toEqual([['A', 1], ['B', ['x']], ['C', 'line\n'], ['D', null]]);
    });
});

describe('edits', () => {
    it('returns the note unchanged when there is nothing to do', () => {
        const source = '---\nA: 1 # keep\n---\nBody';
        expect(applyFrontmatterEdits(read(source), [])).toBe(source);
    });
    it('inserts in canonical order after attached custom fields', () => {
        const source = '---\nA: 1\nMine: x\nC: 3\n---\nBody';
        const text = read(source);
        const placement = { order: ['A', 'B', 'C', 'D'], canonicalOf: (key: string) => key };
        const edits = insertFieldEdits(text, [{ key: 'B', lines: 'B: 2' }, { key: 'D', lines: 'D: 4' }], placement);
        expect(applyFrontmatterEdits(text, edits)).toBe('---\nA: 1\nMine: x\nB: 2\nC: 3\nD: 4\n---\nBody');
    });
    it('puts a key with no earlier neighbor first, and an unranked key last', () => {
        const text = read('---\nB: 2\n---\n');
        const placement = { order: ['A', 'B'], canonicalOf: (key: string) => key };
        const edits = insertFieldEdits(text, [{ key: 'A', lines: 'A: 1' }, { key: 'Z', lines: 'Z: 9' }], placement);
        expect(applyFrontmatterEdits(text, edits)).toBe('---\nA: 1\nB: 2\nZ: 9\n---\n');
    });
    it('keeps several fields at one spot in the order given, with the note line endings', () => {
        const text = read('---\r\nA: 1\r\n---\r\n');
        const edits = insertFieldEdits(text, [{ key: 'B', lines: 'B:\n  - x' }, { key: 'C', lines: 'C: 3' }]);
        expect(applyFrontmatterEdits(text, edits)).toBe('---\r\nA: 1\r\nB:\r\n  - x\r\nC: 3\r\n---\r\n');
    });
    it('fills an empty value around its comment and replaces a list', () => {
        const blank = field('---\nA: # note\nB: 1\n---\n', 'A');
        expect(applyFrontmatterEdits(blank.text, [replaceValueEdit(blank.text, blank.field, '2')])).toBe('---\nA: 2 # note\nB: 1\n---\n');
        const list = field('---\nA:\n  - x\n  - y\nB: 1\n---\n', 'A');
        expect(parse(applyFrontmatterEdits(list.text, [replaceValueEdit(list.text, list.field, 'z')]).split('---')[1])).toEqual({ A: 'z', B: 1 });
        const flush = field('---\nA:\n- x\n- y\nB: 1\n---\n', 'A');
        expect(applyFrontmatterEdits(flush.text, [replaceValueEdit(flush.text, flush.field, 'z')])).toBe('---\nA:\n  z\nB: 1\n---\n');
    });
    it('removes a field and its list, and keeps the comment above it', () => {
        const target = field('---\n# about A\nA:\n  - x\nB: 1\n---\n', 'A');
        expect(applyFrontmatterEdits(target.text, [removeFieldEdit(target.field, target.text.raw)])).toBe('---\n# about A\nB: 1\n---\n');
    });
    it('refuses to change or remove a value other properties depend on', () => {
        const anchored = field('---\nA: &shared 1\nB: *shared\n---\n', 'A');
        expect(() => replaceValueEdit(anchored.text, anchored.field, '2')).toThrow();
        expect(() => removeFieldEdit(anchored.field, anchored.text.raw)).toThrow();
    });
    it('throws rather than return broken YAML', () => {
        const text = read('---\nA: 1\n---\n');
        expect(() => applyFrontmatterEdits(text, [{ start: 0, end: 0, text: 'B: [\n' }])).toThrow();
    });
});

describe('reorderFrontmatterFields', () => {
    it('moves comments, block values and lists with their field', () => {
        const source = '---\n# about B\nB: 2 # two\nC: |\n  text\n  more\n# about A\nA:\n  - x\n---\nBody';
        expect(reorderFrontmatterFields(read(source), ['A', 'B', 'C']))
            .toBe('---\n# about A\nA:\n  - x\n# about B\nB: 2 # two\nC: |\n  text\n  more\n---\nBody');
    });
    it('respells a key without touching its value or comment', () => {
        expect(reorderFrontmatterFields(read('---\nclass: Scene # c\n---\n'), ['class'], new Map([['class', 'Class']])))
            .toBe('---\nClass: Scene # c\n---\n');
    });
    it('refuses a move that would break an alias', () => {
        expect(() => reorderFrontmatterFields(read('---\nA: &x 1\nB: *x\n---\n'), ['B', 'A'])).toThrow();
    });
    it('refuses a key list that does not match the note', () => {
        expect(() => reorderFrontmatterFields(read('---\nA: 1\nB: 2\n---\n'), ['A'])).toThrow();
    });
});

describe('yamlScalar', () => {
    it('quotes only what plain YAML would misread', () => {
        for (const value of ['a: b', 'a #b', '#a', '- a', '[a]', '{a}', 'true', 'null', '12', '1.5', '"a"', 'a:']) {
            expect(parse(`k: ${yamlScalar(value)}`)).toEqual({ k: value });
        }
        for (const value of ['Main Plot', '2085-05-10 09:30', 'Ann', 'http://x.y/z']) expect(yamlScalar(value)).toBe(value);
    });
    it('writes empty fields the way the templates do', () => {
        expect(formatYamlField('A', '')).toBe('A:');
        expect(formatYamlField('A', [])).toBe('A:');
        expect(parse(formatYamlField('Odd: key', ['x', 'y: z']))).toEqual({ 'Odd: key': ['x', 'y: z'] });
    });
});
