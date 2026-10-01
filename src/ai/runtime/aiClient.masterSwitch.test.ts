import { describe, expect, it, vi } from 'vitest';
import type RadialTimelinePlugin from '../../main';
import type { AIRunRequest } from '../types';
import { t } from '../../i18n';
import { AIClient } from './aiClient';

/**
 * "AI off sends nothing" (docs/privacy-and-security.md) is enforced in the
 * client, not only by hiding commands: a feature whose entry point stays
 * visible while AI is off (the Timeline audit AI scan, the runtime estimator's
 * AI mode) must still be refused before any provider work starts.
 */
describe('AI client master switch', () => {
    const request = {
        feature: 'Gossamer',
        task: 'BeatMomentumAnalysis',
        requiredCapabilities: ['jsonStrict'],
        featureModeInstructions: 'Score the beats.',
        userInput: 'Manuscript text that must not leave the vault.',
        returnType: 'json'
    } as unknown as AIRunRequest; // SAFE: minimal request; the switch refuses before any field is read

    const offClient = () => {
        const plugin = { settings: { enableAiSceneAnalysis: false } } as unknown as RadialTimelinePlugin; // SAFE: the refusal reads only the master switch
        const client = new AIClient(plugin);
        const registry = vi.spyOn(client, 'refreshRegistry');
        return { client, registry };
    };

    it('refuses a run while AI is off, before the model registry or any provider is touched', async () => {
        const { client, registry } = offClient();
        const result = await client.run(request);
        expect(result.aiStatus).toBe('unavailable');
        expect(result.content).toBeNull();
        expect(result.error).toBe(t('notices.aiTurnedOff'));
        expect(registry).not.toHaveBeenCalled();
    });

    it('refuses a run estimate (which can call a provider token-count endpoint) while AI is off', async () => {
        const { client, registry } = offClient();
        const prepared = await client.prepareRunEstimate(request);
        expect(prepared.ok).toBe(false);
        expect(registry).not.toHaveBeenCalled();
    });
});
