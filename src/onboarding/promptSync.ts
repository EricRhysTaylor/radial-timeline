/*
 * Canonical onboarding prompt sync (plan: "The Onboarding Prompt — canonical
 * source & sync"). Supabase holds the single editable instruction block; the
 * plugin ships a bundled snapshot as the offline default and best-effort
 * refreshes from the public endpoint, adopting the remote text ONLY when its
 * schema_version matches the plugin's pinned parser version — a server-side
 * edit can never break a shipped release. Only a few KB of prompt text is
 * fetched; the manuscript never leaves the machine.
 */

import { requestUrl } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { ONBOARDING_CANONICAL_PROMPT, ONBOARDING_SCHEMA_VERSION } from '../ai/prompts/onboarding';

const PROMPT_ENDPOINT = 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/functions/v1/onboarding-prompt';

/** Refresh at most once a day — the text is editorial and changes rarely. */
const REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface RemotePromptPayload {
  promptText: string;
  schemaVersion: number;
  updatedAt: string;
}

/** Parse the endpoint's JSON defensively (untrusted input). */
export function parseRemotePrompt(raw: unknown): RemotePromptPayload | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const record = raw as Record<string, unknown>;
  const promptText = typeof record.prompt_text === 'string' ? record.prompt_text.trim() : '';
  const schemaVersion = typeof record.schema_version === 'number' ? record.schema_version : NaN;
  const updatedAt = typeof record.updated_at === 'string' ? record.updated_at : '';
  if (promptText.length === 0 || !Number.isFinite(schemaVersion)) return null;
  return { promptText, schemaVersion, updatedAt };
}

/** The adoption gate: remote text is used only at the plugin's pinned schema version. */
export function shouldAdoptRemotePrompt(
  payload: RemotePromptPayload | null,
  pinnedVersion: number = ONBOARDING_SCHEMA_VERSION
): boolean {
  return payload !== null && payload.schemaVersion === pinnedVersion;
}

/**
 * The effective canonical prompt: the adopted remote text when compatible,
 * else the bundled snapshot. (The future settings override layers on top of
 * this per the plan; it replaces only the instruction block.)
 */
export function getOnboardingCanonicalPrompt(plugin: RadialTimelinePlugin): string {
  const cache = plugin.settings.onboardingPromptCache;
  if (cache && cache.schemaVersion === ONBOARDING_SCHEMA_VERSION && cache.promptText.trim().length > 0) {
    return cache.promptText;
  }
  return ONBOARDING_CANONICAL_PROMPT;
}

/**
 * Best-effort background refresh — never throws, never blocks onboarding.
 * Call fire-and-forget when the onboarding modal opens.
 */
export async function refreshOnboardingPrompt(plugin: RadialTimelinePlugin): Promise<void> {
  try {
    const cache = plugin.settings.onboardingPromptCache;
    if (cache?.fetchedAt) {
      const age = Date.now() - new Date(cache.fetchedAt).getTime();
      if (Number.isFinite(age) && age >= 0 && age < REFRESH_INTERVAL_MS) return;
    }
    const response = await requestUrl({ url: PROMPT_ENDPOINT, method: 'GET', throw: false });
    if (response.status !== 200) return;
    const payload = parseRemotePrompt(response.json);
    if (!shouldAdoptRemotePrompt(payload) || !payload) return;
    plugin.settings.onboardingPromptCache = {
      promptText: payload.promptText,
      schemaVersion: payload.schemaVersion,
      updatedAt: payload.updatedAt,
      fetchedAt: new Date().toISOString(),
    };
    await plugin.saveSettings();
  } catch {
    // Offline or endpoint down — the bundled snapshot stands.
  }
}
