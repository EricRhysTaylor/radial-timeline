import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';

vi.mock('./subplotCanvas', () => ({
    planSubplotCanvas: () => ({ sceneCount: 1, appearanceCount: 1, nodes: [], edges: [] }),
    storyRangeBounds: () => null,
    storyRangeRows: () => [],
}));

import { ErtModal } from '../ui/ErtModal';
import { SubplotCanvasModal } from './SubplotCanvasModal';

type FakeEl = { disabled: boolean; click?: () => void; createDiv: () => FakeEl; createEl: () => FakeEl; setText: () => void; addEventListener: (type: string, listener: () => void) => void };
function fakeEl(): FakeEl {
    const el: FakeEl = {
        disabled: false, createDiv: fakeEl, createEl: () => { const child = fakeEl(); created.push(child); return child; }, setText: () => undefined,
        addEventListener: (type, listener) => { if (type === 'click') el.click = listener; },
    };
    return el;
}
let created: FakeEl[] = [];

describe('Create in the subplot map dialog', () => {
    it('comes back after a failed create, so the author can try again', async () => {
        created = [];
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(ErtModal.prototype as unknown as { applyShell: () => void }, 'applyShell').mockImplementation(() => undefined);
        vi.spyOn(ErtModal.prototype as unknown as { mountHeader: () => void }, 'mountHeader').mockImplementation(() => undefined);
        vi.spyOn(ErtModal.prototype as unknown as { mountActions: () => FakeEl }, 'mountActions').mockImplementation(() => fakeEl());
        const failure = vi.fn().mockRejectedValue(new Error('disk full'));
        const app = { vault: { getMarkdownFiles: () => [], getFolderByPath: () => ({}), getAbstractFileByPath: () => null, create: failure } } as unknown as App;
        const plugin = { settings: { books: [{ id: 'book', title: 'Book', sourceFolder: 'Book' }] } } as unknown as RadialTimelinePlugin;
        const modal = new SubplotCanvasModal(app, plugin, 'book');
        (modal as unknown as { contentEl: FakeEl }).contentEl = fakeEl();
        modal.onOpen();
        const create = created[created.length - 1];
        expect(create.disabled).toBe(false);
        create.click!();
        expect(create.disabled).toBe(true);
        await vi.waitFor(() => expect(failure).toHaveBeenCalled());
        await vi.waitFor(() => expect(create.disabled).toBe(false));
    });
});
