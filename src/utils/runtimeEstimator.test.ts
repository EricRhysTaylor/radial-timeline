import { describe, expect, it } from 'vitest';
import { estimateRuntime, formatRuntimeValue, parseRuntimeField, type RuntimeSettings } from './runtimeEstimator';

describe('parseRuntimeField', () => {
    it('reads clock, unit, and bare-number forms as seconds', () => {
        expect(parseRuntimeField('1:30')).toBe(90);
        expect(parseRuntimeField('1:02:03')).toBe(3723);
        expect(parseRuntimeField('2m 15s')).toBe(135);
        expect(parseRuntimeField('45s')).toBe(45);
        expect(parseRuntimeField('3 min')).toBe(180);
        expect(parseRuntimeField('1.5h')).toBe(5400);
        expect(parseRuntimeField('42')).toBe(42);
        expect(parseRuntimeField(7)).toBe(7);
    });

    it('returns null for empty or unreadable input and 0 for zero', () => {
        expect(parseRuntimeField(undefined)).toBeNull();
        expect(parseRuntimeField('')).toBeNull();
        expect(parseRuntimeField('soon')).toBeNull();
        expect(parseRuntimeField('0')).toBe(0);
    });
});

describe('formatRuntimeValue', () => {
    it('formats minutes and hours with zero padding', () => {
        expect(formatRuntimeValue(0)).toBe('0:00');
        expect(formatRuntimeValue(65)).toBe('1:05');
        expect(formatRuntimeValue(3723)).toBe('1:02:03');
    });
});

describe('estimateRuntime', () => {
    const settings = {
        contentType: 'prose',
        dialogueWpm: 150,
        actionWpm: 150,
        narrationWpm: 120,
        beatSeconds: 1,
        pauseSeconds: 2,
        longPauseSeconds: 4,
        momentSeconds: 3,
        silenceSeconds: 5
    } as unknown as RuntimeSettings; // SAFE: the fields the estimator reads for prose

    it('is zero for empty content', () => {
        expect(estimateRuntime('   ', settings).totalSeconds).toBe(0);
    });

    it('counts every word as narration for prose at the narration rate', () => {
        const result = estimateRuntime(Array.from({ length: 120 }, (_, i) => `w${i}`).join(' '), settings);
        expect(result.actionWords).toBe(120);
        expect(result.dialogueWords).toBe(0);
        expect(result.totalSeconds).toBe(60);
    });
});
