import { BUILTIN_MODELS } from './builtinModels';
import type { AIProviderId, ModelInfo, RegistryRefreshResult } from '../types';

/**
 * The model registry is BUILTIN_MODELS — the single source of truth. The
 * catalog ships in code and changes only via a release; there is no remote
 * registry merge. `refresh()` is retained as a trivial reset so the shared
 * model-data refresh plumbing (which also drives the provider snapshot and
 * pricing) keeps a uniform shape.
 */
export class ModelRegistry {
    private models: ModelInfo[] = [...BUILTIN_MODELS];
    private lastRefresh?: RegistryRefreshResult;

    async refresh(): Promise<RegistryRefreshResult> {
        this.models = [...BUILTIN_MODELS];
        const result: RegistryRefreshResult = { source: 'builtin' };
        this.lastRefresh = result;
        return result;
    }

    getLastRefresh(): RegistryRefreshResult | undefined {
        return this.lastRefresh;
    }

    getAll(): ModelInfo[] {
        return [...this.models];
    }

    getByProvider(provider: AIProviderId): ModelInfo[] {
        return this.models.filter(model => model.provider === provider);
    }

    findByAlias(alias: string): ModelInfo | undefined {
        return this.models.find(model => model.alias === alias);
    }

    findByProviderModel(provider: AIProviderId, id: string): ModelInfo | undefined {
        return this.models.find(model => model.provider === provider && model.id === id);
    }

    resolveAlias(provider: AIProviderId, id: string): string | undefined {
        return this.findByProviderModel(provider, id)?.alias;
    }
}
