import type { Plugin } from 'obsidian';
import { normalizePath } from 'obsidian';
import type { AIProviderId } from '../types';
import { PROVIDER_MAX_OUTPUT_TOKENS } from '../../constants/tokenLimits';
import { INQUIRY_MAX_OUTPUT_TOKENS } from '../../inquiry/constants';

export interface OutputSample {
    provider: AIProviderId;
    modelId: string;
    inputTokens: number;
    outputTokens: number;
    timestamp: number;
}

interface SerializedProfile {
    version: 1;
    samples: OutputSample[];
}

const PROFILE_VERSION = 1;
const PROFILE_FILE_NAME = 'output-profile.json';
const MAX_SAMPLES_PER_MODEL = 50;
const MIN_SAMPLES_FOR_PREDICTION = 3;
const SAFETY_MULTIPLIER = 1.5;
// Floor for the learned output prediction. NOTE: this only nudges the
// request's maxOutputMode (auto/high/max) — it does NOT lift the real output
// cap, which is set by computeCaps from the rate-limit tier. Structured-reply
// truncation is handled by the ceiling-retry path (forceMaxOutputCeiling),
// not by this floor.
const MIN_REQUEST_FLOOR = 4000;

type InputBucket = 'small' | 'medium' | 'large';

function inputBucket(inputTokens: number): InputBucket {
    if (inputTokens < 50_000) return 'small';
    if (inputTokens < 250_000) return 'medium';
    return 'large';
}

function isValidSample(value: unknown): value is OutputSample {
    if (!value || typeof value !== 'object') return false;
    const s = value as Partial<OutputSample>;
    return typeof s.provider === 'string'
        && typeof s.modelId === 'string'
        && typeof s.inputTokens === 'number' && Number.isFinite(s.inputTokens) && s.inputTokens >= 0
        && typeof s.outputTokens === 'number' && Number.isFinite(s.outputTokens) && s.outputTokens >= 0
        && typeof s.timestamp === 'number' && Number.isFinite(s.timestamp);
}

function resolveHardCap(provider: AIProviderId): number {
    if (provider === 'none') return INQUIRY_MAX_OUTPUT_TOKENS;
    return PROVIDER_MAX_OUTPUT_TOKENS[provider] ?? INQUIRY_MAX_OUTPUT_TOKENS;
}

export class OutputProfileStore {
    private samples: OutputSample[] = [];
    private loaded = false;
    private loadPromise: Promise<void> | null = null;
    private writePending = false;

    constructor(private readonly plugin: Plugin) {}

    async ensureLoaded(): Promise<void> {
        if (this.loaded) return;
        if (!this.loadPromise) this.loadPromise = this.load();
        await this.loadPromise;
    }

    private async load(): Promise<void> {
        const path = this.getFilePath();
        const adapter = this.plugin.app.vault.adapter;
        try {
            if (await adapter.exists(path)) {
                const raw = await adapter.read(path);
                const parsed = JSON.parse(raw) as SerializedProfile;
                if (parsed?.version === PROFILE_VERSION && Array.isArray(parsed.samples)) {
                    this.samples = parsed.samples.filter(isValidSample);
                }
            }
        } catch {
            this.samples = [];
        }
        this.loaded = true;
    }

    async record(sample: OutputSample): Promise<void> {
        await this.ensureLoaded();
        if (!isValidSample(sample)) return;
        if (sample.outputTokens <= 0) return;
        this.samples.push(sample);
        this.samples = trimPerModel(this.samples, MAX_SAMPLES_PER_MODEL);
        await this.save();
    }

    predictExpectedOutput(
        provider: AIProviderId,
        modelId: string,
        inputTokens: number
    ): number | null {
        if (!this.loaded) return null;
        const matching = this.samples.filter(s => s.provider === provider && s.modelId === modelId);
        if (matching.length < MIN_SAMPLES_FOR_PREDICTION) return null;
        const bucket = inputBucket(inputTokens);
        const bucketed = matching.filter(s => inputBucket(s.inputTokens) === bucket);
        const pool = bucketed.length >= MIN_SAMPLES_FOR_PREDICTION ? bucketed : matching;
        const sorted = pool.map(s => s.outputTokens).sort((a, b) => a - b);
        const p75Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.75));
        const p75 = sorted[p75Index];
        return typeof p75 === 'number' && p75 > 0 ? p75 : null;
    }

    getRequestMaxTokens(
        provider: Exclude<AIProviderId, 'none'>,
        modelId: string,
        inputTokens: number
    ): number {
        const hardCap = resolveHardCap(provider);
        const predicted = this.predictExpectedOutput(provider, modelId, inputTokens);
        if (predicted == null) return hardCap;
        const withMargin = Math.ceil(predicted * SAFETY_MULTIPLIER);
        return Math.min(hardCap, Math.max(MIN_REQUEST_FLOOR, withMargin));
    }

    getExpectedOutputForCost(
        provider: AIProviderId,
        modelId: string,
        inputTokens: number
    ): number {
        const predicted = this.predictExpectedOutput(provider, modelId, inputTokens);
        if (predicted == null) return resolveHardCap(provider);
        return Math.ceil(predicted * SAFETY_MULTIPLIER);
    }

    getSampleCount(provider: AIProviderId, modelId: string): number {
        if (!this.loaded) return 0;
        return this.samples.filter(s => s.provider === provider && s.modelId === modelId).length;
    }

    private getFilePath(): string {
        const configDir = this.plugin.app.vault.configDir;
        const pluginId = this.plugin.manifest.id;
        return normalizePath(`${configDir}/plugins/${pluginId}/${PROFILE_FILE_NAME}`);
    }

    private async save(): Promise<void> {
        if (this.writePending) return;
        this.writePending = true;
        try {
            const payload: SerializedProfile = {
                version: PROFILE_VERSION,
                samples: this.samples
            };
            await this.plugin.app.vault.adapter.write(
                this.getFilePath(),
                JSON.stringify(payload)
            );
        } catch {
            // non-fatal — profile will retry on next record
        } finally {
            this.writePending = false;
        }
    }
}

function trimPerModel(samples: OutputSample[], limit: number): OutputSample[] {
    const kept: OutputSample[] = [];
    const counts = new Map<string, number>();
    for (let i = samples.length - 1; i >= 0; i--) {
        const s = samples[i];
        const key = `${s.provider}::${s.modelId}`;
        const count = counts.get(key) ?? 0;
        if (count < limit) {
            kept.unshift(s);
            counts.set(key, count + 1);
        }
    }
    return kept;
}
