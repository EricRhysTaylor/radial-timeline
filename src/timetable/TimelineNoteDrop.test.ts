import { describe, expect, it } from 'vitest';
import { applyTimelineNoteFields } from './TimelineNoteDrop';

describe('timeline note intake', () => {
    it('adds scene placement without altering existing prose or other YAML', () => {
        const source = '---\r\nSynopsis: Original # keep\r\nWhen: 2085-05-11\r\nCharacter:\r\n  - Entiat\r\n---\r\n\r\nOriginal prose.\r\n';
        expect(applyTimelineNoteFields(source, 2, 'Harbor', false, false)).toBe(source.replace('---\r\n', '---\r\nClass: Scene\r\nAct: 2\r\nSubplot: "Harbor"\r\n'));
    });
    it('preserves conflicting properties unless the author chooses to change them', () => {
        const source = '---\nAct: 3 # retain comment\nSubplot: Other\nSynopsis: Keep me\n---\nBody\n';
        expect(applyTimelineNoteFields(source, 1, 'Main Plot', false, false)).toBe(source.replace('---\n', '---\nClass: Scene\n'));
        expect(applyTimelineNoteFields(source, 1, 'Main Plot', true, true)).toBe('---\nClass: Scene\nAct: 1 # retain comment\nSubplot: "Main Plot"\nSynopsis: Keep me\n---\nBody\n');
    });
    it('rejects classed notes and can replace a chosen list without changing other properties', () => {
        expect(() => applyTimelineNoteFields('---\nClass: Character\n---\nBody', 1, 'Main Plot', true, true)).toThrow();
        expect(applyTimelineNoteFields('---\nSubplot:\n  - One\n  - Two\nSynopsis: Keep\n---\nBody', 1, 'Main Plot', true, true)).toBe('---\nClass: Scene\nAct: 1\nSubplot:\n  "Main Plot"\nSynopsis: Keep\n---\nBody');
    });
    it('respects mapped property names and refuses ambiguous duplicate aliases', () => {
        const source = '---\nStory Act: 3\nSynopsis: Keep\n---\nBody';
        expect(applyTimelineNoteFields(source, 1, 'Main Plot', true, false, { 'Story Act': 'Act' })).toBe('---\nClass: Scene\nSubplot: "Main Plot"\nStory Act: 1\nSynopsis: Keep\n---\nBody');
        expect(() => applyTimelineNoteFields('---\nAct: 1\nStory Act: 2\n---\nBody', 1, 'Main Plot', false, false, { 'Story Act': 'Act' })).toThrow();
    });
    it('wraps a note without frontmatter while preserving its body', () => {
        expect(applyTimelineNoteFields('Body\n', 1, 'Main Plot', false, false)).toBe('---\nClass: Scene\nAct: 1\nSubplot: "Main Plot"\n---\n\nBody\n');
    });
    it('safely replaces empty selected properties', () => {
        expect(applyTimelineNoteFields('---\nAct:\nSubplot:\n---\nBody', 2, 'Main Plot', true, true)).toBe('---\nClass: Scene\nAct: 2\nSubplot: "Main Plot"\n---\nBody');
    });
    it('does not change an anchored value that another property references', () => {
        expect(() => applyTimelineNoteFields('---\nAct: &chosen 3\nOther: *chosen\n---\nBody', 1, 'Main Plot', true, false)).toThrow();
        expect(() => applyTimelineNoteFields('---\nSubplot:\n  - &chosen One\nOther: *chosen\n---\nBody', 1, 'Main Plot', false, true)).toThrow();
    });
});
