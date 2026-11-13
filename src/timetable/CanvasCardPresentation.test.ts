import { describe, expect, it, vi } from 'vitest';
import { CanvasCards } from './CanvasCardPresentation';
import { bookRingColors } from './canvasBookCards';

vi.mock('./canvasBookCards', async (original) => ({
    ...await original<typeof import('./canvasBookCards')>(),
    bookRingColors: vi.fn(),
}));

describe('Canvas card color recovery', () => {
    it('lets cards render and retries after the book colors fail to load', async () => {
        const read = vi.mocked(bookRingColors);
        const colors = new Map([['Main Plot', { kind: 'slot' as const, slot: 0 }]]);
        read.mockRejectedValueOnce(new Error('scene read failed')).mockResolvedValueOnce(colors);
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cards = Object.create(CanvasCards.prototype) as CanvasCards;
        Object.assign(cards, {
            plugin: { settings: { books: [{ id: 'book', sourceFolder: 'Book' }] } },
            ringColors: new Map(), settledRingColors: new Map(),
        });
        const colorsForBook = (Reflect.get(cards, 'colorsForBook') as (id: string) => Promise<Map<string, unknown>>).bind(cards);
        await expect(colorsForBook('book')).resolves.toEqual(new Map());
        expect(cards.ringColorsNow('book')).toBeUndefined();
        await expect(colorsForBook('book')).resolves.toEqual(colors);
        expect(read).toHaveBeenCalledTimes(2);
        expect(cards.ringColorsNow('book')).toEqual(colors);
        error.mockRestore();
    });

    it('leaves one unreadable preview empty and reads it on a later refresh', async () => {
        const read = vi.fn().mockRejectedValueOnce(new Error('file busy')).mockResolvedValueOnce('An idea.');
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const cards = Object.create(CanvasCards.prototype) as CanvasCards;
        Object.assign(cards, { plugin: { app: { vault: { cachedRead: read } } } });
        const preview = (Reflect.get(cards, 'cardPreview') as (file: unknown) => Promise<string>).bind(cards);
        await expect(preview({ basename: 'Idea' })).resolves.toBe('');
        await expect(preview({ basename: 'Idea' })).resolves.toBe('An idea.');
        error.mockRestore();
    });
});
