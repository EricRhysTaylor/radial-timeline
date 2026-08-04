/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * Chronologue Placement Modal
 *
 * Dropping a scene on the Chronologue ring asks a question the drop itself
 * cannot answer: WHEN does it now happen? This modal offers validated answers
 * and refuses to enable Place until the selected one, formatted exactly as it
 * will be stored, still sorts strictly between its two neighbours.
 */

import { App } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { formatElapsedTime, formatWhenForYaml, parseWhenField } from '../utils/date';
import { validatePlacement } from '../chronologue/placement/validatePlacement';
import type {
    OverlapWarning,
    PlacementCandidate,
    PlacementInterval,
    SeamChoice
} from '../chronologue/placement/types';

/** One resolved interval the author can place into. */
export interface PlacementOption {
    id: 'default' | SeamChoice;
    label: string;
    interval: PlacementInterval;
    candidates: PlacementCandidate[];
}

export interface PlacementModalContext {
    sceneTitle: string;
    currentWhen: Date | null;
    draggedDurationMs: number | null;
    accent?: string;
}

export interface PlacementResult {
    when: Date;
    storedWhen: string;
}

const CUSTOM_ROW_ID = '__custom__';

export class ChronologuePlacementModal extends ErtModal {
    private readonly options: PlacementOption[];
    private readonly context: PlacementModalContext;

    private activeOptionId: PlacementOption['id'];
    private selectedCandidateId: string | null = null;
    private customInputValue = '';

    private phase: 'choose' | 'running' | 'done' = 'choose';
    private closed = false;
    private resultResolver: ((value: PlacementResult | null) => void) | null = null;
    private dismissResolver: (() => void) | null = null;

    private bodyEl: HTMLElement | null = null;
    private placeButtonEl: HTMLButtonElement | null = null;
    private cancelButtonEl: HTMLButtonElement | null = null;
    private statusRowEl: HTMLElement | null = null;
    private statusTextEl: HTMLElement | null = null;
    private backdropGuard: ((evt: MouseEvent) => void) | null = null;

    constructor(app: App, options: PlacementOption[], context: PlacementModalContext) {
        super(app);
        this.options = options;
        this.context = context;
        this.activeOptionId = options[0].id;
        this.selectedCandidateId = options[0].candidates[0]?.id ?? null; // SAFE: null means nothing preselected; Place stays disabled until a valid pick
    }

    onOpen(): void {
        const { contentEl } = this;
        this.closed = false;
        contentEl.empty();
        this.applyShell({ width: 'min(660px, 90vw)', containerClasses: ['ert-place-modal'] });

        if (this.context.accent) {
            contentEl.style.setProperty('--ert-confirm-accent', this.context.accent);
        }

        this.scope.register([], 'Escape', () => {
            if (this.phase === 'choose') {
                this.resolveResult(null);
                this.close();
            }
            return false;
        });

        this.backdropGuard = (evt: MouseEvent) => {
            if (this.phase === 'choose') return;
            if (evt.target === this.containerEl) {
                evt.preventDefault();
                evt.stopPropagation();
                evt.stopImmediatePropagation();
            }
        };
        this.containerEl.addEventListener('mousedown', this.backdropGuard, true);
        this.containerEl.addEventListener('click', this.backdropGuard, true);

        this.mountHeader({
            badge: { text: 'Chronologue' },
            title: 'Place scene in time',
            subtitle: this.context.sceneTitle
        });

        this.bodyEl = contentEl.createDiv({ cls: 'ert-place-body' });

        const statusRow = contentEl.createDiv({ cls: 'ert-drag-confirm-row is-status-row is-hidden' });
        this.statusTextEl = statusRow.createDiv({ cls: 'ert-drag-confirm-row-text ert-drag-confirm-status-text' });
        this.statusRowEl = statusRow;

        const actions = this.mountActions();
        this.placeButtonEl = actions.createEl('button', { text: 'Place', cls: 'ert-mod-cta' });
        this.cancelButtonEl = actions.createEl('button', { text: 'Cancel' });

        this.placeButtonEl.addEventListener('click', () => this.onPrimaryClick());
        this.cancelButtonEl.addEventListener('click', () => {
            if (this.phase !== 'choose') return;
            this.resolveResult(null);
            this.close();
        });

        this.renderBody();
    }

    // ── rendering ──────────────────────────────────────────────────────────

    private get activeOption(): PlacementOption {
        const found = this.options.find(option => option.id === this.activeOptionId);
        if (!found) throw new Error('Chronologue placement: active option is not in the option list.');
        return found;
    }

    private renderBody(): void {
        const body = this.bodyEl;
        if (!body) return;
        body.empty();

        if (this.options.length > 1) this.renderSeamChoice(body);
        this.renderContextStrip(body);
        this.renderCandidates(body);
        this.renderCustomRow(body);
        this.syncPlaceButton();
    }

    private renderSeamChoice(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'ert-place-section' });
        section.createDiv({
            cls: 'ert-drag-confirm-section-title',
            text: 'This is the top of the circle — which end did you mean?'
        });
        const group = section.createDiv({ cls: 'ert-place-seam-group' });
        this.options.forEach(option => {
            const button = group.createEl('button', {
                cls: 'ert-place-seam-button',
                text: option.label
            });
            button.toggleClass('is-active', option.id === this.activeOptionId);
            button.addEventListener('click', () => {
                if (this.activeOptionId === option.id) return;
                this.activeOptionId = option.id;
                this.selectedCandidateId = this.activeOption.candidates[0]?.id ?? null; // SAFE: null leaves Place disabled until the author picks
                this.renderBody();
            });
        });
    }

    private renderContextStrip(container: HTMLElement): void {
        const { interval } = this.activeOption;
        const section = container.createDiv({ cls: 'ert-place-section' });
        const strip = section.createDiv({ cls: 'ert-place-context' });

        strip.createDiv({
            cls: 'ert-place-context-cell',
            text: interval.lowerNeighbor
                ? `${interval.lowerNeighbor.title} · ${formatWhenForYaml(interval.lowerNeighbor.when)}`
                : 'Nothing before'
        });
        strip.createDiv({ cls: 'ert-place-context-arrow', text: '→' });
        strip.createDiv({
            cls: 'ert-place-context-cell is-subject',
            text: this.context.sceneTitle
        });
        strip.createDiv({ cls: 'ert-place-context-arrow', text: '→' });
        strip.createDiv({
            cls: 'ert-place-context-cell',
            text: interval.upperNeighbor
                ? `${interval.upperNeighbor.title} · ${formatWhenForYaml(interval.upperNeighbor.when)}`
                : 'Nothing after'
        });

        section.createDiv({
            cls: 'ert-place-room',
            text: `${formatElapsedTime(interval.upperMs - interval.lowerMs)} of room`
        });
    }

    private renderCandidates(container: HTMLElement): void {
        const { candidates } = this.activeOption;
        const section = container.createDiv({ cls: 'ert-place-section' });
        section.createDiv({ cls: 'ert-drag-confirm-section-title', text: 'When does it happen?' });

        if (candidates.length === 0) {
            section.createDiv({
                cls: 'ert-place-empty',
                text: 'No suggestion fits this gap. Enter a date below.'
            });
            return;
        }

        const list = section.createDiv({ cls: 'ert-place-list' });
        candidates.forEach(candidate => this.renderCandidateRow(list, candidate));
    }

    private renderCandidateRow(list: HTMLElement, candidate: PlacementCandidate): void {
        const row = list.createDiv({
            cls: 'ert-place-row',
            attr: { role: 'radio', tabindex: '0', 'aria-checked': String(candidate.id === this.selectedCandidateId) }
        });
        row.toggleClass('is-selected', candidate.id === this.selectedCandidateId);

        const main = row.createDiv({ cls: 'ert-place-row-main' });
        main.createDiv({ cls: 'ert-place-row-label', text: candidate.label });
        main.createDiv({ cls: 'ert-place-row-when', text: candidate.storedWhen });
        main.createDiv({ cls: 'ert-place-row-elapsed', text: this.describeElapsed(candidate.when) });

        if (candidate.overlapWarning) {
            row.createDiv({
                cls: 'ert-place-row-warning',
                text: describeOverlap(candidate.overlapWarning)
            });
        }

        const select = () => {
            this.selectedCandidateId = candidate.id;
            this.renderBody();
        };
        row.addEventListener('click', select);
        row.addEventListener('keydown', (evt: KeyboardEvent) => {
            if (evt.key === 'Enter' || evt.key === ' ') {
                evt.preventDefault();
                select();
            }
        });
    }

    private renderCustomRow(container: HTMLElement): void {
        const section = container.createDiv({ cls: 'ert-place-section' });
        const row = section.createDiv({ cls: 'ert-place-row is-custom' });
        row.toggleClass('is-selected', this.selectedCandidateId === CUSTOM_ROW_ID);

        row.createDiv({ cls: 'ert-place-row-label', text: 'A specific date and time' });
        const input = row.createEl('input', {
            cls: 'ert-place-custom-input',
            attr: { type: 'text', placeholder: 'YYYY-MM-DD HH:MM', spellcheck: 'false' }
        });
        input.value = this.customInputValue;

        const feedback = row.createDiv({ cls: 'ert-place-row-elapsed' });

        const refresh = () => {
            this.customInputValue = input.value;
            this.selectedCandidateId = CUSTOM_ROW_ID;
            row.addClass('is-selected');
            // Typing here takes the selection off any candidate row. Done by hand
            // rather than by re-rendering so the caret keeps its position.
            this.bodyEl?.querySelectorAll('.ert-place-row:not(.is-custom)')
                .forEach(other => other.removeClass('is-selected'));

            const verdict = this.evaluateCustom();
            if (verdict === null) {
                feedback.setText('');
                row.removeClass('is-invalid');
            } else if (verdict.kind === 'ok') {
                feedback.setText(
                    verdict.overlapWarning
                        ? `${this.describeElapsed(verdict.when)} — ${describeOverlap(verdict.overlapWarning)}`
                        : this.describeElapsed(verdict.when)
                );
                row.removeClass('is-invalid');
            } else {
                feedback.setText(verdict.message);
                row.addClass('is-invalid');
            }
            this.syncPlaceButton();
        };

        input.addEventListener('input', refresh);
        input.addEventListener('focus', () => {
            if (this.selectedCandidateId === CUSTOM_ROW_ID) return;
            this.selectedCandidateId = CUSTOM_ROW_ID;
            this.renderBody();
        });

        if (this.selectedCandidateId === CUSTOM_ROW_ID) {
            refresh();
            window.setTimeout(() => input.focus(), 0);
        }
    }

    // ── selection state ────────────────────────────────────────────────────

    /** Null when the custom field is empty; otherwise the validator's verdict. */
    private evaluateCustom(): ReturnType<typeof validatePlacement> | null {
        const raw = this.customInputValue.trim();
        if (!raw) return null;
        const { interval } = this.activeOption;
        return validatePlacement(parseWhenField(raw), interval, this.context.draggedDurationMs);
    }

    private resolveSelection(): PlacementResult | null {
        if (this.selectedCandidateId === CUSTOM_ROW_ID) {
            const verdict = this.evaluateCustom();
            if (verdict?.kind !== 'ok') return null;
            return { when: verdict.when, storedWhen: verdict.storedWhen };
        }

        const candidate = this.activeOption.candidates.find(item => item.id === this.selectedCandidateId);
        if (!candidate) return null;
        return { when: candidate.when, storedWhen: candidate.storedWhen };
    }

    private syncPlaceButton(): void {
        if (!this.placeButtonEl || this.phase !== 'choose') return;
        this.placeButtonEl.disabled = this.resolveSelection() === null;
    }

    private describeElapsed(when: Date): string {
        const { interval } = this.activeOption;
        const parts: string[] = [];
        if (interval.lowerNeighbor) {
            parts.push(`${formatElapsedTime(when.getTime() - interval.lowerNeighbor.when.getTime())} after ${interval.lowerNeighbor.title}`);
        }
        if (interval.upperNeighbor) {
            parts.push(`${formatElapsedTime(interval.upperNeighbor.when.getTime() - when.getTime())} before ${interval.upperNeighbor.title}`);
        }
        return parts.join(' · ');
    }

    // ── phases ─────────────────────────────────────────────────────────────

    private onPrimaryClick(): void {
        if (this.phase === 'choose') {
            const selection = this.resolveSelection();
            if (!selection) return;
            this.phase = 'running';
            this.bodyEl?.addClass('is-committing');
            this.showStatusRow('is-live');
            this.statusTextEl?.setText('Writing When…');
            if (this.placeButtonEl) {
                this.placeButtonEl.disabled = true;
                this.placeButtonEl.textContent = 'Working...';
            }
            this.cancelButtonEl?.classList.add('is-hidden-action');
            this.resolveResult(selection);
            return;
        }

        if (this.phase === 'done') {
            this.resolveDismiss();
            this.close();
        }
    }

    async waitForPlacement(): Promise<PlacementResult | null> {
        return await new Promise<PlacementResult | null>((resolve) => {
            this.resultResolver = resolve;
            this.open();
        });
    }

    updateProgress(message: string): void {
        if (this.closed || this.phase !== 'running') return;
        this.showStatusRow('is-live');
        this.statusTextEl?.setText(message);
    }

    async finishWithDismiss(message: string, isError = false): Promise<void> {
        if (this.closed) return;
        this.phase = 'done';
        this.showStatusRow(isError ? 'is-error' : 'is-complete');
        this.statusTextEl?.setText(message);
        this.cancelButtonEl?.classList.add('is-hidden-action');
        if (this.placeButtonEl) {
            this.placeButtonEl.disabled = false;
            this.placeButtonEl.textContent = 'Dismiss';
        }
        await new Promise<void>((resolve) => {
            this.dismissResolver = resolve;
        });
    }

    onClose(): void {
        if (this.backdropGuard) {
            this.containerEl.removeEventListener('mousedown', this.backdropGuard, true);
            this.containerEl.removeEventListener('click', this.backdropGuard, true);
            this.backdropGuard = null;
        }
        this.closed = true;
        this.resolveResult(null);
        this.resolveDismiss();
        this.contentEl.empty();
    }

    private showStatusRow(stateClass: 'is-live' | 'is-complete' | 'is-error'): void {
        if (!this.statusRowEl) return;
        this.statusRowEl.classList.remove('is-hidden', 'is-live', 'is-complete', 'is-error');
        this.statusRowEl.classList.add(stateClass);
    }

    private resolveResult(value: PlacementResult | null): void {
        const resolver = this.resultResolver;
        this.resultResolver = null;
        resolver?.(value);
    }

    private resolveDismiss(): void {
        const resolver = this.dismissResolver;
        this.dismissResolver = null;
        resolver?.();
    }
}

function describeOverlap(warning: OverlapWarning): string {
    const span = formatElapsedTime(warning.overlapMs);
    return warning.kind === 'previous_runs_past'
        ? `“${warning.neighborTitle}” is still running ${span} into this scene.`
        : `This scene runs ${span} past the start of “${warning.neighborTitle}”.`;
}
