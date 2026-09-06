import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';

interface LocalStatusInput {
    enabled: boolean;
    discovering: boolean;
    loadingModels: boolean;
    validating: boolean;
    hasServers: boolean;
    detectionError: string | null;
    validationError: string | null;
    report: LocalLlmDiagnosticsReport | null;
}
interface LocalStatus {
    label: string;
    providerState: '' | 'not_configured' | 'checking' | 'network_blocked' | 'rejected' | 'ready';
}

/** Shared interpretation for the local status card, active preview, and provider dropdown. */
export function buildLocalStatus(input: LocalStatusInput): LocalStatus {
    if (!input.enabled) return { label: 'Local LLM disabled', providerState: 'not_configured' };
    if (input.discovering || input.loadingModels) return { label: 'Checking local server', providerState: 'checking' };
    if (input.validating) return { label: 'Validating', providerState: 'checking' };
    // An unchecked server is not a failed server. Keep the dropdown neutral until discovery fails.
    if (!input.hasServers) return { label: 'No local server detected', providerState: input.detectionError ? 'network_blocked' : '' };
    if (input.validationError) return { label: 'Needs review', providerState: 'rejected' };
    const report = input.report;
    if (report && !report.reachable.ok) return { label: 'Local server offline', providerState: 'network_blocked' };
    const validated = report?.reachable.ok && report.modelAvailable.ok && report.basicCompletion.ok && report.structuredJson.ok;
    return { label: validated ? 'Connected & validated' : 'Connected', providerState: 'ready' };
}

export function formatLocalLlmUiError(message: string | null | undefined): string {
    const normalized = (message ?? '').trim();
    if (!normalized) return 'Unknown local server error.';
    if (/ERR_CONNECTION_REFUSED/i.test(normalized)) return 'Connection refused. The local server is not running.';
    if (/timed?\s*out/i.test(normalized)) return 'Timed out while contacting the local server.';
    if (/No models reported by this local server/i.test(normalized)) return 'A local server responded, but no models are loaded.';
    return normalized;
}

export function formatLocalTimestamp(iso: string | null): string | null {
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
