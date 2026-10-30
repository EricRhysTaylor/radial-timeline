import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { TimelineItem } from '../../types';
import type { PlacementResult } from '../../modals/ChronologuePlacementModal';
import { ChronologueDragController } from './ChronologueDragController';

const pending = vi.hoisted(() => ({
    resolvers: [] as Array<(result: PlacementResult | null) => void>,
    writes: vi.fn(),
}));

vi.mock('../../modals/ChronologuePlacementModal', () => ({
    ChronologuePlacementModal: class {
        waitForPlacement(): Promise<PlacementResult | null> {
            return new Promise(resolve => pending.resolvers.push(resolve));
        }
        updateProgress(): void {}
        finishWithDismiss(): Promise<void> { return Promise.resolve(); }
    },
}));
vi.mock('../../timelineRepair/frontmatterWriter', () => ({
    writeFrontmatterUpdates: pending.writes,
}));
vi.mock('../../utils/sleep', () => ({ sleep: () => Promise.resolve() }));

interface DragHarness {
    sourceGroup: SVGGElement | null;
    sourcePath: string | null;
    currentTarget: { group: SVGGElement; path: string; startAngle: number } | null;
    committing: boolean;
    onPointerUp(event: PointerEvent): Promise<void>;
    onPointerMove(event: PointerEvent): void;
    findDropTarget(event: PointerEvent): DragHarness['currentTarget'];
}

function element(): SVGGElement {
    return {
        classList: { add: vi.fn(), remove: vi.fn() },
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
    } as unknown as SVGGElement;
}

function harness(): DragHarness {
    const sceneData = ['A', 'B', 'C'].map((name, index) => ({
        path: `${name}.md`, title: name, itemType: 'Scene',
        when: new Date(2026, 0, index + 1, 9), Duration: '1 hour',
    } as TimelineItem));
    const controller = Object.assign(Object.create(ChronologueDragController.prototype), {
        view: {
            sceneData,
            plugin: { app: { vault: { getAbstractFileByPath: (path: string) => new TFile(path) } } },
        },
        options: { onRefresh: vi.fn() },
        overlays: { clear: vi.fn(), showTick: vi.fn(), showArc: vi.fn() },
        svg: element(),
        dragging: true,
        sourceGroup: element(), sourcePath: 'A.md', sourceStartAngle: 0,
        currentTarget: { group: element(), path: 'C.md', startAngle: 1 },
        holdTimer: null, committing: false,
    }) as DragHarness;
    return controller;
}

beforeEach(() => {
    pending.resolvers.length = 0;
    pending.writes.mockReset().mockResolvedValue({ success: 1, failed: 0, errors: [] });
});

describe('Chronologue placement owns the pointer while confirmation is open', () => {
    it.each([false, true])('does not reopen or duplicate writes when a dialog click releases (place=%s)', async place => {
        const drag = harness();
        const event = { clientX: 10, clientY: 10 } as PointerEvent;
        const first = drag.onPointerUp(event);
        expect(pending.resolvers).toHaveLength(1);

        const dialogClick = drag.onPointerUp(event);
        const dialogCount = pending.resolvers.length;
        pending.resolvers.forEach(resolve => resolve(place ? {
            when: new Date(2026, 0, 2, 12), storedWhen: '2026-01-02 12:00', keepFollowers: false,
        } : null));
        await Promise.all([first, dialogClick]);

        expect(dialogCount).toBe(1);
        expect(pending.writes).toHaveBeenCalledTimes(place ? 1 : 0);
        expect(drag.committing).toBe(false);
        expect(drag.sourcePath).toBeNull();
    });

    it('keeps the drop target while the pointer moves into the dialog', async () => {
        const drag = harness();
        const originalTarget = drag.currentTarget;
        const first = drag.onPointerUp({} as PointerEvent);
        const findTarget = vi.spyOn(drag, 'findDropTarget').mockReturnValue(null);
        drag.onPointerMove({ clientX: 10, clientY: 10 } as PointerEvent);
        const targetWhileChoosing = drag.currentTarget;
        pending.resolvers.forEach(resolve => resolve(null));
        await first;

        expect(findTarget).not.toHaveBeenCalled();
        expect(targetWhileChoosing).toBe(originalTarget);
    });
});

describe('Timetable Chronologue placement', () => {
    it('opens the existing confirmation and cancellation performs no writes', async () => {
        const drag = harness();
        Object.assign(drag, { dragging: false });
        Object.assign((drag as unknown as { view: object }).view, { chronologueState: { shift: false, alien: false } });
        const place = (drag as unknown as ChronologueDragController).placeFromTimetable('A.md', 'C.md');
        expect(pending.resolvers).toHaveLength(1);
        pending.resolvers[0](null);
        expect(await place).toBe(true);
        expect(pending.writes).not.toHaveBeenCalled();
    });

    it('uses the existing date write after confirmation', async () => {
        const drag = harness();
        Object.assign(drag, { dragging: false });
        Object.assign((drag as unknown as { view: object }).view, { chronologueState: { shift: false, alien: false } });
        const place = (drag as unknown as ChronologueDragController).placeFromTimetable('A.md', 'C.md');
        expect(pending.resolvers).toHaveLength(1);
        pending.resolvers[0]({ when: new Date(2026, 0, 2, 12), storedWhen: '2026-01-02 12:00', keepFollowers: false });
        expect(await place).toBe(true);
        expect(pending.writes).toHaveBeenCalledTimes(1);
    });

    it('rejects missing scenes and active Chronologue submodes', async () => {
        const drag = harness();
        Object.assign(drag, { dragging: false });
        const view = (drag as unknown as { view: { chronologueState: { shift: boolean; alien: boolean } } }).view;
        view.chronologueState = { shift: false, alien: false };
        const controller = drag as unknown as ChronologueDragController;
        expect(await controller.placeFromTimetable('missing.md', 'C.md')).toBe(false);
        view.chronologueState.shift = true;
        expect(await controller.placeFromTimetable('A.md', 'C.md')).toBe(false);
        expect(pending.resolvers).toHaveLength(0);
        expect(pending.writes).not.toHaveBeenCalled();
    });
});
