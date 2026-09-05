import { describe, expect, it } from 'vitest';
import { buildPassIndicator, evaluateInquiryReadiness } from './readiness';

describe('readiness', () => {
    it('returns ready when within safe budget', () => {
        const state = evaluateInquiryReadiness({
            hasEligibleModel: true,
            hasCredential: true,
            estimatedInputTokens: 40000,
            safeInputBudget: 100000
        });
        expect(state.state).toBe('ready');
        expect(state.cause).toBe('ok');
        expect(state.pressureTone).toBe('normal');
    });

    it('returns large when automatic multi-pass can absorb over-budget input', () => {
        const state = evaluateInquiryReadiness({
            hasEligibleModel: true,
            hasCredential: true,
            estimatedInputTokens: 120000,
            safeInputBudget: 100000
        });
        expect(state.state).toBe('large');
        expect(state.cause).toBe('multi_pass_expected');
        expect(state.pressureTone).toBe('red');
    });

    it('returns ready when corpus fits in budget', () => {
        const state = evaluateInquiryReadiness({
            hasEligibleModel: true,
            hasCredential: true,
            estimatedInputTokens: 40000,
            safeInputBudget: 100000
        });
        expect(state.state).toBe('ready');
        expect(state.cause).toBe('ok');
    });

    it('returns blocked when capability floor is not met', () => {
        const state = evaluateInquiryReadiness({
            hasEligibleModel: false,
            hasCredential: true,
            estimatedInputTokens: 20000,
            safeInputBudget: 100000
        });
        expect(state.state).toBe('blocked');
        expect(state.cause).toBe('capability_floor');
    });

    it('returns blocked when key is missing', () => {
        const state = evaluateInquiryReadiness({
            hasEligibleModel: true,
            hasCredential: false,
            estimatedInputTokens: 20000,
            safeInputBudget: 100000
        });
        expect(state.state).toBe('blocked');
        expect(state.cause).toBe('missing_key');
    });

    it('renders no pass marks for zero or single-pass runs', () => {
        expect(buildPassIndicator().visible).toBe(false);
        expect(buildPassIndicator(1).visible).toBe(false);
    });

    it('renders marks for multi-pass execution', () => {
        const marks = buildPassIndicator(2);
        expect(marks.visible).toBe(true);
        expect(marks.marks).toBe('++');
        expect(marks.extraPassCount).toBe(1);
        expect(marks.totalPassCount).toBe(2);
        expect(marks.exactCount).toBe(2);
    });

    it('caps visible marks to five while preserving exact count', () => {
        const marks = buildPassIndicator(9);
        expect(marks.visible).toBe(true);
        expect(marks.marks).toBe('+++++');
        expect(marks.visibleCount).toBe(5);
        expect(marks.extraPassCount).toBe(8);
        expect(marks.totalPassCount).toBe(9);
        expect(marks.exactCount).toBe(9);
    });

    it('shows a single expected mark when multi-pass is predicted but pass count is unknown', () => {
        const marks = buildPassIndicator(undefined, true);
        expect(marks.visible).toBe(true);
        expect(marks.marks).toBe('+');
        expect(marks.expectedOnly).toBe(true);
        expect(marks.totalPassCount).toBe(2);
        expect(marks.extraPassCount).toBe(1);
        expect(marks.exactCount).toBeNull();
    });

    it('uses estimated pass count for predicted multi-pass markers', () => {
        const marks = buildPassIndicator(undefined, true, 4);
        expect(marks.visible).toBe(true);
        expect(marks.marks).toBe('+');
        expect(marks.visibleCount).toBe(1);
        expect(marks.expectedOnly).toBe(true);
        expect(marks.totalPassCount).toBe(4);
        expect(marks.extraPassCount).toBe(3);
        expect(marks.exactCount).toBeNull();
    });
});
