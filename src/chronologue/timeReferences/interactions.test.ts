import { describe, expect, it, vi } from 'vitest';

const shown: Element[] = [];
vi.mock('./editor', () => ({ openTimeReference: vi.fn() }));
vi.mock('./popover', async importOriginal => {
    const actual = await importOriginal<typeof import('./popover')>();
    class ReferencePopover {
        pinned = false;
        returningFocus = false;
        show(_content: unknown, anchor: Element): void { shown.push(anchor); }
        hide(): void {}
        dismiss(): void {}
        contains(): boolean { return false; }
    }
    return { ...actual, ReferencePopover };
});

import { setupTimeReferenceInteractions } from './interactions';
import type { RadialTimelineView } from '../../view/TimeLineView';

class FakeNode {
    parent: FakeElement | null = null;
}
class FakeElement extends FakeNode {
    classList = { contains: (name: string) => this.classes.has(name), toggle: () => {} };
    dataset: Record<string, string> = {};
    constructor(private readonly classes: Set<string>, private readonly attrs: Record<string, string> = {}) { super(); }
    instanceOf(type: typeof FakeNode): boolean { return this instanceof type; }
    getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
    hasAttribute(name: string): boolean { return name in this.attrs; }
    querySelector(): null { return null; }
    getBoundingClientRect() { return { left: 0, right: 10, top: 0, bottom: 10, width: 10, height: 10 }; }
    contains(node: unknown): boolean {
        for (let at = node instanceof FakeNode ? node : null; at; at = at.parent) if (at === this) return true;
        return false;
    }
    closest(): FakeElement | null {
        for (let at: FakeElement | null = this; at; at = at.parent) if (at.classes.has('ert-time-reference')) return at;
        return null;
    }
    child(): FakeElement { const el = new FakeElement(new Set()); el.parent = this; return el; }
}

describe('time reference marker hover', () => {
    it('opens the popover once on entering a marker, not again for each part the pointer crosses', () => {
        const key = JSON.stringify(['Book/01 Scene.md', 0, { Label: 'Ramsgate', When: '1811-07', Kind: 'recollection' }]);
        const marker = new FakeElement(new Set(['ert-time-reference']), { 'data-reference-keys': JSON.stringify([key]) });
        const hit = marker.child(), label = marker.child();
        const outside = new FakeElement(new Set());
        const doc = {
            defaultView: { Node: FakeNode, Element: FakeElement, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {} },
        };
        const svg = {
            ownerDocument: doc,
            classList: { toggle: () => {} },
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 400 }),
            querySelectorAll: (selector: string) => selector.startsWith('.ert-time-reference[data-reference-keys]') ? [marker] : [],
        };
        const handlers = new Map<EventTarget, Map<string, (event: Event) => void>>();
        const view = {
            plugin: { settings: {} },
            renderScope: {
                register: () => {},
                registerDomEvent: (target: EventTarget, type: string, handler: (event: Event) => void) => {
                    if (!handlers.has(target)) handlers.set(target, new Map());
                    handlers.get(target)!.set(type, handler);
                },
            },
        } as unknown as RadialTimelineView;
        setupTimeReferenceInteractions(view, svg as unknown as SVGSVGElement);
        const over = handlers.get(svg as unknown as EventTarget)!.get('pointerover')!;
        const move = (target: FakeElement, relatedTarget: FakeElement) => over({ target, relatedTarget } as unknown as Event);

        move(hit, outside);
        expect(shown).toEqual([marker]);
        // Crossing from the hit area to the label and back stays inside the marker.
        move(label, hit);
        move(hit, label);
        expect(shown).toEqual([marker]);
        // Leaving and coming back opens it again.
        move(hit, outside);
        expect(shown).toEqual([marker, marker]);
    });
});
