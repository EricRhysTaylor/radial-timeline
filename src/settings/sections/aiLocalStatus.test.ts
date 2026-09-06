import { describe, expect, it } from 'vitest';
import { buildLocalStatus, formatLocalLlmUiError, formatLocalTimestamp } from './aiLocalStatus';
import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';
const healthy: LocalLlmDiagnosticsReport = {
    backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1', modelId: 'model',
    reachable: { ok: true, message: '' }, modelAvailable: { ok: true, message: '' },
    basicCompletion: { ok: true, message: '' }, structuredJson: { ok: true, message: '' }
};
const base = { enabled: true, discovering: false, loadingModels: false, validating: false,
    hasServers: true, detectionError: null, validationError: null, report: null };
describe('Local LLM status interpretation', () => {
    it.each([
        [{ enabled: false, validating: true }, 'Local LLM disabled', 'not_configured'],
        [{ discovering: true, validating: true }, 'Checking local server', 'checking'],
        [{ loadingModels: true }, 'Checking local server', 'checking'],
        [{ validating: true }, 'Validating', 'checking'],
        [{ hasServers: false }, 'No local server detected', ''],
        [{ hasServers: false, detectionError: 'offline' }, 'No local server detected', 'network_blocked'],
        [{ validationError: 'failed' }, 'Needs review', 'rejected'],
        [{}, 'Connected', 'ready'],
        [{ report: healthy }, 'Connected & validated', 'ready'],
        [{ report: { ...healthy, reachable: { ok: false, message: 'offline' } } }, 'Local server offline', 'network_blocked']
    ] as const)('keeps card and dropdown consistent for %j', (overrides, label, providerState) => {
        expect(buildLocalStatus({ ...base, ...overrides })).toEqual({ label, providerState });
    });
    it.each(['modelAvailable', 'basicCompletion', 'structuredJson'] as const)('does not claim validation succeeded when %s fails', check => {
        expect(buildLocalStatus({ ...base, report: { ...healthy, [check]: { ok: false, message: 'failed' } } }))
            .toEqual({ label: 'Connected', providerState: 'ready' });
    });
    it.each([
        [null, 'Unknown local server error.'],
        ['net::ERR_CONNECTION_REFUSED', 'Connection refused. The local server is not running.'],
        ['Request timed out', 'Timed out while contacting the local server.'],
        ['No models reported by this local server', 'A local server responded, but no models are loaded.'],
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
