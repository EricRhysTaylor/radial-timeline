import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('Local LLM contract cleanup', () => {
    it('removes loose local settings reads from scene analysis and AI settings UI', () => {
        const processor = readFileSync(new URL('./Processor.ts', import.meta.url), 'utf8');
        const service = readFileSync(new URL('../services/SceneAnalysisService.ts', import.meta.url), 'utf8');
        const aiSection = readFileSync(new URL('../settings/sections/AiSection.ts', import.meta.url), 'utf8');

        expect(processor.includes('localLlmInstructions')).toBe(false);
        expect(processor.includes('localSendPulseToAiReport')).toBe(false);
        expect(processor.includes('sendPulseToAiReport')).toBe(false);
        expect(processor.includes('getLocalLlmSettings')).toBe(false);
        expect(service.includes('localSendPulseToAiReport')).toBe(false);
        expect(service.includes('sendPulseToAiReport')).toBe(false);
        expect(aiSection.includes('localLlmInstructions')).toBe(false);
        expect(aiSection.includes('localSendPulseToAiReport')).toBe(false);
        expect(aiSection.includes(".setName('Bypass scene hover writes')")).toBe(false);
        expect(aiSection.includes('aiSettings.localLlm')).toBe(true);
    });

    it('logs validation failures and renders review warning seams', () => {
        const provider = readFileSync(new URL('./aiProvider.ts', import.meta.url), 'utf8');
        const synopsis = readFileSync(new URL('../SynopsisManager.ts', import.meta.url), 'utf8');
        const styles = readFileSync(new URL('../styles/scenes.css', import.meta.url), 'utf8');

        expect(provider.includes("status: parseFailure ? 'error' : 'success'")).toBe(true);
        expect(provider.includes('normalizationWarnings: parseFailure ? [parseFailure] : undefined')).toBe(true);
        expect(provider.includes('diagnostics: runResult.diagnostics')).toBe(true);
        expect(synopsis.includes('Pulse Review Warning')).toBe(true);
        expect(styles.includes('.rt-hover-metadata-line.is-pulse-review-warning')).toBe(true);
    });
});
