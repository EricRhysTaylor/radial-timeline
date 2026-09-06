import { Component, Notice, Setting } from 'obsidian';
import type { LocalLlmDiagnosticsReport } from '../../ai/localLlm/diagnostics';
import { withTimeout } from '../../ai/localLlm/transport';
import { t } from '../../i18n';

interface ValidationState {
    report: LocalLlmDiagnosticsReport | null;
    error: string | null;
    lastValidatedAt: string | null;
    pending: boolean;
}
interface ValidationOptions {
    container: HTMLElement;
    scope: Component;
    isLocalActive: () => boolean;
    getDeadlineMs: () => number;
    detect: () => Promise<void>;
    load: () => Promise<void>;
    diagnose: () => Promise<LocalLlmDiagnosticsReport>;
    onStateChange: () => void;
    onSettled: () => void;
}

/** Owns the validation action, its single in-flight chain, and its debounce timer. */
export function renderAiLocalLlmValidation(options: ValidationOptions) {
    const scope = options.scope.addChild(new Component());
    const state: ValidationState = { report: null, error: null, lastValidatedAt: null, pending: false };
    let disposed = false;
    let inFlight: Promise<void> | null = null;
    let timer: number | null = null;
    const clearTimer = (): void => {
        if (timer !== null) window.clearTimeout(timer);
        timer = null;
    };
    scope.register(() => { disposed = true; clearTimer(); });

    function reset(): void {
        state.report = null;
        state.error = null;
        state.lastValidatedAt = null;
    }

    async function run(quiet = false): Promise<void> {
        if (disposed) return;
        if (inFlight) return inFlight;
        clearTimer();
        state.pending = true;
        state.error = null;
        options.onStateChange();
        let active = true;
        inFlight = (async () => {
            try {
                // Keep the proven sequential budget and diagnostic path intact.
                // Closing the pane stops later steps; an active generation may finish.
                const report = await withTimeout((async () => {
                    await options.detect();
                    if (disposed || !active) return;
                    await options.load();
                    if (disposed || !active) return;
                    return options.diagnose();
                })(), options.getDeadlineMs(), t('settings.ai.localLlm.validationDeadline'));
                if (disposed || !report) return;
                state.report = report;
                state.error = null;
                state.lastValidatedAt = new Date().toISOString();
                if (!quiet) new Notice('Local LLM validation complete.');
            } catch (error) {
                if (disposed) return;
                state.report = null;
                state.error = error instanceof Error ? error.message : String(error);
                state.lastValidatedAt = new Date().toISOString();
                if (!quiet) new Notice(`Local LLM validation failed: ${state.error}`);
            } finally {
                active = false;
                state.pending = false;
                inFlight = null;
                if (!disposed) {
                    options.onStateChange();
                    if (options.isLocalActive()) options.onSettled();
                }
            }
        })();
        return inFlight;
    }

    function queue(): void {
        if (disposed || !options.isLocalActive()) return;
        clearTimer();
        timer = window.setTimeout(() => {
            timer = null;
            if (!disposed && options.isLocalActive()) void run(true);
        }, 150);
    }

    new Setting(options.container)
        .setName(t('settings.ai.localLlm.actionsName'))
        .setDesc(t('settings.ai.localLlm.actionsDesc'))
        .addButton(button => {
            button.setButtonText(t('settings.ai.localLlm.validateButton')).setCta();
            scope.registerDomEvent(button.buttonEl, 'click', () => {
                button.setDisabled(true);
                void run().finally(() => {
                    // ButtonComponent is thenable. Never return setDisabled() here:
                    // promise assimilation would freeze Obsidian in a microtask loop.
                    if (!disposed) button.setDisabled(false);
                });
            });
        });

    return { state: state as Readonly<ValidationState>, reset, queue, run };
}
