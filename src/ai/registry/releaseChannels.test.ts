import { describe, expect, it } from 'vitest';
import { BUILTIN_MODELS } from './builtinModels';
import { getPickerModelsForProvider, selectLatestModelByReleaseChannel } from './releaseChannels';

/*
 * Release-channel curation against the minimum-viable catalog
 * (2026-05-22). The picker / latest-channel mechanics still exist so
 * the catalog can be re-expanded — these tests pin that the mechanics
 * work against the current shrunk catalog without forcing specific
 * multi-model orderings that no longer apply.
 */

describe('release channel curation', () => {
    it('returns the single curated OpenAI picker entry', () => {
        const picker = getPickerModelsForProvider(BUILTIN_MODELS, 'openai').map(model => model.alias);
        expect(picker).toEqual(['gpt-5.6-sol']);
    });

    it('returns both curated Google picker entries (depth + speed)', () => {
        const picker = getPickerModelsForProvider(BUILTIN_MODELS, 'google').map(model => model.alias);
        // Order is not pinned — only that both lanes appear.
        expect(picker).toHaveLength(2);
        expect(picker).toContain('gemini-3.1-pro-preview');
        expect(picker).toContain('gemini-3.5-flash');
    });

    it('returns the current Anthropic model, the premium pro entry, and the one-back continuity model', () => {
        const picker = getPickerModelsForProvider(BUILTIN_MODELS, 'anthropic').map(model => model.alias);
        // Curated order is [newest-stable, newest-pro], then remainder:
        //   - Opus 5: newest stable, the auto-selected default, offered first.
        //   - Fable 5.1: the 'pro'-channel premium model — visible and pinnable
        //     but never the silent default (it is 2× Opus cost).
        // The leading pair is what carries meaning, so it stays pinned; the
        // remainder is asserted as a set because its internal order is not a
        // product decision.
        expect(picker.slice(0, 2)).toEqual(['claude-opus-5', 'claude-fable-5-1']);
        //   - 4.8: continuity opt-in so in-flight authors aren't force-migrated.
        //   - Sonnet 5 / Haiku 4.5: the BALANCED and FAST task-fit lanes added
        //     2026-08-21. Neither may displace Opus 5 as the default.
        expect(picker.slice(2).sort()).toEqual(
            ['claude-haiku-4-5', 'claude-opus-4.8', 'claude-sonnet-5'].sort()
        );
    });

    it('keeps Claude Fable 5.1 off the stable channel so latest-stable stays Opus 5', () => {
        const stable = selectLatestModelByReleaseChannel(BUILTIN_MODELS, 'anthropic', 'stable');
        expect(stable?.alias).toBe('claude-opus-5');
        const fable = BUILTIN_MODELS.find(model => model.id === 'claude-fable-5-1');
        expect(fable?.rollout?.channel).toBe('pro');
    });

    it('selectLatestModelByReleaseChannel returns the only stable OpenAI model', () => {
        const stable = selectLatestModelByReleaseChannel(BUILTIN_MODELS, 'openai', 'stable');
        // With one stable model, latest-stable resolves to that model.
        // Resolution is by status === 'stable' even without an explicit
        // rollout block.
        expect(stable?.alias).toBe('gpt-5.6-sol');
    });

    it('selectLatestModelByReleaseChannel returns the newest stable Anthropic model', () => {
        const stable = selectLatestModelByReleaseChannel(BUILTIN_MODELS, 'anthropic', 'stable');
        expect(stable?.alias).toBe('claude-opus-5');
    });
});
