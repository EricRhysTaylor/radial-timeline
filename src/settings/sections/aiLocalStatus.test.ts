import { describe, expect, it, vi } from 'vitest';
import { buildLocalStatus, formatLocalLlmUiError, formatLocalTimestamp } from './aiLocalStatus';
import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
const healthy: LocalLlmDiagnosticsReport = {
    backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1', modelId: 'model',
    reachable: { ok: true, message: '' }, modelAvailable: { ok: true, message: '' },
    basicCompletion: { ok: true, message: '' }, structuredJson: { ok: true, message: '' }
};
const base = { enabled: true, discovering: false, loadingModels: false, validating: false,
    hasServers: true, detectionError: null, validationError: null, report: null };
describe('Local LLM status interpretation', () => {
    it.each([
        [{ enabled: false, validating: true }, 'ui.aiLocalStatus.disabled', 'not_configured', false],
        [{ discovering: true, validating: true }, 'ui.aiLocalStatus.checkingServer', 'checking', false],
        [{ loadingModels: true }, 'ui.aiLocalStatus.checkingServer', 'checking', false],
        [{ validating: true }, 'ui.aiLocalStatus.validating', 'checking', false],
        [{ hasServers: false }, 'ui.aiLocalStatus.noServerDetected', '', false],
        [{ hasServers: false, detectionError: 'offline' }, 'ui.aiLocalStatus.noServerDetected', 'network_blocked', false],
        [{ validationError: 'failed' }, 'ui.aiLocalStatus.needsReview', 'rejected', false],
        [{}, 'ui.aiLocalStatus.connected', 'ready', false],
        [{ report: healthy }, 'ui.aiLocalStatus.connectedValidated', 'ready', true],
        [{ report: { ...healthy, reachable: { ok: false, message: 'offline' } } }, 'ui.aiLocalStatus.serverOffline', 'network_blocked', false]
    ] as const)('keeps card and dropdown consistent for %j', (overrides, label, providerState, validated) => {
        expect(buildLocalStatus({ ...base, ...overrides })).toEqual({ label, providerState, validated });
    });
    it.each(['modelAvailable', 'basicCompletion', 'structuredJson'] as const)('does not claim validation succeeded when %s fails', check => {
        expect(buildLocalStatus({ ...base, report: { ...healthy, [check]: { ok: false, message: 'failed' } } }))
            .toEqual({ label: 'ui.aiLocalStatus.connected', providerState: 'ready', validated: false });
    });
    it.each([
        [null, 'ui.aiLocalStatus.unknownError'],
        ['net::ERR_CONNECTION_REFUSED', 'ui.aiLocalStatus.connectionRefused'],
        ['Request timed out', 'ui.aiLocalStatus.timedOut'],
        ['No models reported by this local server', 'ui.aiLocalStatus.noModelsLoaded'],
        ['  Specific server failure  ', 'Specific server failure']
    ])('formats error %s without substituting success', (message, expected) => {
        expect(formatLocalLlmUiError(message)).toBe(expected);
    });
    it('omits missing or invalid timestamps and uses local time for a valid timestamp', () => {
        expect(formatLocalTimestamp(null)).toBeNull(); expect(formatLocalTimestamp('invalid')).toBeNull();
        const stamp = '2026-09-06T16:00:00Z';
        expect(formatLocalTimestamp(stamp)).toBe(new Date(stamp).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }));
    });
});
