import type RadialTimelinePlugin from '../main';
import type { Vault } from 'obsidian';
import type { AIProviderId } from '../ai/types';
import type { AiProviderResponse } from './types';
import type { PulseUsageReport } from './usage';

export type Provider = Exclude<AIProviderId, 'none'>;
export type PulseUsageObserver = (report: PulseUsageReport) => void;

export type AiRunner = (
  userPrompt: string,
  subplotName: string | null,
  commandContext: string,
  sceneName?: string,
  tripletInfo?: { prev: string; current: string; next: string }
) => Promise<AiProviderResponse>;

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
    tripletInfo?: { prev: string; current: string; next: string },
    onUsage?: PulseUsageObserver
  ) => Promise<AiProviderResponse>,
  onUsage?: PulseUsageObserver
): AiRunner {
  return (userPrompt, subplotName, commandContext, sceneName, tripletInfo) =>
    callAiProvider(plugin, vault, userPrompt, subplotName, commandContext, sceneName, tripletInfo, onUsage);
}
