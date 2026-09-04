import type RadialTimelinePlugin from '../../main';
import type { AIProvider as AIProviderInterface, AIProviderId } from '../types';
import { OpenAIProvider } from './openaiProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GoogleProvider } from './googleProvider';
import { OllamaProvider } from './ollamaProvider';

export { OpenAIProvider, AnthropicProvider, GoogleProvider, OllamaProvider };
export type { AIProviderInterface as AIProvider };

export function buildProviders(plugin: RadialTimelinePlugin): Record<AIProviderId, AIProviderInterface | null> {
    return {
        openai: new OpenAIProvider(plugin),
        anthropic: new AnthropicProvider(plugin),
        google: new GoogleProvider(plugin),
        ollama: new OllamaProvider(plugin),
        none: null
    };
}
