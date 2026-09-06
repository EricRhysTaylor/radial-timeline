import { describe, expect, it, vi } from 'vitest';
import { Component, setTooltip } from 'obsidian';
import { abbreviateLocalModelId, buildLocalFeatureSummary, createLocalLlmModelPills } from './AiLocalLlmModelPills';
import type { LocalLlmCapabilityAssessment } from '../../ai/localLlm/capabilityInference';
vi.mock('../../../tests/mocks/obsidian.ts', async original => ({
    ...await original<typeof import('obsidian')>(), setTooltip: vi.fn()
}));
class ElementStub extends EventTarget {
    children: ElementStub[] = []; text = ''; classes = new Set<string>(); attributes = new Map<string, string>();
    createSpan(options: { text?: string; cls?: string }) {
        const child = new ElementStub(); child.text = options.text ?? '';
        (options.cls ?? '').split(' ').forEach(cls => child.classes.add(cls)); this.children.push(child); return child;
    }
    addClass(cls: string) { this.classes.add(cls); }
    setAttribute(name: string, value: string) { this.attributes.set(name, value); }
    empty() { this.children = []; }
    allText(): string { return this.text + this.children.map(child => child.allText()).join(' '); }
}
const capability: LocalLlmCapabilityAssessment = {
    tier: 3, tierName: 'Tier 3', tierSummary: 'Strong', confidence: 'validated',
    featureSupport: { summary: 'yes', pulses: 'partial', gossamer: 'no', inquiry: 'partial' }, explanation: 'Test assessment'
};
function setup() {
    const scope = new Component(); scope.load(); const list = new ElementStub(); const legend = new ElementStub();
    const select = vi.fn(async (_id: string) => {});
    const renderer = createLocalLlmModelPills(list as unknown as HTMLElement, legend as unknown as HTMLElement, scope, select);
    return { scope, list, legend, select, renderer };
}
function key(value: string): Event { const event = new Event('keydown', { cancelable: true }); Object.defineProperty(event, 'key', { value }); return event; }
describe('Local LLM model choices', () => {
    it('renders the active model, capability tier, legend, and accurate feature tooltip', () => {
        const p = setup(); const id = '/models/Example-Model'; p.renderer.render([{ id, capability }], id);
        const pill = p.list.children[0];
        expect(pill.children[0].text).toBe('Example-Model'); expect(pill.children).toHaveLength(2);
        expect(pill.classes.has('ert-ai-local-model-pill--tier3')).toBe(true);
        expect(pill.attributes.get('aria-label')).toContain(id);
        expect(pill.attributes.get('role')).toBe('button'); expect(pill.attributes.get('tabindex')).toBe('0');
        expect(p.legend.children).toHaveLength(4);
        expect(setTooltip).toHaveBeenLastCalledWith(pill, expect.stringContaining('Gossamer — ✗ Not supported'), { placement: 'top' });
        expect(buildLocalFeatureSummary(capability)).toBe('Summary · Pulses (limited) · Inquiry (possibly eligible)'); p.scope.unload();
    });
    it('selects the full model id by click, Enter, and Space, but ignores other keys', () => {
        const p = setup(); const id = '/models/Example-Model'; p.renderer.render([{ id, capability }], 'another');
        const pill = p.list.children[0]; expect(pill.children).toHaveLength(1);
        pill.dispatchEvent(new Event('click')); const enter = key('Enter'); pill.dispatchEvent(enter);
        const space = key(' '); pill.dispatchEvent(space); pill.dispatchEvent(key('ArrowDown'));
        expect(enter.defaultPrevented).toBe(true); expect(space.defaultPrevented).toBe(true);
        expect(p.select.mock.calls).toEqual([[id], [id], [id]]); p.scope.unload();
    });
    it('releases detached pill listeners on redraw and when the list is cleared', () => {
        const p = setup(); p.renderer.render([{ id: 'old', capability }], 'old'); const old = p.list.children[0];
        p.renderer.render([{ id: 'new', capability }], 'new'); const current = p.list.children[0];
        old.dispatchEvent(new Event('click')); old.dispatchEvent(key('Enter')); expect(p.select).not.toHaveBeenCalled();
        current.dispatchEvent(new Event('click')); expect(p.select).toHaveBeenCalledExactlyOnceWith('new');
        p.renderer.clear(); current.dispatchEvent(new Event('click')); expect(p.select).toHaveBeenCalledTimes(1);
        expect(p.list.children).toHaveLength(0); expect(p.legend.children).toHaveLength(0); p.scope.unload();
    });
    it('stops selection and redraw after the section closes', () => {
        const p = setup(); p.renderer.render([{ id: 'old', capability }], 'old'); const old = p.list.children[0];
        p.scope.unload(); old.dispatchEvent(new Event('click')); p.renderer.render([{ id: 'new', capability }], 'new');
        expect(p.select).not.toHaveBeenCalled(); expect(p.list.children[0]).toBe(old);
    });
    it('clears a previous list when no models remain', () => {
        const p = setup(); p.renderer.render([{ id: 'old', capability }], 'old'); const old = p.list.children[0];
        p.renderer.render([], ''); old.dispatchEvent(key(' '));
        expect(p.select).not.toHaveBeenCalled(); expect(p.list.children).toHaveLength(0); expect(p.legend.children).toHaveLength(0); p.scope.unload();
    });
    it.each([['/models/Model', 'Model'], ['C:\\models\\Model', 'Model'], ['', '']])('abbreviates %s only for display', (id, label) => {
        expect(abbreviateLocalModelId(id)).toBe(label);
    });
});
