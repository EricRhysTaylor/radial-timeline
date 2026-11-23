import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component, type Workspace } from 'obsidian';
import { wireLegendTrigger } from './LegendPanel';

/** Just enough of an element for the trigger wiring: classes, hover, containment. */
class NodeStub extends EventTarget {
    // Obsidian's cross-window check, as the main window sees it.
    instanceOf(type: typeof NodeStub): boolean { return this instanceof type; }
}
/** A node of a popout window: its own window's Node, never the main window's. */
class PopoutNodeStub extends EventTarget {
    instanceOf(type: { name: string }): boolean { return type.name === 'NodeStub'; }
    contains(node: unknown): boolean { return node === this; }
}
class ElementStub extends NodeStub {
    classes = new Set<string>();
    attributes = new Map<string, string>();
    hidden = false;
    hovered = false;
    connected = true;
    shown = true;
    children: ElementStub[] = [];
    // Changes when the view carrying the element moves to another window.
    constructor(public ownerDocument: DocStub) { super(); }
    get isConnected() { return this.connected; }
    isShown() { return this.shown; }
    hasClass(cls: string) { return this.classes.has(cls); }
    addClass(cls: string) { this.classes.add(cls); }
    removeClass(cls: string) { this.classes.delete(cls); }
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    matches(selector: string) { return selector === ':hover' && this.hovered; }
    contains(node: unknown): boolean { return node === this || this.children.some(child => child.contains(node)); }
}
class DocStub extends NodeStub {
    activeElement: unknown = null;
}
/** Workspace events by name, fired by the test. */
class WorkspaceStub {
    handlers = new Map<string, Array<(...args: unknown[]) => void>>();
    on(name: string, handler: (...args: unknown[]) => void) {
        this.handlers.set(name, [...(this.handlers.get(name) ?? []), handler]);
        return {};
    }
    trigger(name: string, ...args: unknown[]) { for (const handler of this.handlers.get(name) ?? []) handler(...args); }
}

/** One page: a document and workspace that several keys can share. */
function page() {
    const doc = new DocStub();
    const workspace = new WorkspaceStub();
    const element = () => new ElementStub(doc);
    /** A press as it reaches the document's capture listeners, with its real target. */
    const pressOn = (target: EventTarget, inDoc: DocStub = doc) => {
        const event = new Event('pointerdown');
        // Obsidian's targetNode is the event's target, typed as a Node.
        Object.defineProperty(event, 'target', { value: target });
        Object.defineProperty(event, 'targetNode', { value: target });
        inDoc.dispatchEvent(event);
    };
    const key = () => {
        const pane = element();
        const trigger = element();
        pane.children.push(trigger);
        const panel = element();
        const row = element();
        panel.children.push(row);
        const component = new Component();
        component.load();
        const beforeShow = vi.fn();
        wireLegendTrigger(component, trigger as unknown as HTMLElement, panel as unknown as HTMLElement, beforeShow, workspace as unknown as Workspace);
        const open = () => panel.hasClass('is-visible');
        /** A full click on the button: the press, then the click the button stops. */
        const click = () => { pressOn(trigger); trigger.dispatchEvent(new Event('click')); };
        return { pane, trigger, panel, row, component, beforeShow, open, click, leaf: { view: { containerEl: pane } } };
    };
    return { doc, workspace, element, pressOn, key };
}

function setup() {
    const p = page();
    const k = p.key();
    const fire = (el: EventTarget, type: string) => el.dispatchEvent(new Event(type));
    const hoverOff = (el: ElementStub) => { el.hovered = false; fire(el, 'mouseleave'); vi.advanceTimersByTime(200); };
    return { ...p, ...k, fire, hoverOff };
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
        k.click();
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
        k.click();
        expect(k.open()).toBe(true);
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(true);
    });

    it('fills the panel once per opening, not on every pass of the pointer', () => {
        const k = setup();
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        k.click();
        k.fire(k.panel, 'mouseenter');
        expect(k.beforeShow).toHaveBeenCalledTimes(1);
    });

    it('closes a pinned panel on a second click, Escape, or a press elsewhere', () => {
        const second = setup();
        second.click();
        second.click();
        expect(second.open()).toBe(false);
        expect(second.trigger.attributes.get('aria-expanded')).toBe('false');

        const escape = setup();
        escape.click();
        escape.doc.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
        expect(escape.open()).toBe(false);

        const elsewhere = setup();
        elsewhere.click();
        elsewhere.pressOn(elsewhere.row);
        expect(elsewhere.open()).toBe(true);
        elsewhere.pressOn(elsewhere.element());
        expect(elsewhere.open()).toBe(false);
    });

    it('stays pinned on a press inside it in a popout window', () => {
        const k = setup();
        k.click();
        const popoutRow = new PopoutNodeStub();
        k.panel.children.push(popoutRow as unknown as ElementStub);
        k.pressOn(popoutRow);
        expect(k.open()).toBe(true);
    });

    it('in a view moved to a new window, a press elsewhere in that window closes it', () => {
        const k = setup();
        // The view, and its key with it, moves to a popout window.
        const popout = new DocStub();
        for (const el of [k.pane, k.trigger, k.panel, k.row]) el.ownerDocument = popout;
        k.click();
        // Nothing is listening for this key in the main window any more.
        k.pressOn(k.element(), k.doc);
        expect(k.open()).toBe(true);
        k.pressOn(k.row, popout);
        expect(k.open()).toBe(true);
        k.pressOn(new ElementStub(popout), popout);
        expect(k.open()).toBe(false);
        // Escape in that window closes it too.
        k.click();
        popout.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }));
        expect(k.open()).toBe(false);
    });

    it('closes an open key whose view moves to another window', () => {
        const k = setup();
        k.click();
        const popout = new DocStub();
        for (const el of [k.pane, k.trigger, k.panel, k.row]) el.ownerDocument = popout;
        k.workspace.trigger('layout-change');
        expect(k.open()).toBe(false);
        // Opened again there, it listens there.
        k.click();
        k.pressOn(new ElementStub(popout), popout);
        expect(k.open()).toBe(false);
    });

    it('closes one pinned key when another key\'s button is pressed', () => {
        const p = page();
        const first = p.key();
        const second = p.key();
        first.click();
        second.click();
        expect(first.open()).toBe(false);
        expect(second.open()).toBe(true);
    });

    it('opens no second key on hover or focus while one is pinned', () => {
        const p = page();
        const first = p.key();
        const second = p.key();
        first.click();
        second.trigger.dispatchEvent(new Event('mouseenter'));
        second.trigger.dispatchEvent(new Event('focus'));
        expect(second.open()).toBe(false);
        expect(first.open()).toBe(true);
        // A pinned key closed, hover works on the other again.
        first.click();
        second.trigger.dispatchEvent(new Event('mouseenter'));
        expect(second.open()).toBe(true);
    });

    it('lets other keys open on hover after a pinned key\'s pane closes (Cmd+W)', () => {
        const p = page();
        const first = p.key();
        const second = p.key();
        first.click();
        // The pane closes with its key pinned: no press, no workspace event, just unload.
        first.component.unload();
        expect(first.open()).toBe(false);
        second.trigger.dispatchEvent(new Event('mouseenter'));
        expect(second.open()).toBe(true);
    });

    it('moves the pin on a keyboard click, which sends no press', () => {
        const p = page();
        const first = p.key();
        const second = p.key();
        first.click();
        second.trigger.dispatchEvent(new Event('click'));
        expect(first.open()).toBe(false);
        expect(second.open()).toBe(true);
        // The second is now the pinned one: a press on its own row keeps it.
        p.pressOn(second.row);
        expect(second.open()).toBe(true);
    });

    it('starts unpinned after the view closes the panel itself', () => {
        const k = setup();
        k.click();
        // A mode change closes the timeline key without going through the trigger.
        k.panel.removeClass('is-visible');
        k.trigger.hovered = true; k.fire(k.trigger, 'mouseenter');
        expect(k.open()).toBe(true);
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(false);
        // And the next click opens and pins rather than reading as a second click.
        k.click();
        expect(k.open()).toBe(true);
    });

    it('never opens from a hidden button', () => {
        const k = setup();
        k.trigger.hidden = true;
        k.fire(k.trigger, 'mouseenter');
        k.click();
        expect(k.open()).toBe(false);
        expect(k.beforeShow).not.toHaveBeenCalled();
    });
});

describe('a key belongs to its pane', () => {
    it('closes when another pane takes the focus (a keyboard note switch)', () => {
        const k = setup();
        k.click();
        k.workspace.trigger('active-leaf-change', { view: { containerEl: k.element() } });
        expect(k.open()).toBe(false);
    });

    it('stays open when its own pane takes the focus, as a formatting row does', () => {
        const k = setup();
        k.click();
        k.workspace.trigger('active-leaf-change', k.leaf);
        expect(k.open()).toBe(true);
    });

    it('refills an open key on a layout change, so Reading and Editing rows stay true', () => {
        const k = setup();
        k.click();
        k.workspace.trigger('layout-change');
        expect(k.beforeShow).toHaveBeenCalledTimes(2);
        expect(k.open()).toBe(true);
        // Still pinned: the pointer leaving doesn't close it.
        k.hoverOff(k.trigger);
        expect(k.open()).toBe(true);
    });

    it('closes on a layout change that hides or removes its button', () => {
        const hidden = setup();
        hidden.click();
        hidden.trigger.shown = false;
        hidden.workspace.trigger('layout-change');
        expect(hidden.open()).toBe(false);

        const removed = setup();
        removed.click();
        removed.trigger.connected = false;
        removed.workspace.trigger('layout-change');
        expect(removed.open()).toBe(false);
    });

    it('leaves a closed key closed on workspace changes', () => {
        const k = setup();
        k.workspace.trigger('layout-change');
        k.workspace.trigger('active-leaf-change', null);
        expect(k.open()).toBe(false);
        expect(k.beforeShow).not.toHaveBeenCalled();
    });
});
