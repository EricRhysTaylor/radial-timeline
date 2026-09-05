import { describe, it, expect } from 'vitest';
import { parseRemotePrompt, shouldAdoptRemotePrompt } from './promptSync';
import { ONBOARDING_SCHEMA_VERSION } from '../ai/prompts/onboarding';

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
