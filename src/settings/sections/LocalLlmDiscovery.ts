import { listLocalServerCandidates, probeLocalServers, type DetectedLocalServer } from '../../ai/localLlm/detection';
import { withTimeout, type LocalLlmModelEntry } from '../../ai/localLlm/transport';
import type { LocalLlmSettings } from '../../ai/types';
import { t } from '../../i18n';

type Request<T> = { key: string; generation: number; promise: Promise<T | null> };
/** Owns list/discovery requests; only results for the current configuration may be applied. */
export function createLocalLlmDiscovery(options: {
    settings: () => LocalLlmSettings;
    provider: () => string;
    listModels: (settings: Partial<LocalLlmSettings>) => Promise<LocalLlmModelEntry[]>;
}) {
    let generation = 0;
    let disposed = false;
    const detected: { current?: Request<DetectedLocalServer[]> } = {};
    const loaded: { current?: Request<LocalLlmModelEntry[]> } = {};
    const key = () => JSON.stringify([options.provider(), options.settings()]);
    function run<T>(slot: { current?: Request<T> }, operation: (settings: LocalLlmSettings) => Promise<T>): Promise<T | null> {
        if (disposed) return Promise.resolve(null);
        const requestKey = key();
        if (slot.current?.key === requestKey && slot.current.generation === generation) return slot.current.promise;
        const requestGeneration = generation;
        const settings = options.settings();
        const current = () => !disposed && generation === requestGeneration && key() === requestKey;
        const request: Request<T> = { key: requestKey, generation: requestGeneration, promise: Promise.resolve(null) };
        request.promise = withTimeout(operation(settings), 60_000, t('settings.ai.localLlm.validationDeadline'))
            .then(result => current() ? result : null)
            .catch((error: unknown) => { if (current()) throw error; return null; })
            .finally(() => { if (slot.current === request) slot.current = undefined; });
        slot.current = request;
        return request.promise;
    }
    function invalidate(): void { generation++; detected.current = undefined; loaded.current = undefined; }
    return {
        get discovering() { return !!detected.current; },
        get loading() { return !!loaded.current; },
        detect: () => run(detected, settings => probeLocalServers(listLocalServerCandidates(settings), candidate => options.listModels({
            backend: candidate.backend, baseUrl: candidate.baseUrl, timeoutMs: Math.max(4000, Math.min(settings.timeoutMs, 10000))
        }))),
        load: () => run(loaded, settings => options.listModels({ ...settings, timeoutMs: Math.max(4000, Math.min(settings.timeoutMs, 10000)) })),
        invalidate,
        dispose: () => { disposed = true; invalidate(); }
    };
}
