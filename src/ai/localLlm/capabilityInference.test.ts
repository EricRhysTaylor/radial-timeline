import { describe, expect, it } from 'vitest';
import { inferLocalLlmCapability, LOCAL_LLM_TIER_FEATURES } from './capabilityInference';
import type { LocalLlmDiagnosticsReport } from './diagnostics';

const buildDiagnostics = (overrides: Partial<LocalLlmDiagnosticsReport> = {}): LocalLlmDiagnosticsReport => ({
    backend: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    modelId: 'mistral-nemo:12b',
    reachable: { ok: true, message: 'Ollama responded with 4 models.' },
    modelAvailable: { ok: true, message: 'Model "mistral-nemo:12b" is available.' },
    basicCompletion: { ok: true, message: 'Basic completion succeeded.' },
    structuredJson: { ok: true, message: 'Structured JSON path succeeded.' },
    repairPath: { ok: true, message: 'Repair path self-check succeeded.' },
    ...overrides
});

describe('inferLocalLlmCapability', () => {
    it('returns tier 0 when backend validation fails', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'llama3.1:8b',
            diagnostics: buildDiagnostics({
                reachable: { ok: false, message: 'connect timeout' }
            })
        });
        expect(assessment.tier).toBe(0);
        expect(assessment.confidence).toBe('validated');
    });

    it('returns tier 1 when structured JSON fails', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'llama3.1:8b',
            declaredCapabilities: ['reasoningStrong', 'longContext', 'highOutputCap'],
            diagnostics: buildDiagnostics({
                structuredJson: { ok: false, message: 'Expected object but got markdown.' }
            })
        });
        expect(assessment.tier).toBe(1);
        expect(assessment.featureSupport).toEqual(LOCAL_LLM_TIER_FEATURES[1]);
    });

    it('returns tier 4 for a validated strong local model', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'mistral-nemo:12b',
            contextWindow: 131072,
            maxOutput: 8192,
            declaredCapabilities: ['reasoningStrong', 'longContext', 'highOutputCap'],
            diagnostics: buildDiagnostics()
        });
        expect(assessment.tier).toBe(4);
        expect(assessment.featureSupport.inquiry).toBe('yes');
    });

    /*
     * The tier heuristic and the runtime capability floor used to disagree in
     * public: a 30B model read as "Tier 4 — Full — Summary yes" in settings
     * while every Summary refresh scene threw "lacks required capability:
     * reasoningStrong". A tier still describes how capable the model *looks*;
     * featureSupport must describe what RT will actually dispatch.
     */
    it('reports no feature support until the author declares the capabilities the runtime requires', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'qwen/qwen3-30b-a3b-2507',
            contextWindow: 131072,
            maxOutput: 8192,
            diagnostics: buildDiagnostics({ modelId: 'qwen/qwen3-30b-a3b-2507' })
        });
        expect(assessment.tier).toBe(4);
        expect(assessment.featureSupport).toEqual({
            summary: 'no',
            pulses: 'no',
            gossamer: 'no',
            inquiry: 'no'
        });
        expect(assessment.explanation).toContain('reasoningStrong');
    });

    it('unlocks only the features whose declared capability floor is met', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'qwen/qwen3-30b-a3b-2507',
            contextWindow: 131072,
            maxOutput: 8192,
            declaredCapabilities: ['reasoningStrong'],
            diagnostics: buildDiagnostics({ modelId: 'qwen/qwen3-30b-a3b-2507' })
        });
        expect(assessment.featureSupport.summary).toBe('yes');
        expect(assessment.featureSupport.pulses).toBe('yes');
        // Gossamer and Inquiry also need longContext + highOutputCap.
        expect(assessment.featureSupport.gossamer).toBe('no');
        expect(assessment.featureSupport.inquiry).toBe('no');
    });

    it('returns a conservative heuristic tier for an unvalidated 8B model', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'llama3.1:8b',
            contextWindow: 32768,
            maxOutput: 4096
        });
        expect(assessment.tier).toBe(3);
        expect(assessment.confidence).toBe('heuristic');
    });

    it('keeps models without clear size hints conservative', () => {
        const assessment = inferLocalLlmCapability({
            modelId: 'local-model',
            contextWindow: 32768,
            maxOutput: 2048
        });
        expect(assessment.tier).toBe(2);
    });
});
