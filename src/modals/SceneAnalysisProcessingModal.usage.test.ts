import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import { SceneAnalysisProcessingModal } from './SceneAnalysisProcessingModal';
import type { PulseUsageReport } from '../sceneAnalysis/usage';

/** Minimal Obsidian element surface for rendering the real completion section. */
class Element {
    children: Element[] = [];
    parentElement: Element | null = null;
    constructor(public text = '', public cls = '', public tag = 'div') {}
    createDiv(options: { cls?: string; text?: string }) { return this.createEl('div', options); }
    createEl(tag: string, options: { cls?: string; text?: string } = {}) {
        const child = new Element(options.text, options.cls, tag);
        child.parentElement = this;
        this.children.push(child);
        return child;
    }
    querySelectorAll(selector: string): Element[] {
        return this.children.flatMap(child => [
            ...(child.cls.split(' ').includes(selector.slice(1)) ? [child] : []),
            ...child.querySelectorAll(selector)
        ]);
    }
    remove() {
        if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }
    insertBefore(child: Element, anchor: Element) {
        child.remove();
        child.parentElement = this;
        this.children.splice(this.children.indexOf(anchor), 0, child);
    }
    allText(): string { return [this.text, ...this.children.map(child => child.allText())].join('\n'); }
}
const known: PulseUsageReport = {
    provider: 'anthropic', model: 'claude-opus-5-5', costUSD: 0.077, partial: false,
    cache: 'hit', cacheDetail: 'HIT — 500 input tokens reused'
};
function setup(subplot?: string, task: 'pulse' | 'synopsis' = 'pulse') {
    const plugin = { settings: {} } as unknown as RadialTimelinePlugin;
    const modal = new SceneAnalysisProcessingModal({} as App, plugin, async () => 2, vi.fn(), undefined, subplot, false, task);
    const root = new Element();
    const prompt = root.createEl('details', { text: 'AI prompt' });
    const promptPre = prompt.createEl('pre', { text: 'Final prompt' });
    modal.contentEl = root as unknown as HTMLElement;
    const renderable = modal as unknown as { renderPulseUsage(): void; aiAdvancedDetailsEl: HTMLElement; aiAdvancedPreEl: HTMLElement };
    renderable.aiAdvancedDetailsEl = prompt as unknown as HTMLElement;
    renderable.aiAdvancedPreEl = promptPre as unknown as HTMLElement;
    return { modal, root, prompt, promptPre, render: () => renderable.renderPulseUsage() };
}
describe.each([undefined, 'Romance'])('Pulse completion usage renderer (subplot=%s)', subplot => {
    it('keeps only the batch total in view and puts cache and per-scene data inside AI prompt & context', () => {
        const { modal, root, prompt, promptPre, render } = setup(subplot);
        modal.recordPulseUsage('32 Darcy Calls', known);
        modal.recordPulseUsage('33 Fitzwilliam', { ...known, provider: 'openai', model: 'another-model', costUSD: 0.081 });
        render(); render();
        expect(root.querySelectorAll('.ert-pulse-summary-tip')).toHaveLength(1);
        expect(root.querySelectorAll('.ert-pulse-usage-detail')).toHaveLength(1);
        const headline = root.children[0];
        expect(headline.cls).toContain('ert-pulse-summary-tip');
        expect(headline.allText()).toContain('Batch usage cost: $0.158');
        expect(headline.allText()).not.toContain('hits');
        expect(root.children[1]).toBe(prompt);
        const detail = prompt.children[0];
        expect(detail.cls).toContain('ert-pulse-usage-detail');
        expect(prompt.children[1]).toBe(promptPre);
        expect(detail.allText()).toContain('2 hits');
        expect(detail.allText()).toContain('AI requests in this batch: 2.');
        expect(detail.allText()).toContain('32 Darcy Calls · anthropic / claude-opus-5-5 · $0.077');
        expect(detail.allText()).toContain('33 Fitzwilliam · openai / another-model · $0.081');
        expect(detail.allText()).toContain('HIT — 500 input tokens reused');
    });
    it('shows a partial known subtotal and unavailable rows; a new modal has no previous batch usage', () => {
        const { modal, root, render } = setup(subplot);
        modal.recordPulseUsage('32', known);
        modal.recordPulseUsage('33', { ...known, costUSD: null, partial: true, cache: 'unavailable', cacheDetail: 'Unavailable' });
        render();
        expect(root.allText()).toContain('Known batch usage cost (partial): $0.077');
        expect(root.allText()).toContain('Incomplete cost data');
        expect(root.allText()).toContain('Resume starts a new batch');
        const next = setup(subplot);
        next.render();
        expect(next.root.querySelectorAll('.ert-pulse-usage')).toHaveLength(0);
    });
});
it('does not add Pulse usage chrome to Summary refresh', () => {
    const { modal, root, render } = setup(undefined, 'synopsis');
    modal.recordPulseUsage('32', known);
    render();
    expect(root.querySelectorAll('.ert-pulse-usage')).toHaveLength(0);
});
