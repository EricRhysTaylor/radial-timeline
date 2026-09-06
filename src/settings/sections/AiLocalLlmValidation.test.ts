import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { renderAiLocalLlmValidation } from './AiLocalLlmValidation';
import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';

interface ButtonStub { buttonEl: EventTarget; disabled: boolean; setDisabled(value: boolean): ButtonStub; }
const ui = vi.hoisted(() => ({ button: null as ButtonStub | null, notices: [] as string[], assimilated: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian.ts', async original => ({
    ...await original<typeof import('obsidian')>(),
    Notice: class { constructor(message: string) { ui.notices.push(message); } },
    Setting: class {
        setName() { return this; } setDesc() { return this; }
        addButton(build: (button: ButtonStub) => void) {
            const button = {
                buttonEl: new EventTarget(), disabled: false,
                setButtonText() { return this; }, setCta() { return this; },
                setDisabled(value: boolean) { this.disabled = value; return this; },
                // Detect promise assimilation without reproducing an endless loop in the test runner.
                then(resolve: (value: undefined) => void) { ui.assimilated(); resolve(undefined); }
            };
            ui.button = button; build(button); return this;
        }
    }
}));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const report: LocalLlmDiagnosticsReport = {
    backend: 'openaiCompatible', baseUrl: 'http://localhost:8080/v1', modelId: 'test-model',
    reachable: { ok: true, message: 'Connected' }, modelAvailable: { ok: true, message: 'Found' },
    basicCompletion: { ok: true, message: 'Passed' }, structuredJson: { ok: true, message: 'Passed' }
};
function render() {
    const scope = new Component(); scope.load();
    const options = { scope, container: {} as HTMLElement, isLocalActive: vi.fn(() => true), getDeadlineMs: () => 125_000,
        detect: vi.fn(async () => {}), load: vi.fn(async () => {}), diagnose: vi.fn(async () => report),
        onStateChange: vi.fn(), onSettled: vi.fn() };
    const control = renderAiLocalLlmValidation(options);
    return { scope, options, control, button: ui.button! };
}
beforeEach(() => { ui.notices = []; ui.assimilated.mockClear(); });
afterEach(() => { vi.useRealTimers(); });
describe('Local LLM validation action', () => {
    it('can be clicked repeatedly without returning the thenable button from promise cleanup', async () => {
        vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-06T16:00:00Z'));
        const p = render(); const pending = deferred<LocalLlmDiagnosticsReport>();
        p.options.diagnose.mockReturnValueOnce(pending.promise);
        p.button.buttonEl.dispatchEvent(new Event('click'));
        expect(p.button.disabled).toBe(true); expect(p.control.state.pending).toBe(true);
        const first = p.control.run();
        pending.resolve(report); await first; await Promise.resolve();
        expect(p.button.disabled).toBe(false); expect(p.control.state.report).toBe(report);
        expect(p.control.state.lastValidatedAt).toBe('2026-09-06T16:00:00.000Z');
        vi.setSystemTime(new Date('2026-09-06T16:00:02Z'));
        p.button.buttonEl.dispatchEvent(new Event('click')); await p.control.run(); await Promise.resolve();
        expect(p.control.state.lastValidatedAt).toBe('2026-09-06T16:00:02.000Z');
        expect(p.options.diagnose).toHaveBeenCalledTimes(2);
        expect(p.options.detect).toHaveBeenCalledTimes(2); expect(p.options.load).toHaveBeenCalledTimes(2);
        expect(p.button.disabled).toBe(false); expect(ui.assimilated).not.toHaveBeenCalled(); p.scope.unload();
    });
    it('retains one detect-load-diagnose chain when automatic and manual checks overlap', async () => {
        vi.useFakeTimers(); const p = render(); const pending = deferred<void>();
        p.options.detect.mockReturnValueOnce(pending.promise);
        p.control.queue(); p.control.queue(); await vi.advanceTimersByTimeAsync(150);
        p.button.buttonEl.dispatchEvent(new Event('click')); const done = p.control.run();
        expect(p.options.detect).toHaveBeenCalledOnce(); expect(p.options.load).not.toHaveBeenCalled();
        pending.resolve(); await done; await Promise.resolve();
        expect(p.options.load).toHaveBeenCalledOnce(); expect(p.options.diagnose).toHaveBeenCalledOnce();
        expect(p.button.disabled).toBe(false); expect(ui.assimilated).not.toHaveBeenCalled(); p.scope.unload();
    });
    it('reports a failure, re-enables the button, and allows a successful retry', async () => {
        const p = render(); p.options.diagnose.mockRejectedValueOnce(new Error('connection refused'));
        p.button.buttonEl.dispatchEvent(new Event('click')); await p.control.run(); await Promise.resolve();
        expect(p.control.state).toMatchObject({ pending: false, report: null, error: 'connection refused' });
        expect(p.button.disabled).toBe(false); expect(ui.notices.at(-1)).toContain('connection refused');
        p.button.buttonEl.dispatchEvent(new Event('click')); await p.control.run(); await Promise.resolve();
        expect(p.control.state).toMatchObject({ pending: false, report, error: null });
        expect(ui.assimilated).not.toHaveBeenCalled(); p.scope.unload();
    });
    it('keeps the cold-start budget and stops later steps after the aggregate deadline', async () => {
        vi.useFakeTimers(); const p = render(); const stalled = deferred<void>();
        p.options.detect.mockReturnValueOnce(stalled.promise); const done = p.control.run();
        await vi.advanceTimersByTimeAsync(90_000); expect(p.control.state.pending).toBe(true);
        await vi.advanceTimersByTimeAsync(35_001); await done;
        expect(p.control.state.pending).toBe(false); expect(p.control.state.error).toBeTruthy();
        stalled.resolve(); await Promise.resolve(); await Promise.resolve();
        expect(p.options.diagnose).not.toHaveBeenCalled(); expect(p.options.load).not.toHaveBeenCalled();
        await p.control.run(); expect(p.control.state.report).toBe(report); p.scope.unload();
    });
    it('cancels queued work when closed and removes the button listener', async () => {
        vi.useFakeTimers(); const p = render(); p.control.queue(); p.scope.unload();
        p.button.buttonEl.dispatchEvent(new Event('click')); await vi.advanceTimersByTimeAsync(200);
        expect(p.options.detect).not.toHaveBeenCalled(); expect(p.options.onStateChange).not.toHaveBeenCalled();
    });
    it('does not start diagnostics or repaint if closed during discovery', async () => {
        const p = render(); const pending = deferred<void>(); p.options.detect.mockReturnValueOnce(pending.promise);
        const done = p.control.run(); p.scope.unload(); const count = p.options.onStateChange.mock.calls.length;
        pending.resolve(); await done;
        expect(p.options.load).not.toHaveBeenCalled(); expect(p.options.diagnose).not.toHaveBeenCalled();
        expect(p.options.onStateChange).toHaveBeenCalledTimes(count); expect(ui.notices).toEqual([]);
    });
    it('lets active diagnostics finish without publishing to a closed pane', async () => {
        const p = render(); const pending = deferred<LocalLlmDiagnosticsReport>(); p.options.diagnose.mockReturnValueOnce(pending.promise);
        const done = p.control.run(); await vi.waitFor(() => expect(p.options.diagnose).toHaveBeenCalledOnce());
        p.scope.unload(); const count = p.options.onStateChange.mock.calls.length; pending.resolve(report); await done;
        expect(p.control.state.report).toBeNull(); expect(p.options.onStateChange).toHaveBeenCalledTimes(count);
        expect(p.options.onSettled).not.toHaveBeenCalled(); expect(ui.notices).toEqual([]);
    });
    it('skips auto-validation and preview refresh when another provider is selected', async () => {
        vi.useFakeTimers(); const p = render(); p.control.queue(); p.options.isLocalActive.mockReturnValue(false);
        await vi.advanceTimersByTimeAsync(200); expect(p.options.detect).not.toHaveBeenCalled();
        await p.control.run(); expect(p.options.onSettled).not.toHaveBeenCalled(); p.scope.unload();
    });
});
