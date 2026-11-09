import { describe, expect, it, vi } from 'vitest';
import { TimetableService } from './TimetableService';
import { timetableInElement } from './timetableRegistry';
import { ensureActiveBookFolder } from '../modals/EnsureFirstBookModal';
import { confirmWithErtModal } from '../modals/ErtConfirmModal';

vi.mock('./TimetableView', () => ({ TimetableView: class {}, timetableViewOptions: [] }));
vi.mock('../view/TimeLineView', () => ({ TIMELINE_VIEW_TYPE: 'radial-timeline' }));
vi.mock('../modals/EnsureFirstBookModal', () => ({ ensureActiveBookFolder: vi.fn() }));
vi.mock('../modals/ErtConfirmModal', () => ({ confirmWithErtModal: vi.fn() }));
vi.mock('./timetableRegistry', () => ({
    activeTimetable: vi.fn(), refreshTimetableViews: vi.fn(), timetableInElement: vi.fn(),
}));

describe('opening the first Timetable', () => {
    it('adopts a portable matching timetable without creating or rewriting it', async () => {
        const file = { path: 'Radial Timeline/Timetables/Book.base' };
        const plugin = {
            settings: { timetableFiles: {} },
            app: { vault: { getFileByPath: vi.fn(() => file), cachedRead: vi.fn().mockResolvedValue('filters:\n  and:\n    - file.inFolder("Story")\nviews:\n  - type: radial-timeline-timetable\n    name: Timetable\n') } },
            saveSettings: vi.fn().mockResolvedValue(undefined),
        };
        const service = new TimetableService(plugin as never);
        const ensureFile = (service as unknown as { ensureFile: (target: unknown) => Promise<unknown> }).ensureFile.bind(service);
        expect(await ensureFile({ key: 'book-id', title: 'Book', folders: ['Story'] })).toBe(file);
        expect(plugin.settings.timetableFiles).toEqual({ 'book-id': { path: file.path, folders: ['Story'] } });
        expect(confirmWithErtModal).not.toHaveBeenCalled();
    });

    it('does not offer a duplicate when an existing timetable cannot be read', async () => {
        const file = { path: 'Radial Timeline/Timetables/Book.base' };
        const plugin = { settings: { timetableFiles: {} }, app: { vault: { getFileByPath: () => file, cachedRead: vi.fn().mockRejectedValue(new Error('read failed')) } } };
        const service = new TimetableService(plugin as never);
        const ensureFile = (service as unknown as { ensureFile: (target: unknown) => Promise<unknown> }).ensureFile.bind(service);
        const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await ensureFile({ key: 'book-id', title: 'Book', folders: ['Story'] })).toBeNull();
        expect(confirmWithErtModal).not.toHaveBeenCalled();
        log.mockRestore();
    });

    it('asks for a book before opening and stops if setup is cancelled', async () => {
        const plugin = { settings: { books: [], timelineScope: 'book' }, registerBasesView: vi.fn(() => true) };
        const service = new TimetableService(plugin as never);
        vi.mocked(ensureActiveBookFolder).mockResolvedValueOnce(null);
        await service.open();
        expect(ensureActiveBookFolder).toHaveBeenCalledWith(plugin);
    });

    it('opens the table after first-book setup succeeds', async () => {
        const plugin = { settings: { books: [], timelineScope: 'book' }, registerBasesView: vi.fn(() => true) };
        const service = new TimetableService(plugin as never);
        const internals = service as unknown as { resolveTarget: ReturnType<typeof vi.fn>; ensureFile: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> };
        internals.resolveTarget = vi.fn(() => ({ key: 'book' }));
        internals.ensureFile = vi.fn().mockResolvedValue({ path: 'book.base' });
        internals.show = vi.fn().mockResolvedValue(undefined);
        vi.mocked(ensureActiveBookFolder).mockResolvedValueOnce({ id: 'book' } as never);
        await service.open();
        expect(internals.show).toHaveBeenCalledWith({ path: 'book.base' });
    });
});

describe('selecting a book in a Timetable', () => {
    it('opens the target book in a manually opened table and retains Outline', async () => {
        const source = {} as HTMLElement;
        const container = { contains: vi.fn(() => true) } as unknown as HTMLElement;
        let currentPath = 'custom.base';
        const leaf = {
            view: { containerEl: container },
            getViewState: () => ({ type: 'bases', state: { file: currentPath } }),
            setViewState: vi.fn(async (state: { state: { file: string } }) => { currentPath = state.state.file; }),
        };
        const plugin = {
            app: { workspace: { getLeavesOfType: () => [leaf] } },
            settings: { books: [], activeBookId: 'old', timelineScope: 'book' },
            setActiveBookId: vi.fn().mockResolvedValue(undefined),
        };
        const service = new TimetableService(plugin as never);
        const internals = service as unknown as { resolveTarget: ReturnType<typeof vi.fn>; ensureFile: ReturnType<typeof vi.fn>; timetableViewName: ReturnType<typeof vi.fn> };
        internals.resolveTarget = vi.fn(() => ({ key: 'new' }));
        internals.ensureFile = vi.fn().mockResolvedValue({ path: 'new.base' });
        internals.timetableViewName = vi.fn().mockResolvedValue('Timetable');
        const setLayout = vi.fn();
        vi.mocked(timetableInElement).mockReturnValue({ setLayout } as never);
        await service.selectBook('new', source, 'outline');
        expect(plugin.setActiveBookId).toHaveBeenCalledWith('new');
        expect(leaf.setViewState).toHaveBeenCalledWith(expect.objectContaining({ state: { file: 'new.base', viewName: 'Timetable' } }));
        expect(setLayout).toHaveBeenCalledWith('outline');
    });

    it('does not switch the active book when table creation is cancelled', async () => {
        const leaf = { view: { containerEl: { contains: () => true } } };
        const plugin = { app: { workspace: { getLeavesOfType: () => [leaf] } }, settings: {}, setActiveBookId: vi.fn() };
        const service = new TimetableService(plugin as never);
        const internals = service as unknown as { resolveTarget: ReturnType<typeof vi.fn>; ensureFile: ReturnType<typeof vi.fn> };
        internals.resolveTarget = vi.fn(() => ({}));
        internals.ensureFile = vi.fn().mockResolvedValue(null);
        await service.selectBook('new', {} as HTMLElement, 'outline');
        expect(plugin.setActiveBookId).not.toHaveBeenCalled();
    });

    it('remembers a directly opened source timetable without replacing an existing registration', async () => {
        const leaf = {
            view: { containerEl: { contains: () => true } },
            getViewState: () => ({ type: 'bases', state: { file: 'custom.base' } }),
            setViewState: vi.fn().mockResolvedValue(undefined),
        };
        const plugin = {
            app: { workspace: { getLeavesOfType: () => [leaf] }, vault: { getFileByPath: () => ({}) } },
            settings: { books: [{ id: 'old', sourceFolder: 'Story' }], activeBookId: 'old', timelineScope: 'book', timetableFiles: {} },
            setActiveBookId: vi.fn().mockResolvedValue(undefined),
        };
        const service = new TimetableService(plugin as never);
        const internals = service as unknown as { resolveTarget: ReturnType<typeof vi.fn>; ensureFile: ReturnType<typeof vi.fn>; timetableViewName: ReturnType<typeof vi.fn>; remember: ReturnType<typeof vi.fn> };
        internals.resolveTarget = vi.fn(() => ({}));
        internals.ensureFile = vi.fn().mockResolvedValue({ path: 'custom.base' });
        internals.remember = vi.fn().mockResolvedValue(undefined);
        await service.selectBook('new', {} as HTMLElement, 'outline', 'old');
        expect(internals.remember).toHaveBeenCalledWith('old', { path: 'custom.base', folders: ['Story'] });
        internals.remember.mockClear();
        Object.assign(plugin.settings.timetableFiles, { old: { path: 'existing.base', folders: ['Story'] } });
        await service.selectBook('new', {} as HTMLElement, 'outline', 'old');
        expect(internals.remember).not.toHaveBeenCalled();
    });
});
