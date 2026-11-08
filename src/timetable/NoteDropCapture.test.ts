import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Modal, TFile, type Component } from 'obsidian';
import type RadialTimelinePlugin from '../main';

import { addNoteClass, noteDropAnchors, registerNoteDropCapture, sameSceneNumber, sceneBeforeNumber } from './NoteDropCapture';

describe('Place sketch after', () => {
    const scene = (id: string, act: number | null) => ({ id, row: { kind: 'scene', act } });
    const items = [scene('scn_1', 1), scene('scn_2', 2), { id: 'scn_note', row: { kind: 'sketch', act: 1 } }, scene('scn_dup', 1), scene('scn_dup', 2), { id: undefined, row: { kind: 'scene', act: 1 } }];
    it('offers every scene in the book for a note with no Act', () => {
        expect(noteDropAnchors(items, null).map(item => item.id)).toEqual(['scn_1', 'scn_2']);
    });
    it('keeps to the note\'s own act when it has one', () => {
        expect(noteDropAnchors(items, 2).map(item => item.id)).toEqual(['scn_2']);
    });
});

describe('a note dragged over a target of its own', () => {
    class FakeElement {
        dataset: Record<string, string> = {};
        constructor(private readonly path?: string) { if (path) this.dataset.path = path; }
        closest(): FakeElement | null { return this.path ? this : null; }
        matches(): boolean { return false; }
    }
    const file = new TFile('Notes/Plan.md');
    function setup(ownDrop: boolean) {
        const handlers = new Map<string, (event: unknown) => void>();
        const banner = { createSpan: () => ({}), addClass: vi.fn(), removeClass: vi.fn(), remove: vi.fn(), previousElementSibling: null, isConnected: true };
        const doc = {};
        const host = { ownerDocument: doc, isConnected: true, createDiv: () => banner, closest: () => null, querySelector: () => null, appendChild: vi.fn(), getBoundingClientRect: () => ({ left: 0, right: 100, top: 0, bottom: 100 }) };
        const owner = { registerDomEvent: (_: unknown, type: string, handler: (event: unknown) => void) => handlers.set(type, handler), register: () => undefined };
        const plugin = { app: { vault: { getAbstractFileByPath: () => file }, metadataCache: { getFileCache: () => ({ frontmatter: {} }) } } } as unknown as RadialTimelinePlugin;
        registerNoteDropCapture(owner as unknown as Component, host as unknown as HTMLElement, plugin, () => 'book', { ownDropPoint: () => ownDrop });
        handlers.get('dragstart')!({ target: new FakeElement(file.path) });
        const event = () => ({ clientX: 10, clientY: 10, target: new FakeElement(), preventDefault: vi.fn(), stopPropagation: vi.fn(), stopImmediatePropagation: vi.fn(), dataTransfer: { dropEffect: 'none' } });
        return { handlers, banner, event };
    }
    const open = vi.spyOn(Modal.prototype, 'open');
    beforeEach(() => { vi.stubGlobal('Element', FakeElement); vi.useFakeTimers(); open.mockClear(); });
    afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

    it('reaches the Outline documents tray untouched', () => {
        const { handlers, banner, event } = setup(true);
        const over = event();
        handlers.get('dragover')!(over);
        expect(over.preventDefault).not.toHaveBeenCalled();
        expect(banner.addClass).not.toHaveBeenCalled();
        const drop = event();
        handlers.get('drop')!(drop);
        expect(drop.stopImmediatePropagation).not.toHaveBeenCalled();
        vi.runAllTimers();
        expect(open).not.toHaveBeenCalled();
    });
    it('opens Add note to the book everywhere else', () => {
        const { handlers, event } = setup(false);
        const drop = event();
        handlers.get('drop')!(drop);
        expect(drop.stopImmediatePropagation).toHaveBeenCalled();
        vi.runAllTimers();
        expect(open).toHaveBeenCalledTimes(1);
    });
});

describe('adding a note to the book', () => {
    it('gives a placed sketch the act of its scene, leaving the rest of the note as it was', () => {
        const source = '---\nSynopsis: Keep # this\n---\n\nBody\n';
        expect(addNoteClass(source, 'Sketch', { key: 'Act', value: 2 })).toBe('---\nClass: Sketch\nAct: 2\nSynopsis: Keep # this\n---\n\nBody\n');
        expect(addNoteClass('Body\n', 'Sketch', { key: 'Act', value: 2 })).toBe('---\nClass: Sketch\nAct: 2\n---\n\nBody\n');
    });
    it('fills an empty Act in place instead of writing a second one', () => {
        expect(addNoteClass('---\nact:\nWhen: 2085\n---\n', 'Sketch', { key: 'Act', value: 3 })).toBe('---\nClass: Sketch\nact: 3\nWhen: 2085\n---\n');
    });
    it('keeps Windows line endings when it fills an empty Act', () => {
        expect(addNoteClass('---\r\nAct:\r\n---\r\n', 'Sketch', { key: 'Act', value: 3 })).toBe('---\r\nClass: Sketch\r\nAct: 3\r\n---\r\n');
    });
    it('leaves an Act it cannot read for the author to fix', () => {
        expect(() => addNoteClass('---\nAct: two\n---\n', 'Sketch', { key: 'Act', value: 3 })).toThrow();
    });
    it('inserts only the Class line and preserves existing YAML, comments, and prose byte for byte', () => {
        const source = '---\r\nSynopsis: A scene # keep this\r\nAct: 3\r\nWhen: 2085-05-11\r\nCharacter:\r\n  - "[[Entiat Chelan]]"\r\n---\r\n\r\nUnchanged prose.\r\n';
        expect(addNoteClass(source, 'Scene')).toBe(source.replace('---\r\n', '---\r\nClass: Scene\r\n'));
    });
    it('wraps a note without frontmatter without changing its text', () => {
        expect(addNoteClass('A sketch.\n', 'Sketch')).toBe('---\nClass: Sketch\n---\n\nA sketch.\n');
    });
    it('never writes a sketch placement into the note: the scene it follows goes to the sidecar', () => {
        const source = '---\nAct: 3\nSynopsis: Leave this alone\n---\n\nBody\n';
        const classified = addNoteClass(source, 'Sketch');
        expect(classified).toBe(source.replace('---\n', '---\nClass: Sketch\n'));
        expect(classified).not.toMatch(/Place after scene|Sketch order/i);
    });
    it('does not replace an existing class under any letter case', () => {
        expect(() => addNoteClass('---\nclass: Character\n---\n', 'Scene')).toThrow();
    });
    it('treats an empty Class as no class, as promotion does, and fills it in place', () => {
        expect(addNoteClass('---\nClass: # mine\nMood: calm\n---\n', 'Sketch')).toBe('---\nClass: Sketch # mine\nMood: calm\n---\n');
    });
    it('finds the scene a numbered note follows', () => {
        const scenes = [{ prefix: '10' }, { prefix: '2' }, { prefix: null }, { prefix: '7.5' }];
        expect(sceneBeforeNumber(scenes, '8')).toEqual({ scene: { prefix: '7.5' }, precedes: true });
        expect(sceneBeforeNumber(scenes, '1')).toEqual({ scene: { prefix: '2' }, precedes: false });
        expect(sceneBeforeNumber([], '1')).toBeUndefined();
    });
    it('rejects incomplete frontmatter', () => {
        expect(() => addNoteClass('---\nSynopsis: incomplete\n', 'Scene')).toThrow();
    });
});

describe('scene number collisions', () => {
    it('treats equivalent numeric prefixes as the same scene number', () => {
        expect(sameSceneNumber('5', '5.0')).toBe(true);
        expect(sameSceneNumber('5.1', '5.10')).toBe(true);
        expect(sameSceneNumber('5', '5.1')).toBe(false);
        expect(sameSceneNumber(null, '5')).toBe(false);
    });
});

describe('Add note to the book: rows that follow the kind', () => {
    it('hides every kind-dependent row with a rule that beats .setting-item', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const source = readFileSync(resolve(process.cwd(), 'src/timetable/NoteDropCapture.ts'), 'utf8');
        const css = readFileSync(resolve(process.cwd(), 'src/styles/timetable.css'), 'utf8');
        const toggled = [...source.matchAll(/(\w+)\.hidden = kind\.getValue\(\)/g)].map(match => match[1]);
        expect(toggled).toEqual(['propertiesRow', 'numberRow', 'anchorRow']);
        for (const row of toggled) {
            expect(source).toMatch(new RegExp(`const ${row} = this\\.contentEl\\.createDiv\\(\\{ cls: 'setting-item ert-note-drop-row[ '"]`));
        }
        expect(css).toContain('.ert-note-drop-row[hidden] { display: none; }');
    });
});
