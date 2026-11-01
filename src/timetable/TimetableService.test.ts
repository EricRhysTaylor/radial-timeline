import { describe, expect, it, vi } from 'vitest';
import { TimetableService } from './TimetableService';
import { timetableInElement } from './timetableRegistry';

vi.mock('./TimetableView', () => ({ TimetableView: class {}, timetableViewOptions: [] }));
vi.mock('../view/TimeLineView', () => ({ TIMELINE_VIEW_TYPE: 'radial-timeline' }));
vi.mock('./timetableRegistry', () => ({
    activeTimetable: vi.fn(), refreshTimetableViews: vi.fn(), timetableInElement: vi.fn(),
}));

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
});
