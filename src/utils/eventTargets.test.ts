import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { elementOf, movesOutOf } from './eventTargets';

class NodeStub {
    // Obsidian's cross-window check, as the main window sees it.
    instanceOf(type: typeof NodeStub): boolean { return this instanceof type; }
}
class ElementStub extends NodeStub {}
/** An element of a popout window: its own window's Element and Node, never the main window's. */
class PopoutElementStub {
    instanceOf(type: { name: string }): boolean { return type.name === 'NodeStub' || type.name === 'ElementStub'; }
}

beforeEach(() => {
    vi.stubGlobal('Node', NodeStub);
    vi.stubGlobal('Element', ElementStub);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('the element an event is on', () => {
    it('is the target when it is an element of the main window', () => {
        const el = new ElementStub();
        expect(elementOf(el as unknown as EventTarget)).toBe(el);
    });

    it('is the target when it is an element of a popout window', () => {
        const el = new PopoutElementStub();
        expect(el instanceof ElementStub).toBe(false);
        expect(elementOf(el as unknown as EventTarget)).toBe(el);
    });

    it('is null for a node that is not an element, a window, or no target', () => {
        expect(elementOf(new NodeStub() as unknown as EventTarget)).toBeNull();
        expect(elementOf({} as EventTarget)).toBeNull();
        expect(elementOf(null)).toBeNull();
    });
});

describe('a pointer or drag leaving an element', () => {
    const inside = new ElementStub();
    const popoutInside = new PopoutElementStub();
    const el = { contains: (node: unknown) => node === inside || node === popoutInside } as unknown as Element;
    const leave = (relatedTarget: unknown) => ({ relatedTarget }) as unknown as MouseEvent;

    it('stays when the pointer moves onto one of its children', () => {
        expect(movesOutOf(el, leave(inside))).toBe(false);
    });

    it('stays for a child in a popout window too', () => {
        expect(movesOutOf(el, leave(popoutInside))).toBe(false);
    });

    it('leaves for a node outside it, or for no node at all', () => {
        expect(movesOutOf(el, leave(new ElementStub()))).toBe(true);
        expect(movesOutOf(el, leave(null))).toBe(true);
    });
});
