import { describe, expect, it } from 'vitest';
import { addNoteClass } from './NoteDropCapture';

describe('adding a note to the book', () => {
    it('inserts only the Class line and preserves existing YAML, comments, and prose byte for byte', () => {
        const source = '---\r\nSynopsis: A scene # keep this\r\nAct: 3\r\nWhen: 2085-05-11\r\nCharacter:\r\n  - "[[Entiat Chelan]]"\r\n---\r\n\r\nUnchanged prose.\r\n';
        expect(addNoteClass(source, 'Scene')).toBe(source.replace('---\r\n', '---\r\nClass: Scene\r\n'));
    });
    it('wraps a note without frontmatter without changing its text', () => {
        expect(addNoteClass('A sketch.\n', 'Sketch')).toBe('---\nClass: Sketch\n---\n\nA sketch.\n');
    });
    it('adds a chosen sketch anchor without changing the existing properties', () => {
        const source = '---\nAct: 3\nSynopsis: Leave this alone\n---\n\nBody\n';
        expect(addNoteClass(source, 'Sketch', 'scn_12345678')).toBe(source.replace('---\n', '---\nClass: Sketch\nPlace after scene: "scn_12345678"\n'));
        expect(() => addNoteClass('---\nPlace after scene: scn_existing\n---\n', 'Sketch', 'scn_other')).toThrow();
    });
    it('does not replace any existing class, including empty or differently cased keys', () => {
        expect(() => addNoteClass('---\nclass: Character\n---\n', 'Scene')).toThrow();
        expect(() => addNoteClass('---\nClass:\n---\n', 'Sketch')).toThrow();
    });
    it('rejects incomplete frontmatter', () => {
        expect(() => addNoteClass('---\nSynopsis: incomplete\n', 'Scene')).toThrow();
    });
});
