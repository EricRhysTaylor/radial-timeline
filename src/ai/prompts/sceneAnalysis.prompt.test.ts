import { describe, expect, it } from 'vitest';
import { buildSceneAnalysisPrompt } from './sceneAnalysis';

describe('Scene analysis prompt boundaries', () => {
    it('includes empty boundary arrays for a single-scene prompt', () => {
        const prompt = buildSceneAnalysisPrompt(
            null,
            'Current scene body',
            null,
            '0',
            '1',
            '2',
            undefined,
            { currentRefId: 'scn_current01' }
        );

        expect(prompt).toContain('"previousSceneAnalysis": []');
        expect(prompt).toContain('"nextSceneAnalysis": []');
    });

    it('includes an empty previous array for first-scene prompts', () => {
        const prompt = buildSceneAnalysisPrompt(
            null,
            'Current scene body',
            'Next scene body',
            '0',
            '1',
            '2',
            undefined,
            { currentRefId: 'scn_current01', nextRefId: 'scn_next02' }
        );

        expect(prompt).toContain('"previousSceneAnalysis": []');
    });

    it('includes an empty next array for last-scene prompts', () => {
        const prompt = buildSceneAnalysisPrompt(
            'Previous scene body',
            'Current scene body',
            null,
            '1',
            '2',
            '3',
            undefined,
            { prevRefId: 'scn_prev01', currentRefId: 'scn_current02' }
        );

        expect(prompt).toContain('"nextSceneAnalysis": []');
    });
});
