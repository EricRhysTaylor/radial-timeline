import { describe, it, expect } from 'vitest';
import {
    isInquiryResultError,
    isInquiryResultDegraded,
    resolveInquirySessionStatus,
    resolveInquirySessionStatusFromResult,
} from './inquiryResultStatus';
import type { InquiryResult, InquiryFinding } from '../state';
import type { InquirySession } from '../sessionTypes';

// Test fixtures are deliberately tiny — we're characterizing the boolean/enum
// dispatch, not the full InquiryResult shape. Cast-via-unknown keeps the
// fixtures free of every optional field on the real type.
function result(overrides: Partial<InquiryResult> & { findings?: InquiryFinding[] } = {}): InquiryResult {
    return {
        findings: [],
        ...overrides,
    } as unknown as InquiryResult;
}

function session(overrides: Partial<InquirySession> = {}): InquirySession {
    return {
        key: overrides.key ?? 'k1',
        result: overrides.result ?? result(),
        ...overrides,
    } as unknown as InquirySession;
}

function finding(kind: InquiryFinding['kind']): InquiryFinding {
    return { kind } as unknown as InquiryFinding;
}

describe('isInquiryResultError', () => {
    it('returns false for null/undefined', () => {
        expect(isInquiryResultError(null)).toBe(false);
        expect(isInquiryResultError(undefined)).toBe(false);
    });

    it('returns false when aiStatus is success', () => {
        expect(isInquiryResultError(result({ aiStatus: 'success' }))).toBe(false);
    });

    it('returns false when aiStatus is degraded (degraded is usable, not erroneous)', () => {
        expect(isInquiryResultError(result({ aiStatus: 'degraded' }))).toBe(false);
    });

    it('returns true when aiStatus is anything else (e.g. rejected)', () => {
        expect(isInquiryResultError(result({ aiStatus: 'rejected' as InquiryResult['aiStatus'] }))).toBe(true);
    });

    it('returns true when any finding has kind="error"', () => {
        expect(isInquiryResultError(result({ findings: [finding('quote'), finding('error')] }))).toBe(true);
    });

    it('returns false when no findings and aiStatus is absent', () => {
        expect(isInquiryResultError(result({ findings: [] }))).toBe(false);
    });
});

describe('isInquiryResultDegraded', () => {
    it('returns false for null/undefined', () => {
        expect(isInquiryResultDegraded(null)).toBe(false);
        expect(isInquiryResultDegraded(undefined)).toBe(false);
    });

    it('returns true when aiStatus is degraded', () => {
        expect(isInquiryResultDegraded(result({ aiStatus: 'degraded' }))).toBe(true);
    });

    it('returns true when aiReason is recovered_invalid_response', () => {
        expect(isInquiryResultDegraded(result({ aiReason: 'recovered_invalid_response' }))).toBe(true);
    });

    it('returns false on plain success', () => {
        expect(isInquiryResultDegraded(result({ aiStatus: 'success' }))).toBe(false);
    });
});

describe('resolveInquirySessionStatus', () => {
    it('returns "simulated" when the simulated flag is on, regardless of result', () => {
        const s = session({ status: 'saved', result: result({ findings: [finding('error')] }) });
        expect(resolveInquirySessionStatus(s, { simulated: true })).toBe('simulated');
    });

    it('returns the persisted status when set', () => {
        expect(resolveInquirySessionStatus(session({ status: 'saved' }))).toBe('saved');
        expect(resolveInquirySessionStatus(session({ status: 'error' }))).toBe('error');
    });

    it('returns "error" when result is erroneous and no status persisted', () => {
        expect(
            resolveInquirySessionStatus(session({ result: result({ findings: [finding('error')] }) }))
        ).toBe('error');
    });

    it('returns "saved" when briefPath is present and no error', () => {
        expect(resolveInquirySessionStatus(session({ briefPath: 'briefs/q1.md' }))).toBe('saved');
    });

    it('falls through to "unsaved"', () => {
        expect(resolveInquirySessionStatus(session())).toBe('unsaved');
    });

    it('precedence: simulated > status > error > saved > unsaved', () => {
        // status set, result errored, briefPath present, simulated wins
        const s = session({
            status: 'saved',
            briefPath: 'b.md',
            result: result({ findings: [finding('error')] })
        });
        expect(resolveInquirySessionStatus(s, { simulated: true })).toBe('simulated');
        // simulated off → status wins over error/saved
        expect(resolveInquirySessionStatus(s)).toBe('saved');
        // strip status → error wins over saved
        expect(resolveInquirySessionStatus({ ...s, status: undefined } as InquirySession)).toBe('error');
    });
});

describe('resolveInquirySessionStatusFromResult', () => {
    it('returns "simulated" when flag is on', () => {
        expect(resolveInquirySessionStatusFromResult(result(), { simulated: true })).toBe('simulated');
    });

    it('returns "error" for erroneous results', () => {
        expect(
            resolveInquirySessionStatusFromResult(result({ findings: [finding('error')] }))
        ).toBe('error');
    });

    it('returns "unsaved" for plain results (no persistence in this codepath)', () => {
        expect(resolveInquirySessionStatusFromResult(result())).toBe('unsaved');
    });
});
