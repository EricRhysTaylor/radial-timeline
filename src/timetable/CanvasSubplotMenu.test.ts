import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ItemView, Menu } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { BookProfile } from '../types/settings';
import type { SubplotColor } from '../renderer/utils/subplotColors';
import type { StoryCanvasData } from './canvasSketches';
import { DEFAULT_SETTINGS } from '../settings/defaults';
import { addSubplotColorMenu, ideaCards, type CanvasCardNode } from './CanvasSubplotMenu';

/** A DOM node as small as the menu titles need. */
interface FakeNode { cls?: string; text?: string; css: Record<string, string>; children: FakeNode[]; createSpan(options?: { cls?: string; text?: string }): FakeNode; setCssProps(props: Record<string, string>): void }
function fakeNode(options: { cls?: string; text?: string } = {}): FakeNode {
    const node: FakeNode = {
        ...options, css: {}, children: [],
        createSpan(child = {}) { const made = fakeNode(child); node.children.push(made); return made; },
        setCssProps(props) { Object.assign(node.css, props); },
    };
    return node;
}
const textOf = (node: FakeNode): string => [node.text, ...node.children.map(textOf)].filter(Boolean).join(' ');
const swatchOf = (node: FakeNode): string | undefined => node.css['--ert-canvas-sketch-swatch'] ?? node.children.map(swatchOf).find(Boolean);

class FakeItem {
    title: unknown; icon?: string; section?: string; checked?: boolean | null; disabled = false; click?: () => void; submenu?: FakeMenu;
    setTitle(title: unknown) { this.title = title; return this; }
    setIcon(icon: string) { this.icon = icon; return this; }
    setSection(section: string) { this.section = section; return this; }
    setChecked(checked: boolean | null) { this.checked = checked; return this; }
    setDisabled(disabled: boolean) { this.disabled = disabled; return this; }
    onClick(callback: () => void) { this.click = callback; return this; }
    setSubmenu() { this.submenu = new FakeMenu(); return this.submenu; }
}
class FakeMenu {
    items: Array<FakeItem | 'separator'> = [];
    addItem(build: (item: FakeItem) => void) { const item = new FakeItem(); build(item); this.items.push(item); return this; }
    addSeparator() { this.items.push('separator'); return this; }
}
const label = (entry: FakeItem | 'separator'): string => entry === 'separator' ? '—' : typeof entry.title === 'string' ? entry.title : textOf(entry.title as FakeNode);

/** Palette slot N paints `#0000NN`; the window reads colors through a stand-in canvas. */
const slotHex = (slot: number): string => `#${String(slot + 1).padStart(6, '0')}`;
function fakeDoc(): Document {
    let fill = '#000000';
    const context = { get fillStyle() { return fill; }, set fillStyle(value: string) { if (/^#[0-9a-f]{6}$/i.test(value)) fill = value.toLowerCase(); } };
    return { win: { createEl: () => ({ getContext: () => context }), createFragment: () => fakeNode() }, documentElement: {}, body: {} } as unknown as Document; // SAFE: the color readers and menu titles touch only these members
}

describe('Radial Timeline: Color by subplot, in a Canvas card menu', () => {
    const book = { id: 'book', title: 'Book', sourceFolder: 'Book', ownSubplotColors: { schemaVersion: 1, colors: { Romance: '#e93147' } } } as BookProfile;
    const wheel = new Map<string, SubplotColor>([['Main Plot', { kind: 'slot', slot: 0 }], ['Mara', { kind: 'slot', slot: 1 }], ['Romance', { kind: 'own', color: '#e93147' }]]);
    let data: StoryCanvasData;
    let cards: CanvasCardNode[];
    let requestSave: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        const vars: Record<string, string> = {};
        for (let slot = 0; slot < 16; slot++) vars[`--rt-subplot-colors-${slot}`] = slotHex(slot);
        vi.stubGlobal('getComputedStyle', () => ({ getPropertyValue: (name: string) => vars[name] ?? '' }));
        data = { nodes: [
            { id: 'a', type: 'text', text: 'Mara leaves', color: slotHex(1) },
            { id: 'b', type: 'text', text: 'Mara returns', color: slotHex(1) },
            { id: 'c', type: 'text', text: 'A letter', color: '#abcdef' },
        ] };
        cards = data.nodes!.slice(0, 2).map(node => ({
            getData: () => node,
            setColor: vi.fn((color: string) => { node.color = color; }),
        }));
        requestSave = vi.fn();
    });
    afterEach(() => vi.unstubAllGlobals());

    function open(nodes: CanvasCardNode[], read = true): FakeMenu {
        const rings = read ? wheel : undefined;
        const plugin = {
            app: { vault: { getMarkdownFiles: () => [] }, metadataCache: { getFileCache: () => ({}) } },
            settings: { ...DEFAULT_SETTINGS, books: [book], activeBookId: 'book', canvasPendingSubplots: { schemaVersion: 1, canvases: {
                'Ideas.canvas': [{ bookId: 'book', name: 'Letters', color: '#abcdef' }],
            } } },
        } as unknown as RadialTimelinePlugin;
        const view = { containerEl: { doc: fakeDoc() }, file: { path: 'Ideas.canvas' } } as unknown as ItemView;
        const menu = new FakeMenu();
        addSubplotColorMenu(menu as unknown as Menu, { plugin, view, canvas: { getData: () => data, requestSave }, ringsNow: () => rings }, nodes);
        return menu;
    }

    it('lists the book’s subplots in ring order in their timeline colors, then new subplots waiting here, then New subplot…', () => {
        const menu = open(cards);
        expect(menu.items).toHaveLength(1);
        const item = menu.items[0] as FakeItem;
        expect(item.title).toBe('Radial Timeline: Color by subplot');
        expect(item.section).toBe('radial-timeline');
        const entries = item.submenu!.items;
        expect(entries.map(label)).toEqual(['Main Plot', 'Mara', 'Romance', 'Letters new', '—', 'New subplot…']);
        expect(entries.slice(0, 4).map(entry => swatchOf((entry as FakeItem).title as FakeNode))).toEqual([slotHex(0), slotHex(1), '#e93147', '#abcdef']);
        // Both cards already wear Mara's color.
        expect(entries.slice(0, 4).map(entry => (entry as FakeItem).checked)).toEqual([false, true, false, false]);
    });

    it('sets every card it acts on to the chosen subplot’s exact color, in one step', () => {
        const romance = open(cards).items[0] as FakeItem;
        (romance.submenu!.items[2] as FakeItem).click!();
        expect(cards.map(card => vi.mocked(card.setColor!).mock.calls)).toEqual([[['#e93147']], [['#e93147']]]);
        expect(requestSave).toHaveBeenCalledOnce();
    });

    it('says it is still reading the book’s subplots instead of guessing', () => {
        const item = open(cards, false).items[0] as FakeItem;
        expect(item.submenu!.items.map(label)).toEqual(['Reading this book’s subplots…']);
        expect((item.submenu!.items[0] as FakeItem).disabled).toBe(true);
    });

    it('acts only on idea cards: never Act headings, linked notes or cards that cannot take a color', () => {
        const heading: CanvasCardNode = { getData: () => ({ type: 'text', text: 'Act 2' }), setColor: vi.fn() };
        const file: CanvasCardNode = { getData: () => ({ type: 'file' }), setColor: vi.fn() };
        const fixed: CanvasCardNode = { getData: () => ({ type: 'text', text: 'An idea' }) };
        expect(ideaCards([heading, file, fixed, cards[0]])).toEqual([cards[0]]);
        expect(open([heading, file, fixed]).items).toEqual([]);
    });
});
