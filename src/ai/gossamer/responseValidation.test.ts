import { describe, expect, it } from 'vitest';
import {
    normalizeBeatLabelForMatch,
    validateGossamerResponse,
    type SubmittedBeat
} from './responseValidation';

const SUBMITTED: SubmittedBeat[] = [
    { beatName: 'Opening Image', placement: '0.01' },
    { beatName: 'Catalyst', placement: '10.01' },
    { beatName: 'Midpoint', placement: '31.01' }
];

function goldenResponse(signal: string = 'activity') {
    return {
        beats: [
            { beatName: 'Opening Image', signal, score: 65, justification: 'Trains hard.' },
            { beatName: 'Catalyst', signal, score: 70, justification: 'Char fails.' },
            { beatName: 'Midpoint', signal, score: 80, justification: 'Diga reveal.' }
        ],
        overallAssessment: { summary: 'x', strengths: [], improvements: [] }
    };
}

describe('normalizeBeatLabelForMatch', () => {
    it('strips a bracketed placement prefix and is case-insensitive', () => {
        expect(normalizeBeatLabelForMatch('[0.01] Opening Image')).toBe('opening image');
    });

    it('strips a non-bracketed ordinal prefix like "1. "', () => {
        expect(normalizeBeatLabelForMatch('1. Opening Image')).toBe('opening image');
    });

    it('strips the em-dash suffix so descriptions do not break matching', () => {
        expect(normalizeBeatLabelForMatch('[0.01] Opening Image — Trisan grinds through training.')).toBe('opening image');
    });

    it('handles bare beat names without a prefix', () => {
        expect(normalizeBeatLabelForMatch('Opening Image')).toBe('opening image');
    });

    it('returns empty string for non-string input', () => {
        expect(normalizeBeatLabelForMatch(undefined)).toBe('');
        expect(normalizeBeatLabelForMatch(null)).toBe('');
        expect(normalizeBeatLabelForMatch(42)).toBe('');
    });

    it('two equivalent labels normalize to the same key', () => {
        expect(normalizeBeatLabelForMatch('[0.01] Opening Image — purpose'))
            .toBe(normalizeBeatLabelForMatch('Opening Image'));
    });
});

describe('validateGossamerResponse — golden path', () => {
    it('returns ok and strongly-typed beats when every field matches', () => {
        const result = validateGossamerResponse(goldenResponse(), SUBMITTED, 'activity');
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.beats).toHaveLength(3);
            expect(result.beats[0]).toEqual({
                beatName: 'Opening Image',
                signal: 'activity',
                score: 65,
                justification: 'Trains hard.'
            });
        }
    });

    it('accepts the bracketed-prefix form the model often echoes', () => {
        const response = goldenResponse();
        response.beats[0].beatName = '[0.01] Opening Image';
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(true);
    });

    it('accepts score 0 and score 100 as valid boundary values', () => {
        const response = goldenResponse();
        response.beats[0].score = 0;
        response.beats[2].score = 100;
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(true);
    });
});

describe('validateGossamerResponse — structural failures', () => {
    it('flags non-object response with a single shape failure', () => {
        const result = validateGossamerResponse(null, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures).toEqual([{ index: -1, code: 'shape', detail: 'response is not an object' }]);
        }
    });

    it('flags missing beats array as a shape failure', () => {
        const result = validateGossamerResponse({ beats: 'not-an-array' }, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures[0].code).toBe('shape');
        }
    });

    it('flags a beat-count mismatch and continues validating the rows it has', () => {
        const response = goldenResponse();
        response.beats.pop();
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures.some(f => f.code === 'count')).toBe(true);
            // The two remaining rows are still validated; if they're fine we
            // get exactly the one count failure.
            expect(result.failures.filter(f => f.code !== 'count')).toHaveLength(0);
        }
    });
});

describe('validateGossamerResponse — per-row failures', () => {
    it('catches a reordered response (beatName at wrong index)', () => {
        const response = goldenResponse();
        // Swap positions 0 and 1 — the original 2026-04-21-class failure mode
        [response.beats[0], response.beats[1]] = [response.beats[1], response.beats[0]];
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const nameFailures = result.failures.filter(f => f.code === 'beatName');
            expect(nameFailures).toHaveLength(2);
            expect(nameFailures.map(f => f.index).sort()).toEqual([0, 1]);
        }
    });

    it('catches a wrong-signal row (model returned momentum when we asked for activity)', () => {
        const response = goldenResponse();
        response.beats[1].signal = 'momentum';
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const signalFailures = result.failures.filter(f => f.code === 'signal');
            expect(signalFailures).toHaveLength(1);
            expect(signalFailures[0].index).toBe(1);
        }
    });

    it('catches missing score and does not fabricate a 0', () => {
        const response = goldenResponse() as { beats: Array<Record<string, unknown>> };
        delete response.beats[0].score;
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures.some(f => f.code === 'score' && f.index === 0)).toBe(true);
        }
    });

    it('catches NaN, Infinity, negative, and >100 scores', () => {
        const cases: unknown[] = [NaN, Infinity, -1, 101, '50', null];
        for (const bad of cases) {
            const response = goldenResponse() as { beats: Array<Record<string, unknown>> };
            response.beats[0].score = bad;
            const result = validateGossamerResponse(response, SUBMITTED, 'activity');
            expect(result.ok, `score=${String(bad)} should fail`).toBe(false);
            if (!result.ok) {
                expect(result.failures.some(f => f.code === 'score' && f.index === 0)).toBe(true);
            }
        }
    });

    it('catches missing or empty justification', () => {
        const response1 = goldenResponse() as { beats: Array<Record<string, unknown>> };
        delete response1.beats[0].justification;
        expect(validateGossamerResponse(response1, SUBMITTED, 'activity').ok).toBe(false);

        const response2 = goldenResponse();
        response2.beats[0].justification = '   ';
        const result = validateGossamerResponse(response2, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures.some(f => f.code === 'justification' && f.index === 0)).toBe(true);
        }
    });

    it('reports every failure across every row, not just the first', () => {
        const response = goldenResponse() as { beats: Array<Record<string, unknown>> };
        response.beats[0].score = -5;       // score failure at 0
        response.beats[1].signal = 'tension'; // signal failure at 1
        delete response.beats[2].justification; // justification failure at 2
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.failures).toHaveLength(3);
            expect(result.failures.map(f => f.code).sort()).toEqual(['justification', 'score', 'signal']);
        }
    });

    it('does not promote a partially-valid row into the ok result', () => {
        // Even on a single row, if any field fails the whole result is fail.
        const response = goldenResponse() as { beats: Array<Record<string, unknown>> };
        response.beats[0].score = NaN;
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
    });
});

describe('validateGossamerResponse — failure detail strings', () => {
    it('includes the index, the submitted name, and the returned value for diagnostics', () => {
        const response = goldenResponse() as { beats: Array<Record<string, unknown>> };
        response.beats[1].score = 999;
        const result = validateGossamerResponse(response, SUBMITTED, 'activity');
        expect(result.ok).toBe(false);
        if (!result.ok) {
            const scoreFailure = result.failures.find(f => f.code === 'score');
            expect(scoreFailure?.detail).toContain('index 1');
            expect(scoreFailure?.detail).toContain('Catalyst');
            expect(scoreFailure?.detail).toContain('999');
        }
    });
});
