import { describe, expect, it } from 'vitest';
import {
    buildUnifiedBeatAnalysisCacheParts,
    buildUnifiedBeatAnalysisPrompt,
    buildUnifiedBeatAnalysisPromptParts
} from './unifiedBeatAnalysis';

describe('buildUnifiedBeatAnalysisCacheParts', () => {
    const beats = [
        { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-10' },
        { beatName: 'Catalyst', beatNumber: 2, idealRange: '10-20' }
    ];
    const MANUSCRIPT = 'The manuscript body that must be cached.';

    it('keeps the manuscript in the stable half and the rubric in the volatile half', () => {
        const { stableInput, volatileQuestion } = buildUnifiedBeatAnalysisCacheParts(MANUSCRIPT, beats, 'Save The Cat', 'momentum');
        // Stable half carries the corpus + beat list; the rubric never leaks into it.
        expect(stableInput.includes(MANUSCRIPT)).toBe(true);
        expect(stableInput.includes('Story beats:')).toBe(true);
        expect(stableInput.includes('Score MOMENTUM')).toBe(false);
        // Volatile half carries the per-signal rubric + response contract, never the corpus.
        expect(volatileQuestion.includes('Score MOMENTUM')).toBe(true);
        expect(volatileQuestion.includes('set "signal" to "momentum"')).toBe(true);
        expect(volatileQuestion.includes(MANUSCRIPT)).toBe(false);
    });

    it('produces a byte-identical stable half across all four signals (cross-signal cache reuse)', () => {
        const signals = ['momentum', 'tension', 'activity', 'interiority'] as const;
        const stableHalves = signals.map(s => buildUnifiedBeatAnalysisCacheParts(MANUSCRIPT, beats, 'Save The Cat', s).stableInput);
        const volatileHalves = signals.map(s => buildUnifiedBeatAnalysisCacheParts(MANUSCRIPT, beats, 'Save The Cat', s).volatileQuestion);
        // The cacheable prefix must not vary by signal...
        expect(new Set(stableHalves).size).toBe(1);
        // ...while the volatile rubric must differ for every signal.
        expect(new Set(volatileHalves).size).toBe(signals.length);
    });
});

describe('buildUnifiedBeatAnalysisPromptParts', () => {
    it('recombines into the canonical unified beat prompt', () => {
        const beats = [
            { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-10' },
            { beatName: 'Catalyst', beatNumber: 2, idealRange: '10-20' }
        ];
        const parts = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');

        expect(parts.prompt).toBe(buildUnifiedBeatAnalysisPrompt('Scene body', beats, 'Save The Cat'));
        expect(parts.transformText.includes('Story beats:')).toBe(true);
        expect(parts.instructionText.includes('Respond strictly in the provided JSON schema')).toBe(true);
    });

    it('falls back to `N. Name` when placement is absent', () => {
        const beats = [
            { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-10' }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).toContain('1. Opening Image');
        expect(transformText).not.toContain('[');
        expect(transformText).not.toContain(' — ');
    });

    it('uses placement-only prefix (no duplicated ordinal) when placement is provided', () => {
        const beats = [
            {
                beatName: 'Opening Image',
                beatNumber: 1,
                idealRange: '0-10',
                placement: '1.01',
                description: 'Mrs Bennet pushes for a wealthy suitor.'
            }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).toContain('[1.01] Opening Image — Mrs Bennet pushes for a wealthy suitor.');
        expect(transformText).not.toContain('1. [1.01]');
    });

    it('does not send idealRange to the AI (anchoring guard)', () => {
        const beats = [
            { beatName: 'Midpoint', beatNumber: 1, idealRange: '40-60' }
        ];
        const { prompt } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(prompt).not.toContain('40-60');
        expect(prompt).not.toContain('idealRange');
    });

    // REGRESSION GUARD (2026-05-23): the multi-signal refactor wired fm.Synopsis
    // (a nonexistent beat field) as the description source, so every beat shipped
    // as a bare label for a month. Tests below pin the contract that descriptions,
    // when provided, MUST render into the prompt — and a sibling source-grep test
    // in GossamerCommands.test.ts pins that GossamerCommands populates them via
    // the canonical readBeatPurpose helper.
    it('renders the beat description after an em-dash when provided', () => {
        const beats = [
            {
                beatName: 'Opening Image',
                beatNumber: 1,
                idealRange: '0-10',
                placement: '0.01',
                description: 'Trisan grinds through Academy training despite his failing hip.'
            }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).toContain('— Trisan grinds through Academy training despite his failing hip.');
    });

    it('omits the em-dash when description is missing entirely', () => {
        const beats = [
            { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-10', placement: '0.01' }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).toContain('[0.01] Opening Image');
        expect(transformText).not.toContain('—');
    });

    it('omits the em-dash when description is a whitespace-only string', () => {
        const beats = [
            { beatName: 'Opening Image', beatNumber: 1, idealRange: '0-10', placement: '0.01', description: '   ' }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).not.toContain('—');
    });

    it('multiple beats each carry their own description', () => {
        const beats = [
            { beatName: 'Opening', beatNumber: 1, idealRange: '0-10', placement: '0.01', description: 'World establishes.' },
            { beatName: 'Catalyst', beatNumber: 2, idealRange: '10-20', placement: '10.01', description: 'Inciting event.' }
        ];
        const { transformText } = buildUnifiedBeatAnalysisPromptParts('Scene body', beats, 'Save The Cat');
        expect(transformText).toContain('— World establishes.');
        expect(transformText).toContain('— Inciting event.');
    });
});
