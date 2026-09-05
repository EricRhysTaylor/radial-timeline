import type { CanonicalModelRecord, ModelInfo, ProviderSnapshotPayload } from '../types';

export type AvailabilityStatus = 'visible' | 'not_visible' | 'unknown';

export interface ProviderCapsPair {
    inputTokenLimit?: number;
    outputTokenLimit?: number;
}

export interface MergedModelInfo extends ModelInfo {
    availableToKey: boolean;
    availabilityStatus: AvailabilityStatus;
    providerModelId: string;
    providerLabel?: string;
    providerCreatedAt?: string;
    providerCaps?: ProviderCapsPair;
    raw?: Record<string, unknown>;
    capsMismatch?: {
        curated?: ProviderCapsPair;
        provider?: ProviderCapsPair;
    };
}

export function modelKey(provider: string, id: string): string {
    return `${provider}:${id}`;
}

function toSnapshotProvider(provider: ModelInfo['provider']): CanonicalModelRecord['provider'] | null {
    if (provider === 'openai' || provider === 'anthropic' || provider === 'google') return provider;
    return null;
}

function hasProviderCaps(record: CanonicalModelRecord | null): boolean {
    if (!record) return false;
    return Number.isFinite(record.inputTokenLimit) || Number.isFinite(record.outputTokenLimit);
}

function buildProviderCaps(record: CanonicalModelRecord | null): ProviderCapsPair | undefined {
    if (!record || !hasProviderCaps(record)) return undefined;
    return {
        inputTokenLimit: Number.isFinite(record.inputTokenLimit) ? record.inputTokenLimit : undefined,
        outputTokenLimit: Number.isFinite(record.outputTokenLimit) ? record.outputTokenLimit : undefined
    };
}

function buildCapsMismatch(model: ModelInfo, providerCaps?: ProviderCapsPair): MergedModelInfo['capsMismatch'] {
    if (!providerCaps) return undefined;
    const contextMismatch = Number.isFinite(providerCaps.inputTokenLimit)
        && Number.isFinite(model.contextWindow)
        && providerCaps.inputTokenLimit !== model.contextWindow;
    const outputMismatch = Number.isFinite(providerCaps.outputTokenLimit)
        && Number.isFinite(model.maxOutput)
        && providerCaps.outputTokenLimit !== model.maxOutput;
    if (!contextMismatch && !outputMismatch) return undefined;
    return {
        curated: {
            inputTokenLimit: contextMismatch ? model.contextWindow : undefined,
            outputTokenLimit: outputMismatch ? model.maxOutput : undefined
        },
        provider: {
            inputTokenLimit: contextMismatch ? providerCaps.inputTokenLimit : undefined,
            outputTokenLimit: outputMismatch ? providerCaps.outputTokenLimit : undefined
        }
    };
}

export function mergeCuratedWithSnapshot(
    curated: ModelInfo[],
    snapshot: ProviderSnapshotPayload | null
): MergedModelInfo[] {
    const snapshotMap = new Map<string, CanonicalModelRecord>();
    if (snapshot) {
        snapshot.models.forEach(record => snapshotMap.set(modelKey(record.provider, record.id), record));
    }

    return curated.map(model => {
        const snapshotProvider = toSnapshotProvider(model.provider);
        const snapshotRecord = snapshotProvider
            ? (snapshotMap.get(modelKey(snapshotProvider, model.id)) ?? null)
            : null;
        const providerCaps = buildProviderCaps(snapshotRecord);
        const availabilityStatus: AvailabilityStatus = !snapshotProvider
            ? 'unknown'
            : (!snapshot
                ? 'unknown'
                : (snapshotRecord ? 'visible' : 'not_visible'));

        return {
            ...model,
            label: model.label || snapshotRecord?.label || model.id,
            releasedAt: model.releasedAt || snapshotRecord?.createdAt,
            availableToKey: availabilityStatus === 'visible',
            availabilityStatus,
            providerModelId: model.id,
            providerLabel: snapshotRecord?.label,
            providerCreatedAt: snapshotRecord?.createdAt,
            providerCaps,
            raw: snapshotRecord?.raw,
            capsMismatch: buildCapsMismatch(model, providerCaps)
        };
    });
}

export function formatAvailabilityLabel(status: AvailabilityStatus): string {
    if (status === 'visible') return 'Visible to your key ✅';
    if (status === 'not_visible') return 'Not visible ⚠️';
    return 'Unknown (snapshot unavailable)';
}
