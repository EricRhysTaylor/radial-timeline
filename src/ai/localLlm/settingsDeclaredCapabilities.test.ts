import { describe, expect, it } from 'vitest';
import { resolveLocalLlmModelInfo } from './settings';
import { buildDefaultAiSettings } from '../settings/aiSettings';
import type { AiSettingsV1 } from '../types';

/*
 * The registry gives every local model a fixed ['jsonStrict'] baseline because
 * no local backend reports what its model can do. That made features with a
 * higher floor (Summary refresh, Pulse, Runtime, Timeline audit, Gossamer)
 * permanently unreachable on the local path — the thrown error told authors to
 * "run a local model that declares these capabilities" when no declaration
 * mechanism existed. These tests pin the mechanism.
 */
const buildSettings = (declared: AiSettingsV1['localLlm']['declaredCapabilities']): AiSettingsV1 => {
    const settings = buildDefaultAiSettings();
    settings.localLlm = {
        ...settings.localLlm,
        defaultModelId: 'qwen/qwen3-30b-a3b-2507',
        declaredCapabilities: declared
    };
    return settings;
};

describe('resolveLocalLlmModelInfo declared capabilities', () => {
    it('keeps the jsonStrict-only baseline when nothing is declared', () => {
        const model = resolveLocalLlmModelInfo(buildSettings([]));
        expect(model.capabilities).toEqual(['jsonStrict']);
    });

    it('merges declared capabilities on top of the baseline', () => {
        const model = resolveLocalLlmModelInfo(buildSettings(['reasoningStrong']));
        expect(model.capabilities).toContain('jsonStrict');
        expect(model.capabilities).toContain('reasoningStrong');
    });

    it('never drops the baseline, whatever is declared', () => {
        const model = resolveLocalLlmModelInfo(
            buildSettings(['reasoningStrong', 'longContext', 'highOutputCap'])
        );
        expect(model.capabilities).toContain('jsonStrict');
        expect(new Set(model.capabilities).size).toBe(model.capabilities.length);
    });
});
