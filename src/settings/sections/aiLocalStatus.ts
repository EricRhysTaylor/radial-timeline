import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';
import { t } from '../../i18n';

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
    /** All four checks passed. Callers test this, never the (translated) label. */
    validated: boolean;
}

/** Shared interpretation for the local status card, active preview, and provider dropdown. */
export function buildLocalStatus(input: LocalStatusInput): LocalStatus {
    if (!input.enabled) return { label: t('ui.aiLocalStatus.disabled'), providerState: 'not_configured', validated: false };
    if (input.discovering || input.loadingModels) return { label: t('ui.aiLocalStatus.checkingServer'), providerState: 'checking', validated: false };
    if (input.validating) return { label: t('ui.aiLocalStatus.validating'), providerState: 'checking', validated: false };
    // An unchecked server is not a failed server. Keep the dropdown neutral until discovery fails.
    if (!input.hasServers) return { label: t('ui.aiLocalStatus.noServerDetected'), providerState: input.detectionError ? 'network_blocked' : '', validated: false };
    if (input.validationError) return { label: t('ui.aiLocalStatus.needsReview'), providerState: 'rejected', validated: false };
    const report = input.report;
    if (report && !report.reachable.ok) return { label: t('ui.aiLocalStatus.serverOffline'), providerState: 'network_blocked', validated: false };
    const validated = !!(report?.reachable.ok && report.modelAvailable.ok && report.basicCompletion.ok && report.structuredJson.ok);
    return { label: validated ? t('ui.aiLocalStatus.connectedValidated') : t('ui.aiLocalStatus.connected'), providerState: 'ready', validated };
}

export function formatLocalLlmUiError(message: string | null | undefined): string {
    const normalized = (message ?? '').trim();
    if (!normalized) return t('ui.aiLocalStatus.unknownError');
    if (/ERR_CONNECTION_REFUSED/i.test(normalized)) return t('ui.aiLocalStatus.connectionRefused');
    if (/timed?\s*out/i.test(normalized)) return t('ui.aiLocalStatus.timedOut');
    if (/No models reported by this local server/i.test(normalized)) return t('ui.aiLocalStatus.noModelsLoaded');
    return normalized;
}

export function formatLocalTimestamp(iso: string | null): string | null {
    if (!iso) return null;
    const parsed = new Date(iso);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}
