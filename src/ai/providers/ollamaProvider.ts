import type RadialTimelinePlugin from '../../main';
import { getLocalLlmClient } from '../localLlm/client';
import type { AIProvider, Capability, GenerateJsonRequest, GenerateTextRequest, ProviderExecutionResult } from '../types';

const CAPS: Capability[] = ['jsonStrict'];

export class OllamaProvider implements AIProvider {
    id = 'ollama' as const;

    constructor(private plugin: RadialTimelinePlugin) {}

    supports(capability: Capability): boolean {
        return CAPS.includes(capability);
    }

    async generateText(req: GenerateTextRequest): Promise<ProviderExecutionResult> {
        return getLocalLlmClient(this.plugin).generateText(req);
    }

    async generateJson(req: GenerateJsonRequest): Promise<ProviderExecutionResult> {
        return getLocalLlmClient(this.plugin).generateJson(req);
    }
}
