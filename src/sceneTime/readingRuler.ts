import { MarkdownRenderChild, MarkdownView, TFile, type MarkdownPostProcessorContext } from 'obsidian';
import type { SceneTimeService } from './SceneTimeService';
import { createTimeTick } from './editorRuler';
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
    // Reading sections and Live Preview embeds share processors; the editor already has its own gutter.
    class ReadingRail extends MarkdownRenderChild {
        private rail: HTMLElement | undefined;
        onload(): void {
            el.addClass('ert-time-reading-block');
            this.rail = el.createDiv({ cls: 'ert-time-reading-rail' });
            const render = (): void => {
                if (!this.rail) return;
                this.rail.empty();
                this.rail.hidden = !el.closest('.markdown-preview-view');
                if (this.rail.hidden) return;
                const current = service.snapshot(sceneFile, source);
                if (!current) return;
                const occurrences = new Map<string, number>();
                for (const cue of current.cues.filter(cue => cue.line >= section!.lineStart && cue.line <= section!.lineEnd)) {
                    const occurrence = occurrences.get(cue.quote) || 0;
                    occurrences.set(cue.quote, occurrence + 1);
                    const range = quoteRange(el, cue.quote, occurrence);
                    if (!range) continue; // No rendered anchor: do not place a misleading marker.
                    const rect = range.getBoundingClientRect();
                    const tick = createTimeTick(el.ownerDocument, cue, () => {
                        const currentSource = (): string => {
                            let value = source;
                            service.plugin.app.workspace.iterateAllLeaves(leaf => {
                                if (leaf.view instanceof MarkdownView && leaf.view.file === file) value = leaf.view.getViewData();
                            });
                            return value;
                        };
                        new SceneTimeModal(service, sceneFile, currentSource, cue.key).open();
                    });
                    // SAFE: measured prose-relative marker position; not a theme/style override.
                    tick.style.top = `${rect.top - el.getBoundingClientRect().top}px`;
                    this.rail.appendChild(tick);
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
