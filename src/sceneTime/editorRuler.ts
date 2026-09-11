import { StateEffect } from '@codemirror/state';
import { EditorView, GutterMarker, ViewPlugin, gutter, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, setTooltip } from 'obsidian';
import { cueDescription, cueState, type ResolvedCue, type SceneTimeSnapshot } from './model';
import type { SceneTimeService } from './SceneTimeService';
import { SceneTimeModal } from './SceneTimeModal';

const refreshRuler = StateEffect.define<null>();
function editorFile(view: EditorView) {
    return view.state.field(editorInfoField, false)?.file;
}

export function createTimeTick(doc: Document, cue: ResolvedCue, open: () => void): HTMLButtonElement {
    const button = doc.win.createEl('button');
    button.className = `ert-time-marker ert-time-${cueState(cue)}`;
    button.type = 'button';
    button.dataset.cueFrom = String(cue.from);
    setTooltip(button, `“${cue.quote}” · ${cueDescription(cue)} · Click to review`);
    const stroke = doc.win.createSpan();
    stroke.className = 'ert-time-tick';
    if (cueState(cue) === 'uncertain') stroke.setText('?');
    button.appendChild(stroke);
    button.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); open(); });
    return button;
}

export function sceneTimeEditorExtension(service: SceneTimeService) {
    const state = ViewPlugin.fromClass(class {
        snapshot: SceneTimeSnapshot | null = null;
        layoutVersion = 0;
        gutterEl: HTMLElement | null = null;
        unsubscribe: () => void;
        constructor(readonly view: EditorView) {
            this.read();
            this.measure();
            this.unsubscribe = service.subscribe(() => view.dispatch({ effects: refreshRuler.of(null) }));
        }
        read(): void {
            const file = editorFile(this.view);
            this.snapshot = file ? service.snapshot(file, this.view.state.doc.toString()) : null;
        }
        update(update: ViewUpdate): void {
            if (update.geometryChanged) this.layoutVersion++;
            if (update.docChanged || update.startState.field(editorInfoField, false)?.file !== editorFile(this.view) || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshRuler)))) this.read();
            if (update.docChanged) service.scheduleRefresh();
            if (update.geometryChanged || update.viewportChanged || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshRuler)))) this.measure();
        }
        measure(): void {
            this.view.requestMeasure({
                key: this,
                read: () => {
                    const el = this.view.dom.querySelector<HTMLElement>('.cm-gutters-after:has(> .ert-time-gutter:only-child)');
                    if (!el) return null;
                    const first = el.querySelector<HTMLElement>('.ert-time-marker-row');
                    const position = first ? Number(first.dataset.lineFrom) : NaN;
                    const rect = Number.isFinite(position) && position <= this.view.state.doc.length ? this.view.coordsAtPos(position) : null;
                    const delta = rect && first ? rect.top - first.getBoundingClientRect().top : 0;
                    const padding = (parseFloat(el.style.paddingTop) || 0) + delta;
                    const ticks = Array.from(el.querySelectorAll<HTMLElement>('.ert-time-marker')).map(tick => {
                        const from = Number(tick.dataset.cueFrom);
                        const anchor = from <= this.view.state.doc.length ? this.view.coordsAtPos(from) : null;
                        return { tick, top: anchor && tick.parentElement ? anchor.top - tick.parentElement.getBoundingClientRect().top - delta : null };
                    });
                    return { el, padding, ticks };
                },
                write: measurement => {
                    if (!measurement) return;
                    this.gutterEl = measurement.el;
                    measurement.el.addClass('ert-ui', 'ert-time-gutters');
                    measurement.el.style.paddingTop = `${Math.max(0, measurement.padding)}px`; // SAFE: align rail with prose after Obsidian's metadata widget.
                    for (const { tick, top } of measurement.ticks) {
                        if (top !== null) tick.style.top = `${top}px`; // SAFE: measured wrapped-line marker position.
                    }
                }
            });
        }
        destroy(): void { this.unsubscribe(); this.gutterEl?.removeClass('ert-ui', 'ert-time-gutters'); }
    });

    class Marker extends GutterMarker {
        elementClass: string;
        constructor(readonly cues: ResolvedCue[], readonly boundary: string, readonly layoutVersion: number, readonly lineFrom: number) {
            super();
            this.elementClass = `ert-time-rail${cues.some(cue => cue.decision && cue.decision.action !== 'exclude' && !cue.conflict) ? ' ert-time-rail-confirmed' : ''}`;
        }
        eq(other: Marker): boolean { return this.lineFrom === other.lineFrom && this.layoutVersion === other.layoutVersion && this.boundary === other.boundary && JSON.stringify(this.cues) === JSON.stringify(other.cues); }
        toDOM(view: EditorView): HTMLElement {
            const row = view.dom.ownerDocument.win.createDiv();
            row.className = 'ert-time-marker-row';
            row.dataset.lineFrom = String(this.lineFrom);
            if (this.boundary) {
                const cap = row.createSpan({ cls: 'ert-time-boundary', text: '━' });
                setTooltip(cap, this.boundary);
            }
            for (const cue of this.cues) {
                const tick = createTimeTick(view.dom.ownerDocument, cue, () => {
                    const file = editorFile(view);
                    if (file) new SceneTimeModal(service, file, () => view.state.doc.toString(), cue.key).open();
                });
                row.appendChild(tick);
            }
            return row;
        }
    }

    return [state, gutter({
        class: 'ert-time-gutter', side: 'after',
        lineMarker: (view, line) => {
            const snapshot = view.plugin(state)?.snapshot;
            if (!snapshot) return null;
            const number = view.state.doc.lineAt(line.from).number - 1;
            if (!snapshot.proseLines.has(number)) return null;
            const boundary = number === snapshot.firstLine ? 'Scene start · elapsed 0' : number === snapshot.lastLine ? 'Last prose · end of scene' : '';
            return new Marker(snapshot.cues.filter(cue => cue.line === number), boundary, view.plugin(state)!.layoutVersion, line.from);
        },
        lineMarkerChange: update => update.docChanged || update.geometryChanged || update.startState.field(editorInfoField, false)?.file !== editorFile(update.view) || update.transactions.some(transaction => transaction.effects.some(effect => effect.is(refreshRuler)))
    })];
}
