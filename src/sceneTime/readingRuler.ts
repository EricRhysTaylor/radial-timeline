import { MarkdownRenderChild, MarkdownView, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import type { SceneTimeService } from './SceneTimeService';
import { createDurationLine, createTimeTick } from './editorRuler';
import { durationSegment } from './model';
import { openSceneLineTime } from './ManualTimeModal';
import { SceneTimeModal } from './SceneTimeModal';

/** Find a rendered quote across emphasis/link text nodes without modifying prose. */
function quoteRange(el: HTMLElement, quote: string, occurrence: number): Range | null {
    const doc = el.ownerDocument;
    const walker = doc.createTreeWalker(el, 4 /* SHOW_TEXT */);
    const nodes: Text[] = [];
    let text = '';
    let node: Node | null;
    while ((node = walker.nextNode())) {
        if (node.parentElement?.closest('.ert-time-reading-rail, code, pre, a, h1, h2, h3, h4, h5, h6')) continue;
        nodes.push(node as Text); // SAFE: SHOW_TEXT yields text nodes only.
        text += node.textContent;
    }
    let start = -1;
    for (let index = 0; index <= occurrence; index++) {
        start = text.indexOf(quote, start + 1);
        if (start < 0) return null;
    }
    const end = start + quote.length;
    const range = doc.createRange();
    let offset = 0;
    for (const textNode of nodes) {
        const next = offset + textNode.length;
        if (start >= offset && start < next) range.setStart(textNode, start - offset);
        if (end > offset && end <= next) { range.setEnd(textNode, end - offset); return range; }
        offset = next;
    }
    return null;
}

export async function renderReadingTime(service: SceneTimeService, el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
    const file = service.plugin.app.vault.getAbstractFileByPath(ctx.sourcePath);
    if (!(file instanceof TFile) || !service.metadata(file)) return;
    const sceneFile = file;
    const source = await service.plugin.app.vault.cachedRead(file);
    const section = ctx.getSectionInfo(el);
    if (!section) return;
    const snapshot = service.snapshot(file, source);
    if (!snapshot || !Array.from(snapshot.proseLines).some(line => line >= section.lineStart && line <= section.lineEnd)) return;
    const review = (key?: string): void => {
        const currentSource = (): string => {
            let value = source;
            service.plugin.app.workspace.iterateAllLeaves(leaf => {
                if (leaf.view instanceof MarkdownView && leaf.view.file === file) value = leaf.view.getViewData();
            });
            return value;
        };
        new SceneTimeModal(service, sceneFile, currentSource, key).open();
    };
    // Reading sections and Live Preview embeds share processors; the editor already has its own gutter.
    class ReadingRail extends MarkdownRenderChild {
        private rail: HTMLElement | undefined;
        onload(): void {
            el.addClass('ert-time-reading-block');
            this.rail = el.createDiv({ cls: 'ert-time-reading-rail' });
            this.rail.title = 'Click the strip to assign or review scene time';
            this.rail.addEventListener('click', event => {
                if (event.target !== this.rail) return;
                const current = service.snapshot(sceneFile, source);
                if (!current) return;
                const lines = source.split('\n');
                let closest: { line: number; distance: number } | null = null;
                const occurrences = new Map<string, number>();
                for (let line = section!.lineStart; line <= section!.lineEnd; line++) {
                    if (!current.proseLines.has(line)) continue;
                    const quote = lines[line].trim();
                    const occurrence = occurrences.get(quote) || 0;
                    occurrences.set(quote, occurrence + 1);
                    const range = quoteRange(el, quote, occurrence);
                    if (!range) continue;
                    const rect = range.getBoundingClientRect();
                    const distance = Math.max(rect.top - event.clientY, event.clientY - rect.bottom, 0);
                    if (!closest || distance < closest.distance) closest = { line, distance };
                }
                if (closest) {
                    event.preventDefault();
                    event.stopPropagation();
                    openSceneLineTime(service, sceneFile, source, closest.line);
                }
            });
            const render = (): void => {
                if (!this.rail) return;
                this.rail.empty();
                this.rail.hidden = service.plugin.settings.showSceneTimeCueBar === false || !service.metadata(sceneFile) || !el.closest('.markdown-preview-view');
                el.toggleClass('ert-time-reading-block', !this.rail.hidden);
                if (this.rail.hidden) return;
                const current = service.snapshot(sceneFile, source);
                if (!current) return;
                const segment = durationSegment(current, section!.lineStart, section!.lineEnd);
                const durationLine = segment && createDurationLine(this.rail, segment, () => review());
                const occurrences = new Map<string, number>();
                for (const cue of current.cues.filter(cue => cue.line >= section!.lineStart && cue.line <= section!.lineEnd)) {
                    const occurrence = occurrences.get(cue.quote) || 0;
                    occurrences.set(cue.quote, occurrence + 1);
                    const range = quoteRange(el, cue.quote, occurrence);
                    if (!range) continue; // No rendered anchor: do not place a misleading marker.
                    const rect = range.getBoundingClientRect();
                    const top = rect.top - el.getBoundingClientRect().top;
                    const tick = createTimeTick(el.ownerDocument, cue, () => review(cue.key), current.cues.filter(item => item.line === cue.line).indexOf(cue));
                    // SAFE: measured prose-relative marker position; not a theme/style override.
                    this.rail.appendChild(tick);
                    tick.style.top = `${top}px`; // SAFE: exact rendered phrase anchor; same-line cues use stable vertical stack offsets.
                    if (durationLine && cue.from === segment?.stopFrom) durationLine.style.setProperty('--ert-time-duration-stop', `${Math.max(0, top)}px`); // SAFE: duration line ends at its rendered stop cue.
                }
            };
            const win = el.ownerDocument.defaultView;
            if (win) {
                const observer = new win.ResizeObserver(render);
                observer.observe(el);
                this.register(() => observer.disconnect());
            }
            this.register(service.subscribe(render));
            render();
        }
        onunload(): void { this.rail?.remove(); this.rail = undefined; el.removeClass('ert-time-reading-block'); }
    }
    ctx.addChild(new ReadingRail(el));
}
