import { describe, expect, it } from 'vitest';
import {
    appendInquiryNotesToPendingEdits,
    purgeInquiryNotesFromPendingEdits,
    validatePendingEditsValue,
} from './pendingEditsSafety';

describe('pendingEditsSafety', () => {
    it('refuses malformed non-string structures', () => {
        const result = validatePendingEditsValue({ notes: 'bad' });
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('not stored as text');
    });

    it('refuses non-string array entries', () => {
        const result = validatePendingEditsValue(['safe', 42]);
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('non-string list value');
    });

    it('refuses malformed inquiry markers (unclosed bracket)', () => {
        const result = appendInquiryNotesToPendingEdits(
            'Keep this\n[[IB-260526-1022 missing close',
            'IB-260526-1023',
            ['[[IB-260526-1023|May 26]] S1 Add this'],
            5
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('malformed Inquiry lines');
    });

    it('refuses duplicate inquiry markers', () => {
        const result = appendInquiryNotesToPendingEdits(
            '[[Inquiry Brief — Test]] — One\n[[Inquiry Brief — Test]] — Two',
            'Inquiry Brief — New',
            ['[[Inquiry Brief — New]] — Add this'],
            5
        );
        expect(result.ok).toBe(false);
        expect(result.reason).toContain('duplicate Inquiry markers');
    });

    it('appends a valid inquiry note', () => {
        const result = appendInquiryNotesToPendingEdits(
            'Existing line',
            'Inquiry Brief — New',
            ['[[Inquiry Brief — New]] — Add this'],
            5
        );
        expect(result.ok).toBe(true);
        expect(result.outcome).toBe('written');
        expect(result.value).toContain('Existing line');
        expect(result.value).toContain('[[Inquiry Brief — New]] — Add this');
    });

    it('purges only RT-owned inquiry lines', () => {
        const result = purgeInquiryNotesFromPendingEdits(
            'Keep this\n[[Inquiry Brief — Test]] — Remove this'
        );
        expect(result.ok).toBe(true);
        expect(result.outcome).toBe('written');
        expect(result.value).toBe('Keep this');
    });

    it('accepts the compact IB-YYMMDD-HHMM marker with no em-dash separators', () => {
        const result = appendInquiryNotesToPendingEdits(
            'Existing line',
            'IB-260526-1022',
            ['[[IB-260526-1022|May 26]] S1 Hybrid taxonomy primer'],
            5
        );
        expect(result.ok).toBe(true);
        expect(result.outcome).toBe('written');
        expect(result.value).toContain('[[IB-260526-1022|May 26]] S1 Hybrid taxonomy primer');
    });

    it('dedupes a compact marker by ID, ignoring alias drift', () => {
        const result = appendInquiryNotesToPendingEdits(
            '[[IB-260526-1022|May 26]] S1 prior note',
            'IB-260526-1022',
            ['[[IB-260526-1022|May 26]] S2 second action'],
            5
        );
        expect(result.ok).toBe(true);
        expect(result.outcome).toBe('duplicate');
    });

    it('tolerates legacy and compact markers coexisting in the same field', () => {
        const result = validatePendingEditsValue(
            'Keep this\n[[Inquiry Brief — Old run]] — S1 — legacy\n[[IB-260526-1022|May 26]] S2 compact'
        );
        expect(result.ok).toBe(true);
    });

    it('purges compact IB- markers alongside legacy ones', () => {
        const result = purgeInquiryNotesFromPendingEdits(
            'Keep this\n[[IB-260526-1022|May 26]] S1 remove\n[[Inquiry Brief — Old]] — S1 — remove'
        );
        expect(result.ok).toBe(true);
        expect(result.outcome).toBe('written');
        expect(result.value).toBe('Keep this');
    });
});
