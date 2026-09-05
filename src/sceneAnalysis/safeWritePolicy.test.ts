import { describe, expect, it, vi } from 'vitest';
import { applySceneAnalysisSafeWrite, LOCAL_LLM_REVIEW_WARNING } from './safeWritePolicy';
import type { ParsedSceneAnalysis } from './types';

const parsedAnalysis: ParsedSceneAnalysis = {
    previousSceneAnalysis: '',
    currentSceneAnalysis: '- 12 A / Valid',
    nextSceneAnalysis: '',
    sceneGrade: 'A'
};

describe('scene analysis safe write policy', () => {
    it('writes valid Local LLM structured output normally', async () => {
        const writeAnalysis = vi.fn(async () => true);
        const writeWarning = vi.fn(async () => true);

        const result = await applySceneAnalysisSafeWrite({
            provider: 'ollama',
            parsedAnalysis,
            writeAnalysis,
            writeWarning
        });

        expect(result).toEqual({ route: 'write', success: true });
        expect(writeAnalysis).toHaveBeenCalledWith(parsedAnalysis);
        expect(writeWarning).not.toHaveBeenCalled();
    });

    it('does not write malformed Local LLM scene data and sets a warning marker instead', async () => {
        const writeAnalysis = vi.fn(async () => true);
        const writeWarning = vi.fn(async () => true);

        const result = await applySceneAnalysisSafeWrite({
            provider: 'ollama',
            parsedAnalysis: null,
            writeAnalysis,
            writeWarning
        });

        expect(result).toEqual({ route: 'warning', success: true });
        expect(writeAnalysis).not.toHaveBeenCalled();
        expect(writeWarning).toHaveBeenCalledWith(LOCAL_LLM_REVIEW_WARNING);
    });

    it('does not mark a review warning when a valid Local LLM result fails at write time', async () => {
        const writeAnalysis = vi.fn(async () => false);
        const writeWarning = vi.fn(async () => true);

        const result = await applySceneAnalysisSafeWrite({
            provider: 'ollama',
            parsedAnalysis,
            writeAnalysis,
            writeWarning
        });

        expect(result).toEqual({ route: 'write', success: false });
        expect(writeAnalysis).toHaveBeenCalledTimes(1);
        expect(writeWarning).not.toHaveBeenCalled();
    });

    it('skips warning markers for non-local failures', async () => {
        const writeAnalysis = vi.fn(async () => true);
        const writeWarning = vi.fn(async () => true);

        const result = await applySceneAnalysisSafeWrite({
            provider: 'openai',
            parsedAnalysis: null,
            writeAnalysis,
            writeWarning
        });

        expect(result).toEqual({ route: 'skip', success: false });
        expect(writeAnalysis).not.toHaveBeenCalled();
        expect(writeWarning).not.toHaveBeenCalled();
    });
});
