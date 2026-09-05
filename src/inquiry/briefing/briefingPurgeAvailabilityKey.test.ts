import { describe, it, expect } from 'vitest';
import {
    buildBriefingPurgeAvailabilityKey,
    type BriefingPurgeKeyInput,
} from './briefingPurgeAvailabilityKey';

function input(overrides: Partial<BriefingPurgeKeyInput> = {}): BriefingPurgeKeyInput {
    return {
        scenes: [],
        scope: 'book',
        activeBookId: undefined,
        actionNotesFieldLabel: 'Action Notes',
        ...overrides,
    };
}

describe('buildBriefingPurgeAvailabilityKey', () => {
    it('returns an empty string when the corpus has no scenes', () => {
        expect(buildBriefingPurgeAvailabilityKey(input())).toBe('');
    });

    it('builds the canonical scope::book::field::scenes shape', () => {
        const key = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }, { filePath: 'b.md' }],
            scope: 'book',
            activeBookId: 'book-1',
            actionNotesFieldLabel: 'Action Notes',
        }));
        expect(key).toBe('book::book-1::Action Notes::a.mdb.md');
    });

    it('prefers filePath over displayLabel when both are present', () => {
        const key = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'p.md', displayLabel: 'Pretty' }],
        }));
        expect(key.endsWith('::p.md')).toBe(true);
    });

    it('falls back to displayLabel when filePath is missing', () => {
        const key = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ displayLabel: 'Fallback Label' }],
        }));
        expect(key.endsWith('::Fallback Label')).toBe(true);
    });

    it('emits an empty token for scenes missing both identifiers', () => {
        const key = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }, {}, { filePath: 'c.md' }],
        }));
        expect(key.endsWith('::a.mdc.md')).toBe(true);
    });

    it('treats missing activeBookId as an empty segment, preserving slot count', () => {
        const key = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }],
            scope: 'saga',
            activeBookId: undefined,
        }));
        // 4 segments: scope, '', fieldLabel, sceneKey
        expect(key.split('::')).toHaveLength(4);
        expect(key.startsWith('saga::::')).toBe(true);
    });

    it('changes when scope flips (book vs saga)', () => {
        const a = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }],
            scope: 'book',
        }));
        const b = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }],
            scope: 'saga',
        }));
        expect(a).not.toBe(b);
    });

    it('changes when the field label changes', () => {
        const a = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }],
            actionNotesFieldLabel: 'Action Notes',
        }));
        const b = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }],
            actionNotesFieldLabel: 'Notes',
        }));
        expect(a).not.toBe(b);
    });

    it('preserves scene order in the key', () => {
        const ab = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'a.md' }, { filePath: 'b.md' }],
        }));
        const ba = buildBriefingPurgeAvailabilityKey(input({
            scenes: [{ filePath: 'b.md' }, { filePath: 'a.md' }],
        }));
        expect(ab).not.toBe(ba);
    });
});
