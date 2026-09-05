import type { AIRunRequest, AIRunResult } from '../types';

export interface AITelemetryEvent {
    feature: string;
    task: string;
    provider: string;
    modelResolved: string;
    aiStatus: string;
    timestamp: string;
}

export function buildTelemetryEvent(request: AIRunRequest, result: AIRunResult): AITelemetryEvent {
    return {
        feature: request.feature,
        task: request.task,
        provider: result.provider,
        modelResolved: result.modelResolved,
        aiStatus: result.aiStatus,
        timestamp: new Date().toISOString()
    };
}

export function emitTelemetry(enabled: boolean, _event: AITelemetryEvent): void {
    if (!enabled) return;
    // Reserved for future transport. Keep privacy-safe and opt-in only.
}
