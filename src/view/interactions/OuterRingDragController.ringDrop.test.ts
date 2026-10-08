import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { DragConfirmCurrentMoveSummary } from '../../modals/DragConfirmModal';
import type { SceneUpdate } from '../../services/SceneReorderService';
import type { SubplotMembershipChange } from '../../services/SubplotMembership';
import { OuterRingDragController } from './OuterRingDragController';

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
            const attrs = [...one.matchAll(/\[([\w-]+)="([^"]*)"\]/g)].map((m) => [m[1], m[2]] as const);
            return classes.every((c) => this.classes.includes(c)) && attrs.every(([k, v]) => this.attrs[k] === v);
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
    ['13 Scene', 1, 'Scene', 'Main Plot'],
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
    // Subplot-ring copies used below: scene 14 on The Shipwreck, scene 21 on
    // The Keeper's Letters (Act 3).
    for (const [basename, act, ring] of [['14 Scene', 1, SHIPWRECK_RING], ['21 Scene', 2, KEEPERS_RING]] as const) {
        const group = sceneGroup(basename, act, ring);
        groups.set(`${ring}:${basename}`, group);
        svg.append(group);
    }
    svg.append(
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(OUTER), 'data-subplot-name': 'Main Plot' }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(SHIPWRECK_RING), 'data-subplot-name': SHIPWRECK }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(KEEPERS_RING), 'data-subplot-name': KEEPERS }),
    );
    return { svg, groups };
}

function makeController(svg: FakeEl, subplotsByPath: Record<string, string | string[]>): OuterRingDragController {
    const files = new Map(SCENES.map(([basename]) => [path(basename), new TFile(path(basename))]));
    const plugin = {
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
    const view = { plugin, renderScope: { register: (): void => {}, registerDomEvent: (): void => {} } };
    return new OuterRingDragController(view as never, svg as never, { onRefresh: () => {}, mode: 'narrative' });
}

type Target =
    | { type: 'scene'; group: FakeEl; sceneId: string; act: number; ring: number }
    | { type: 'void'; element: FakeEl; act: number; ring: number; startAngle: number; endAngle: number; isOuterRing: boolean };

type ControllerInternals = {
    sourceSceneId: string | null;
    sourcePath: string | null;
    sourceSceneGroup: FakeEl | null;
    sourceItemType: 'Scene' | 'Beat';
    sourceRing: number;
    sourceSubplot: string | null;
    currentTarget: Target | null;
    finishDrag(shift: boolean): Promise<void>;
    isValidTarget(target: Target): boolean;
};

const subplotsOfLighthouse = Object.fromEntries(SCENES.filter(([, , type]) => type === 'Scene').map(([b, , , s]) => [path(b), s]));

function setup(subplots: Record<string, string | string[]> = subplotsOfLighthouse) {
    const { svg, groups } = buildTimeline();
    const internals = makeController(svg, subplots) as unknown as ControllerInternals;
    const grab = (basename: string, ring: number, subplot: string | null): void => {
        const group = groups.get(`${ring}:${basename}`)!;
        internals.sourceSceneGroup = group;
        internals.sourceSceneId = group.querySelector('.rt-scene-path')!.id;
        internals.sourcePath = path(basename);
        internals.sourceItemType = (group.getAttribute('data-item-type') as 'Scene' | 'Beat');
        internals.sourceRing = ring;
        internals.sourceSubplot = subplot;
    };
    const keepersGap: Target = {
        type: 'void', element: new FakeEl(['rt-void-cell']), act: 1, ring: KEEPERS_RING,
        startAngle: angleOf('11 Scene'), endAngle: angleOf('11 Scene') + 0.1, isOuterRing: false,
    };
    return { internals, groups, grab, keepersGap };
}

describe('drag onto another subplot ring — the membership contract', () => {
    beforeEach(() => {
        shown.length = 0;
        renumbered.length = 0;
        memberships.length = 0;
    });

    it('drag moves the grabbed membership, and renames, reorders and re-acts nothing', async () => {
        const { internals, grab, keepersGap } = setup();
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        internals.currentTarget = keepersGap;
        await internals.finishDrag(false);

        expect(memberships).toEqual([{ path: path('14 Scene'), change: { kind: 'move', from: SHIPWRECK, to: KEEPERS } }]);
        expect(renumbered).toHaveLength(0);
        expect(shown[0]).toMatchObject({
            actionSummary: `Scene 14: Move ${SHIPWRECK} → ${KEEPERS}`,
            showRenameImpact: false,
            contextLabel: 'Subplots',
            contextChange: `${SHIPWRECK} → ${KEEPERS}`,
            title: 'Confirm subplot change',
        });
    });

    it('Shift-drag adds the destination and keeps the source', async () => {
        const { internals, grab, keepersGap } = setup();
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        internals.currentTarget = keepersGap;
        await internals.finishDrag(true);

        expect(memberships[0].change).toEqual({ kind: 'add', to: KEEPERS });
        expect(shown[0].contextChange).toBe(`${SHIPWRECK} → ${SHIPWRECK}, ${KEEPERS}`);
        expect(shown[0].badge).toBe('Add Subplot');
    });

    it('a drop in another act is still only a membership edit', async () => {
        const { internals, groups, grab } = setup();
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        const inAct3 = groups.get(`${KEEPERS_RING}:21 Scene`)!;
        internals.currentTarget = { type: 'scene', group: inAct3, sceneId: inAct3.querySelector('.rt-scene-path')!.id, act: 2, ring: KEEPERS_RING };
        await internals.finishDrag(false);

        expect(memberships[0].change).toEqual({ kind: 'move', from: SHIPWRECK, to: KEEPERS });
        expect(renumbered).toHaveLength(0);
    });

    it('from the outer ring, which is no membership, a drag adds', async () => {
        const { internals, grab, keepersGap } = setup();
        grab('14 Scene', OUTER, null);
        internals.currentTarget = keepersGap;
        await internals.finishDrag(false);

        expect(memberships[0].change).toEqual({ kind: 'add', to: KEEPERS });
        expect(shown[0].contextChange).toBe(`${SHIPWRECK} → ${SHIPWRECK}, ${KEEPERS}`);
    });

    it('a Shift-drag onto a subplot the scene already has asks nothing and changes nothing', async () => {
        const { internals, grab, keepersGap } = setup({ ...subplotsOfLighthouse, [path('14 Scene')]: [SHIPWRECK, KEEPERS] });
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        internals.currentTarget = keepersGap;
        await internals.finishDrag(true);

        expect(shown).toHaveLength(0);
        expect(memberships).toHaveLength(0);
    });

    it('a normal drag onto a subplot the scene already has drops only the grabbed one', async () => {
        const { internals, grab, keepersGap } = setup({ ...subplotsOfLighthouse, [path('14 Scene')]: [SHIPWRECK, KEEPERS] });
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        internals.currentTarget = keepersGap;
        await internals.finishDrag(false);

        expect(shown[0].contextChange).toBe(`${SHIPWRECK}, ${KEEPERS} → ${KEEPERS}`);
    });

    it('accepts only other subplot rings for a subplot-ring grab, and no subplot ring for a beat', () => {
        const { internals, groups, grab, keepersGap } = setup();
        grab('14 Scene', SHIPWRECK_RING, SHIPWRECK);
        const ownRing = groups.get(`${SHIPWRECK_RING}:14 Scene`)!;
        const outerScene = groups.get(`${OUTER}:12 Scene`)!;
        expect(internals.isValidTarget(keepersGap)).toBe(true);
        expect(internals.isValidTarget({ type: 'scene', group: ownRing, sceneId: 'x', act: 1, ring: SHIPWRECK_RING })).toBe(false);
        expect(internals.isValidTarget({ type: 'scene', group: outerScene, sceneId: 'y', act: 1, ring: OUTER })).toBe(false);

        grab('14.01 Fun and Games', OUTER, null);
        expect(internals.isValidTarget(keepersGap)).toBe(false);
        expect(internals.isValidTarget({ type: 'scene', group: outerScene, sceneId: 'y', act: 1, ring: OUTER })).toBe(true);
    });
});

describe('reorder on the outer ring', () => {
    beforeEach(() => {
        shown.length = 0;
        renumbered.length = 0;
        memberships.length = 0;
    });

    it('never writes a subplot, whatever the target scene belongs to', async () => {
        const { internals, groups, grab } = setup();
        grab('14 Scene', OUTER, null);
        const target = groups.get(`${OUTER}:12 Scene`)!;
        internals.currentTarget = { type: 'scene', group: target, sceneId: target.querySelector('.rt-scene-path')!.id, act: 1, ring: OUTER };
        await internals.finishDrag(false);

        expect(shown[0].actionSummary).toBe('Move Scene 14 before Scene 12');
        expect(renumbered[0].length).toBeGreaterThan(0);
        expect(renumbered[0].every((update) => update.subplots === undefined)).toBe(true);
        expect(memberships).toHaveLength(0);
    });
});
