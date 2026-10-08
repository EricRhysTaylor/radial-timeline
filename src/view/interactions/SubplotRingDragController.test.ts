import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { DragConfirmCurrentMoveSummary } from '../../modals/DragConfirmModal';
import type { SceneUpdate } from '../../services/SceneReorderService';
import type { SubplotMembershipChange } from '../../services/SubplotMembership';
import { OuterRingDragController } from './OuterRingDragController';
import { describeSceneFile, SubplotRingDragController } from './SubplotRingDragController';

// What the confirm dialog showed, what was renumbered, and which membership
// edits were applied.
const shown: DragConfirmCurrentMoveSummary[] = [];
const renumbered: SceneUpdate[][] = [];
const memberships: Array<{ path: string; change: SubplotMembershipChange }> = [];

vi.mock('../../modals/DragConfirmModal', () => ({
    DragConfirmModal: class {
        constructor(_app: unknown, summary: DragConfirmCurrentMoveSummary) {
            shown.push(summary);
        }
        waitForBegin(): Promise<boolean> { return Promise.resolve(true); }
        updateProgress(): void {}
        close(): void {}
        finishWithDismiss(): Promise<void> { return Promise.resolve(); }
    },
}));

vi.mock('../../services/SceneReorderService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/SceneReorderService')>()),
    applySceneNumberUpdates: vi.fn((_app: unknown, updates: SceneUpdate[]) => {
        renumbered.push(updates);
        return Promise.resolve();
    }),
}));

vi.mock('../../services/SubplotMembership', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/SubplotMembership')>()),
    applySubplotMembershipChange: vi.fn((_app: unknown, file: TFile, change: SubplotMembershipChange) => {
        memberships.push({ path: file.path, change });
        return Promise.resolve([]);
    }),
}));

vi.mock('../../utils/sleep', () => ({ sleep: () => Promise.resolve() }));

// Just enough SVG: class and [attr="value"] selectors, #id, closest.
class FakeEl {
    readonly classList = { add: (): void => {}, remove: (): void => {}, contains: (): boolean => false };
    readonly style = { setProperty: (): void => {}, removeProperty: (): void => {} };
    readonly children: FakeEl[] = [];
    parent: FakeEl | null = null;

    constructor(readonly classes: string[], readonly attrs: Record<string, string> = {}, readonly id = '') {}

    append(...kids: FakeEl[]): this {
        kids.forEach((kid) => { kid.parent = this; this.children.push(kid); });
        return this;
    }
    getAttribute(name: string): string | null { return this.attrs[name] ?? null; }
    private descendants(): FakeEl[] { return this.children.flatMap((child) => [child, ...child.descendants()]); }
    private matches(selector: string): boolean {
        return selector.split(',').some((part) => {
            const one = part.trim();
            if (one.startsWith('#')) return this.id === one.slice(1).replace(/\\/g, '');
            const classes = [...one.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
            const attrs = [...one.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)].map((m) => [m[1], m[2]] as const);
            return classes.every((c) => this.classes.includes(c))
                && attrs.every(([k, v]) => (v === undefined ? k in this.attrs : this.attrs[k] === v));
        });
    }
    querySelectorAll(selector: string): FakeEl[] { return this.descendants().filter((el) => el.matches(selector)); }
    querySelector(selector: string): FakeEl | null { return this.querySelectorAll(selector)[0] ?? null; }
    closest(selector: string): FakeEl | null {
        for (let el: FakeEl | null = this; el; el = el.parent) if (el.matches(selector)) return el;
        return null;
    }
}

const OUTER = 3;
const SHIPWRECK_RING = 2;
const KEEPERS_RING = 1;
const SHIPWRECK = 'The Shipwreck';
const KEEPERS = "The Keeper's Letters";

// The Lighthouse, Book 2 around Act 2 (act index 1), outer ring in manuscript order.
const SCENES: Array<[string, number, 'Scene' | 'Beat', string]> = [
    ['10 Scene', 0, 'Scene', 'Main Plot'],
    ['10.01 Debate', 0, 'Beat', ''],
    ['11 Scene', 1, 'Scene', SHIPWRECK],
    ['12 Scene', 1, 'Scene', KEEPERS],
    ['13 Scene', 1, 'Scene', ''],
    ['14 Scene', 1, 'Scene', SHIPWRECK],
    ['14.01 Fun and Games', 1, 'Beat', ''],
    ['15 Scene', 1, 'Scene', KEEPERS],
    ['21 Scene', 2, 'Scene', KEEPERS],
];

const path = (basename: string): string => `Book/${basename}.md`;
const angleOf = (basename: string): number => SCENES.findIndex(([name]) => name === basename) * 0.1;

function sceneGroup(basename: string, act: number, ring: number, itemType: 'Scene' | 'Beat' = 'Scene'): FakeEl {
    return new FakeEl(['rt-scene-group'], {
        'data-item-type': itemType,
        'data-act': String(act),
        'data-ring': String(ring),
        'data-start-angle': String(angleOf(basename)),
        'data-path': encodeURIComponent(path(basename)),
    }).append(new FakeEl(['rt-scene-path'], {}, `r${ring}-${basename}`));
}

function buildTimeline(): { svg: FakeEl; groups: Map<string, FakeEl> } {
    const svg = new FakeEl(['radial-timeline-svg']);
    const groups = new Map<string, FakeEl>();
    for (const [basename, act, itemType] of SCENES) {
        const group = sceneGroup(basename, act, OUTER, itemType);
        groups.set(`${OUTER}:${basename}`, group);
        svg.append(group);
    }
    for (const [basename, act, ring] of [['14 Scene', 1, SHIPWRECK_RING], ['21 Scene', 2, KEEPERS_RING]] as const) {
        const group = sceneGroup(basename, act, ring);
        groups.set(`${ring}:${basename}`, group);
        svg.append(group);
    }
    // The outer ring's label names Main Plot (masterSubplotOrder[0]) in every
    // mode; only Progress mode shows Main Plot there.
    svg.append(
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(OUTER), 'data-subplot-name': 'Main Plot' }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(SHIPWRECK_RING), 'data-subplot-name': SHIPWRECK }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(KEEPERS_RING), 'data-subplot-name': KEEPERS }),
    );
    return { svg, groups };
}

function makePlugin(subplotsByPath: Record<string, string | string[]>) {
    const files = new Map(SCENES.map(([basename]) => [path(basename), new TFile(path(basename))]));
    return {
        app: {
            vault: { getAbstractFileByPath: (p: string) => files.get(p) ?? null },
            metadataCache: {
                getFileCache: (file: TFile) => {
                    const subplot = subplotsByPath[file.path];
                    return { frontmatter: subplot ? { Subplot: subplot } : {} };
                },
            },
        },
        settings: { enableManuscriptRippleRename: false, books: [] },
        saveSettings: () => Promise.resolve(),
        getSceneData: () => Promise.resolve([]),
    };
}

const renderScope = { register: (): void => {}, registerDomEvent: (): void => {} };
const lighthouseSubplots = Object.fromEntries(SCENES.filter(([, , type]) => type === 'Scene').map(([b, , , s]) => [path(b), s]));

type SubplotInternals = {
    sourceGroup: FakeEl | null;
    sourcePath: string | null;
    sourceRing: number;
    sourceSubplot: string | null;
    dragging: boolean;
    target: { ring: number; element: FakeEl } | null;
    membershipOf(ring: number): string | null;
    finishDrop(shift: boolean): Promise<void>;
};

function subplotDrag(mode: string, subplots: Record<string, string | string[]> = lighthouseSubplots) {
    const { svg, groups } = buildTimeline();
    const controller = new SubplotRingDragController({ plugin: makePlugin(subplots), renderScope } as never, svg as never, { mode, onRefresh: () => {} });
    const internals = controller as unknown as SubplotInternals;
    // What startDrag records for a grab on `ring`, and the ring under the pointer.
    const drag = async (basename: string, fromRing: number, toRing: number, shift: boolean): Promise<void> => {
        internals.sourceGroup = groups.get(`${fromRing}:${basename}`)!;
        internals.sourcePath = path(basename);
        internals.sourceRing = fromRing;
        internals.sourceSubplot = internals.membershipOf(fromRing);
        internals.dragging = true;
        internals.target = { ring: toRing, element: new FakeEl(['rt-void-cell'], { 'data-ring': String(toRing) }) };
        await internals.finishDrop(shift);
    };
    return { internals, drag };
}

beforeEach(() => {
    shown.length = 0;
    renumbered.length = 0;
    memberships.length = 0;
});

describe('subplot ring drag — the membership contract', () => {
    it('a drag moves the grabbed subplot and renames, reorders and re-acts nothing', async () => {
        const { drag } = subplotDrag('narrative');
        await drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);

        expect(memberships).toEqual([{ path: path('14 Scene'), change: { kind: 'move', from: SHIPWRECK, to: KEEPERS } }]);
        expect(renumbered).toHaveLength(0);
        expect(shown[0]).toMatchObject({
            actionSummary: `Scene 14: Move ${SHIPWRECK} → ${KEEPERS}`,
            showRenameImpact: false,
            contextLabel: 'Subplots',
            contextChange: `${SHIPWRECK} → ${KEEPERS}`,
            badge: 'Move Scene',
            title: 'Confirm subplot change',
        });
    });

    it('Shift at the drop adds the destination and keeps the grabbed subplot', async () => {
        const { drag } = subplotDrag('narrative');
        await drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);

        expect(memberships[0].change).toEqual({ kind: 'add', to: KEEPERS });
        expect(shown[0]).toMatchObject({ contextChange: `${SHIPWRECK} → ${SHIPWRECK}, ${KEEPERS}`, badge: 'Add Subplot' });
    });

    it('Shift onto a subplot the scene already has asks nothing and changes nothing', async () => {
        const { drag } = subplotDrag('narrative', { ...lighthouseSubplots, [path('14 Scene')]: [SHIPWRECK, KEEPERS] });
        await drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);
        expect(shown).toHaveLength(0);
        expect(memberships).toHaveLength(0);
    });

    it('a drag onto a subplot the scene already has drops only the grabbed one', async () => {
        const { drag } = subplotDrag('narrative', { ...lighthouseSubplots, [path('14 Scene')]: [SHIPWRECK, KEEPERS] });
        await drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);
        expect(shown[0].contextChange).toBe(`${SHIPWRECK}, ${KEEPERS} → ${KEEPERS}`);
    });
});

describe('which rings are subplots', () => {
    it('in Narrative and Chronologue the outer ring lists every scene and is no subplot', () => {
        for (const mode of ['narrative', 'chronologue']) {
            const { internals } = subplotDrag(mode);
            expect(internals.membershipOf(OUTER), mode).toBeNull();
            expect(internals.membershipOf(SHIPWRECK_RING), mode).toBe(SHIPWRECK);
        }
    });

    it('in Progress the outer ring is Main Plot: dragging from it moves Main Plot', async () => {
        const { internals, drag } = subplotDrag('progress');
        expect(internals.membershipOf(OUTER)).toBe('Main Plot');
        await drag('10 Scene', OUTER, SHIPWRECK_RING, false);
        expect(memberships[0].change).toEqual({ kind: 'move', from: 'Main Plot', to: SHIPWRECK });
        expect(shown[0].contextChange).toBe(`Main Plot → ${SHIPWRECK}`);
    });

    it('a scene with no Subplot field is in Main Plot: a drag drops Main Plot, Shift keeps it', async () => {
        const moved = subplotDrag('progress');
        await moved.drag('13 Scene', OUTER, SHIPWRECK_RING, false);
        expect(shown[0].contextChange).toBe(`Main Plot → ${SHIPWRECK}`);

        const added = subplotDrag('progress');
        await added.drag('13 Scene', OUTER, SHIPWRECK_RING, true);
        expect(shown[1].contextChange).toBe(`Main Plot → Main Plot, ${SHIPWRECK}`);
    });
});

describe('describeSceneFile', () => {
    it('names a scene the way the timeline does', () => {
        expect(describeSceneFile('14 Scene')).toBe('Scene 14');
        expect(describeSceneFile('3 The Wreck')).toBe('Scene 3 The Wreck');
        expect(describeSceneFile('Untitled')).toBe('Untitled');
    });
});

type OuterTarget =
    | { type: 'scene'; group: FakeEl; sceneId: string; act: number; ring: number }
    | { type: 'void'; element: FakeEl; act: number; ring: number; startAngle: number; endAngle: number; isOuterRing: boolean };

type OuterInternals = {
    sourceSceneId: string | null;
    sourcePath: string | null;
    sourceSceneGroup: FakeEl | null;
    sourceItemType: 'Scene' | 'Beat';
    currentTarget: OuterTarget | null;
    finishDrag(): Promise<void>;
    isValidTarget(target: OuterTarget): boolean;
};

describe('the All Scenes ring reorders and never edits subplots', () => {
    function outer() {
        const { svg, groups } = buildTimeline();
        const controller = new OuterRingDragController({ plugin: makePlugin(lighthouseSubplots), renderScope } as never, svg as never, { onRefresh: () => {}, mode: 'narrative' });
        const internals = controller as unknown as OuterInternals;
        const grab = (basename: string): void => {
            const group = groups.get(`${OUTER}:${basename}`)!;
            internals.sourceSceneGroup = group;
            internals.sourceSceneId = group.querySelector('.rt-scene-path')!.id;
            internals.sourcePath = path(basename);
            internals.sourceItemType = group.getAttribute('data-item-type') as 'Scene' | 'Beat';
        };
        return { internals, groups, grab };
    }

    it('rejects drops on subplot rings', () => {
        const { internals, groups, grab } = outer();
        grab('14 Scene');
        const keepersScene = groups.get(`${KEEPERS_RING}:21 Scene`)!;
        expect(internals.isValidTarget({ type: 'scene', group: keepersScene, sceneId: 'k', act: 2, ring: KEEPERS_RING })).toBe(false);
        expect(internals.isValidTarget({ type: 'void', element: new FakeEl(['rt-void-cell']), act: 1, ring: KEEPERS_RING, startAngle: 0, endAngle: 0.1, isOuterRing: false })).toBe(false);
        expect(internals.isValidTarget({ type: 'void', element: new FakeEl(['rt-void-cell']), act: 2, ring: OUTER, startAngle: 0.8, endAngle: 0.9, isOuterRing: true })).toBe(true);
    });

    it('reorders without writing a subplot, whatever the target scene belongs to', async () => {
        const { internals, groups, grab } = outer();
        grab('14 Scene');
        const target = groups.get(`${OUTER}:12 Scene`)!;
        internals.currentTarget = { type: 'scene', group: target, sceneId: target.querySelector('.rt-scene-path')!.id, act: 1, ring: OUTER };
        await internals.finishDrag();

        expect(shown[0].actionSummary).toBe('Move Scene 14 before Scene 12');
        expect(renumbered[0].length).toBeGreaterThan(0);
        expect(renumbered[0].every((update) => update.subplots === undefined)).toBe(true);
        expect(memberships).toHaveLength(0);
    });
});
