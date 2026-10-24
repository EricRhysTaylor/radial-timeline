import { describe, expect, it } from 'vitest';
import { estimateRuntime, extractRuntimeBody, formatRuntimeValue, hasPerformableText, parseRuntimeField, type RuntimeSettings } from './runtimeEstimator';

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

    it('narrates a prose aside in brackets but times a directive instead of reading it', () => {
        const result = estimateRuntime('He takes calculated (and maybe not so calculated) risks. (beat) Then (30s) he goes.', settings);
        expect(result.actionWords).toBe(12);
        expect(result.directiveCounts).toEqual({ beat: 1, explicit: 1 });
        expect(result.directiveSeconds).toBe(31);
        expect(result.totalSeconds).toBe(37);
    });

    it('leaves every screenplay parenthetical out of the word count', () => {
        const screenplay = { ...settings, contentType: 'screenplay', dialogueWpm: 60, actionWpm: 60 } as RuntimeSettings;
        const result = estimateRuntime('She turns. (quietly) "Go now." (beat)', screenplay);
        expect(result.dialogueWords).toBe(2);
        expect(result.actionWords).toBe(2);
        expect(result.directiveCounts).toEqual({ beat: 1 });
    });
});

describe('extractRuntimeBody', () => {
    it('keeps only the manuscript text a narrator would read', () => {
        const note = [
            '---',
            'Class: Scene',
            'Runtime: 1:00',
            '---',
            'She runs to [[Teco|the dog]] and [[Shail Didio Trax Fairchild|Shail]]. ^para-1',
            '%%private note about pacing%%',
            'Then %%query: is this clear?%% she stops. <!-- old line -->',
            '',
            '> [!ai] Suggested rewrite',
            '> A whole paragraph of suggestion.',
            '',
            '```editorialist-review',
            'batch: pass one',
            '```',
            '',
            'See [the map](map.png).',
        ].join('\n');

        expect(extractRuntimeBody(note).replace(/\s+/g, ' ')).toBe('She runs to the dog and Shail. Then she stops. See the map.');
    });
});

describe('hasPerformableText', () => {
    it('needs a letter or digit, in any script', () => {
        expect(hasPerformableText('')).toBe(false);
        expect(hasPerformableText('  \n---\n* * *\n')).toBe(false);
        expect(hasPerformableText('Go.')).toBe(true);
        expect(hasPerformableText('42')).toBe(true);
        expect(hasPerformableText('她走了。')).toBe(true);
    });
});
