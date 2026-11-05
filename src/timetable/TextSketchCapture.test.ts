import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MarkdownView, Modal, type Component, type TFile } from 'obsidian';
import type RadialTimelinePlugin from '../main';

import { registerTextSketchCapture } from './TextSketchCapture';

const ROW = '[data-row]';
class FakeElement {
    constructor(private readonly row: boolean) { }
    closest(selector: string): FakeElement | null { return selector === ROW && this.row ? this : null; }
}

function dragEvent(target: unknown) {
    return { target, preventDefault: vi.fn(), stopPropagation: vi.fn(), dataTransfer: { dropEffect: 'none' } };
}

function setup() {
    const handlers = new Map<string, (event: unknown) => void>();
    const banner = { isConnected: true, createSpan: () => ({}), addClass: vi.fn(), removeClass: vi.fn(), remove: vi.fn() };
    const doc = { getSelection: () => null };
    const host = { ownerDocument: doc, createDiv: () => banner, querySelector: () => null, appendChild: vi.fn() };
    const owner = {
        registerDomEvent: (element: unknown, type: string, handler: (event: unknown) => void) => handlers.set(`${element === doc ? 'doc' : 'host'}:${type}`, handler),
        register: () => undefined,
    };
    const source = { path: 'Notes/Plan.md' } as TFile;
    const pane = { contains: () => true };
    const view = Object.assign(new (MarkdownView as unknown as new () => object)(), {
        file: source, containerEl: pane, getMode: () => 'source', editor: { getSelection: () => 'A dropped line' },
    });
    const plugin = { app: { workspace: { getLeavesOfType: () => [{ view }] } } } as unknown as RadialTimelinePlugin;
    const dragged = registerTextSketchCapture(owner as unknown as Component, host as unknown as HTMLElement, plugin, ROW);
    const fire = (key: string, event: unknown) => handlers.get(key)!(event);
    // CodeMirror may clear its selection before dragstart, so the press is what counts.
    const startDrag = () => { fire('doc:pointerdown', { target: {} }); view.editor.getSelection = () => ''; fire('doc:dragstart', { target: {} }); };
    return { banner, dragged, fire, source, startDrag };
}

describe('dropping selected text', () => {
    const open = vi.spyOn(Modal.prototype, 'open');
    beforeEach(() => { vi.stubGlobal('Element', FakeElement); open.mockClear(); });
    afterEach(() => vi.unstubAllGlobals());

    it('stands aside over an Outline row, which takes the selection itself', () => {
        const { banner, dragged, fire, source, startDrag } = setup();
        startDrag();
        const over = dragEvent(new FakeElement(true));
        fire('host:dragover', over);
        expect(over.preventDefault).not.toHaveBeenCalled();
        expect(over.stopPropagation).not.toHaveBeenCalled();
        expect(banner.addClass).not.toHaveBeenCalled();
        const drop = dragEvent(new FakeElement(true));
        fire('host:drop', drop);
        expect(drop.stopPropagation).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
        expect(dragged()).toEqual({ text: 'A dropped line', source });
    });
    it('hides the banner when the pointer moves onto a row', () => {
        const { banner, fire, startDrag } = setup();
        startDrag();
        fire('host:dragover', dragEvent(new FakeElement(false)));
        expect(banner.addClass).toHaveBeenCalledWith('is-visible');
        banner.removeClass.mockClear();
        fire('host:dragover', dragEvent(new FakeElement(true)));
        expect(banner.removeClass).toHaveBeenCalledWith('is-visible');
    });
    it('opens Create sketch everywhere else', () => {
        const { dragged, fire, startDrag } = setup();
        startDrag();
        const over = dragEvent(new FakeElement(false));
        fire('host:dragover', over);
        expect(over.preventDefault).toHaveBeenCalled();
        expect(over.stopPropagation).toHaveBeenCalled();
        const drop = dragEvent(new FakeElement(false));
        fire('host:drop', drop);
        expect(drop.stopPropagation).toHaveBeenCalled();
        expect(open).toHaveBeenCalledTimes(1);
        expect(dragged()).toBeNull();
    });
    it('forgets the selection when the drag ends', () => {
        const { dragged, fire, startDrag } = setup();
        startDrag();
        fire('doc:dragend', {});
        expect(dragged()).toBeNull();
    });
});
