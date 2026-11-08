import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { wireLegendTrigger } from './LegendPanel';

/** Just enough of an element for the trigger wiring: classes, hover, containment. */
class NodeStub extends EventTarget {}
class ElementStub extends NodeStub {
    classes = new Set<string>();
    attributes = new Map<string, string>();
    hidden = false;
    hovered = false;
    children: ElementStub[] = [];
    constructor(readonly ownerDocument: DocStub) { super(); }
    hasClass(cls: string) { return this.classes.has(cls); }
    addClass(cls: string) { this.classes.add(cls); }
    removeClass(cls: string) { this.classes.delete(cls); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    matches(selector: string) { return selector === ':hover' && this.hovered; }
    contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
}
class DocStub extends NodeStub {
    activeElement: unknown = null;
    body!: ElementStub;
}

function setup() {
    const doc = new DocStub();
    doc.body = new ElementStub(doc);
    const trigger = new ElementStub(doc);
    const panel = new ElementStub(doc);
    const row = new ElementStub(doc);
    panel.children.push(row);
    const elsewhere = new ElementStub(doc);
    // The trigger stops its own click, so only clicks elsewhere reach the body (clickBody).
    const component = new Component();
    component.load();
    const beforeShow = vi.fn();
    wireLegendTrigger(component, trigger as unknown as HTMLElement, panel as unknown as HTMLElement, beforeShow);
    const open = () => panel.hasClass('is-visible');
    const fire = (el: EventTarget, type: string) => el.dispatchEvent(new Event(type));
    const hoverOff = (el: ElementStub) => { el.hovered = false; fire(el, 'mouseleave'); vi.advanceTimersByTime(200); };
    const clickBody = (target: ElementStub) => {
        // A click elsewhere reaches the body with its own target.
        const event = new Event('click');
        Object.defineProperty(event, 'target', { value: target });
        doc.body.dispatchEvent(event);
    };
    return { doc, trigger, panel, row, elsewhere, component, beforeShow, open, fire, hoverOff, clickBody };
}

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('Node', NodeStub);
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('key panel trigger', () => {
    it('opens on hover for a look and closes when the pointer leaves', () => {
        const k = setup();
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        expect(k.open()).toBe(true);
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(false);
    });

    it('never closes on the click that follows a hover: the click pins it', () => {
        const k = setup();
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        k.fire(k.trigger, 'click');
        expect(k.open()).toBe(true);
        expect(k.trigger.attributes.get('aria-expanded')).toBe('true');
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(true);
        // A focused button that loses focus keeps a pinned panel too.
        k.fire(k.trigger, 'blur'); vi.advanceTimersByTime(200);
        expect(k.open()).toBe(true);
    });

    it('opens and pins on a click with no hover (touch, keyboard)', () => {
        const k = setup();
        k.fire(k.trigger, 'click');
        expect(k.open()).toBe(true);
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(true);
    });

    it('fills the panel once per opening, not on every pass of the pointer', () => {
        const k = setup();
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        k.fire(k.trigger, 'click');
        k.fire(k.panel, 'mouseenter');
        expect(k.beforeShow).toHaveBeenCalledTimes(1);
    });

    it('closes a pinned panel on a second click, Escape, or a click elsewhere', () => {
        const second = setup();
        second.fire(second.trigger, 'click');
        second.fire(second.trigger, 'click');
        expect(second.open()).toBe(false);
        expect(second.trigger.attributes.get('aria-expanded')).toBe('false');

        const escape = setup();
        escape.fire(escape.trigger, 'click');
        escape.doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
        expect(escape.open()).toBe(false);

        const elsewhere = setup();
        elsewhere.fire(elsewhere.trigger, 'click');
        elsewhere.clickBody(elsewhere.row);
        expect(elsewhere.open()).toBe(true);
        elsewhere.clickBody(elsewhere.elsewhere);
        expect(elsewhere.open()).toBe(false);
    });

    it('starts unpinned after the view closes the panel itself', () => {
        const k = setup();
        k.fire(k.trigger, 'click');
        // A mode change closes the timeline key without going through the trigger.
        k.panel.removeClass('is-visible');
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        expect(k.open()).toBe(true);
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(false);
        // And the next click opens and pins rather than reading as a second click.
        k.fire(k.trigger, 'click');
        expect(k.open()).toBe(true);
    });

    it('never opens from a hidden button', () => {
        const k = setup();
        k.trigger.hidden = true;
        k.fire(k.trigger, 'mouseenter');
        k.fire(k.trigger, 'click');
        expect(k.open()).toBe(false);
        expect(k.beforeShow).not.toHaveBeenCalled();
    });
});
