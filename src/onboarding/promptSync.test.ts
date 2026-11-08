import { describe, it, expect, vi } from 'vitest';
import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { parseRemotePrompt, refreshOnboardingPrompt, shouldAdoptRemotePrompt } from './promptSync';
import { ONBOARDING_SCHEMA_VERSION } from '../ai/prompts/onboarding';
import { bindAiNetworkGate } from '../ai/runtime/aiNetworkGate';

vi.mock('../../tests/mocks/obsidian.ts', async importOriginal => ({
  ...await importOriginal<typeof import('obsidian')>(),
  requestUrl: vi.fn(async () => ({ status: 503, json: null, text: '' })),
}));

describe('refreshOnboardingPrompt', () => {
  it('fetches the AI prompt only while AI is on', async () => {
    const plugin = { settings: { enableAiSceneAnalysis: false }, saveSettings: vi.fn() } as unknown as RadialTimelinePlugin; // SAFE: the refresh reads only the master switch and the prompt cache
    await refreshOnboardingPrompt(plugin);
    expect(requestUrl).not.toHaveBeenCalled();
    plugin.settings.enableAiSceneAnalysis = true;
    // The request itself passes the AI network gate, like every other AI request.
    await refreshOnboardingPrompt(plugin);
    expect(requestUrl).not.toHaveBeenCalled();
    const unbind = bindAiNetworkGate(() => plugin.settings.enableAiSceneAnalysis === true);
    try {
      await refreshOnboardingPrompt(plugin);
      expect(requestUrl).toHaveBeenCalledOnce();
    } finally {
      unbind();
    }
  });
});

describe('parseRemotePrompt', () => {
  it('parses the endpoint payload shape', () => {
    const payload = parseRemotePrompt({
      prompt_text: 'ROLE\nYou are migrating…',
      schema_version: 1,
      updated_at: '2026-08-20T16:33:30Z',
    });
    expect(payload).not.toBeNull();
    expect(payload?.promptText.startsWith('ROLE')).toBe(true);
    expect(payload?.schemaVersion).toBe(1);
  });

  it('rejects malformed payloads (untrusted input)', () => {
    expect(parseRemotePrompt(null)).toBeNull();
    expect(parseRemotePrompt('text')).toBeNull();
    expect(parseRemotePrompt({ prompt_text: '', schema_version: 1 })).toBeNull();
    expect(parseRemotePrompt({ prompt_text: 'x', schema_version: 'one' })).toBeNull();
  });
});

describe('shouldAdoptRemotePrompt', () => {
  const payload = { promptText: 'ROLE…', schemaVersion: ONBOARDING_SCHEMA_VERSION, updatedAt: '' };

  it('adopts only at the pinned schema version', () => {
    expect(shouldAdoptRemotePrompt(payload)).toBe(true);
    expect(shouldAdoptRemotePrompt({ ...payload, schemaVersion: ONBOARDING_SCHEMA_VERSION + 1 })).toBe(false);
    expect(shouldAdoptRemotePrompt(null)).toBe(false);
  });
});
