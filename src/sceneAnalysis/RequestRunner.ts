import type RadialTimelinePlugin from '../main';
import type { Vault } from 'obsidian';
import type { AIRunAdvancedContext, AIProviderId } from '../ai/types';
import type { ParsedSceneAnalysis } from './types';

export type Provider = Exclude<AIProviderId, 'none'>;

export type AiRunner = (
  userPrompt: string,
  subplotName: string | null,
  commandContext: string,
  sceneName?: string,
  tripletInfo?: { prev: string; current: string; next: string }
) => Promise<{
    result: string | null;
    parsedAnalysis?: ParsedSceneAnalysis | null;
    modelIdUsed: string | null;
    providerUsed?: Provider | null;
    advancedContext?: AIRunAdvancedContext;
  }>;

export function createAiRunner(
  plugin: RadialTimelinePlugin,
  vault: Vault,
  callAiProvider: (
    plugin: RadialTimelinePlugin,
    vault: Vault,
    userPrompt: string,
    subplotName: string | null,
    commandContext: string,
    sceneName?: string,
    tripletInfo?: { prev: string; current: string; next: string }
  ) => Promise<{
    result: string | null;
    parsedAnalysis?: ParsedSceneAnalysis | null;
    modelIdUsed: string | null;
    providerUsed?: Provider | null;
    advancedContext?: AIRunAdvancedContext;
  }>
): AiRunner {
  return (userPrompt, subplotName, commandContext, sceneName, tripletInfo) => callAiProvider(plugin, vault, userPrompt, subplotName, commandContext, sceneName, tripletInfo);
}
