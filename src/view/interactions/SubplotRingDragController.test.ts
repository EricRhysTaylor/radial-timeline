import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { DragConfirmCurrentMoveSummary } from '../../modals/DragConfirmModal';
import type { SceneUpdate } from '../../services/SceneReorderService';
import { describeSubplotMembershipChange, type SubplotMembershipChange } from '../../services/SubplotMembership';
import { t } from '../../i18n';
import { OuterRingDragController } from './OuterRingDragController';
import { describeSceneFile, ringOutlinePath, SubplotRingDragController } from './SubplotRingDragController';

// What the confirm dialog showed, what was renumbered, and which membership
// edits were applied.
const confirmation = vi.hoisted(() => ({
    hold: false,
    resolvers: [] as Array<(value: boolean) => void>,
}));
const shown: DragConfirmCurrentMoveSummary[] = [];
const accents: Array<string | undefined> = [];
const renumbered: SceneUpdate[][] = [];
const memberships: Array<{ path: string; change: SubplotMembershipChange }> = [];

vi.mock('../../modals/DragConfirmModal', () => ({
    DragConfirmModal: class {
        constructor(_app: unknown, summary: DragConfirmCurrentMoveSummary, _recent: unknown, _onHistory: unknown, accent?: string) {
            shown.push(summary);
            accents.push(accent);
        }
        waitForBegin(): Promise<boolean> {
            return confirmation.hold
                ? new Promise(resolve => confirmation.resolvers.push(resolve))
                : Promise.resolve(true);
        }
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

// Each colour slot reads back as its name, so a test can tell whose colour is on show.
vi.mock('../../renderer/utils/subplotColors', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../renderer/utils/subplotColors')>()),
    readSubplotColor: (_doc: unknown, index: number) => `slot-${index}`,
}));

// Just enough SVG: class and [attr="value"] selectors, #id, closest, and
// creating, inserting and removing the drag outline.
const fakeDocument = { createElementNS: (_ns: string, _tag: string): FakeEl => new FakeEl([]) };

class FakeEl {
    readonly ownerDocument = fakeDocument;
    readonly classList = {
        add: (...names: string[]): void => { names.forEach((name) => { if (!this.classes.includes(name)) this.classes.push(name); }); },
        remove: (...names: string[]): void => { names.forEach((name) => { const at = this.classes.indexOf(name); if (at >= 0) this.classes.splice(at, 1); }); },
        contains: (name: string): boolean => this.classes.includes(name),
    };
    readonly styles: Record<string, string> = {};
    readonly style = {
        setProperty: (name: string, value: string): void => { this.styles[name] = value; },
        removeProperty: (name: string): void => { delete this.styles[name]; },
    };
    readonly children: FakeEl[] = [];
    parent: FakeEl | null = null;

    constructor(readonly classes: string[], readonly attrs: Record<string, string> = {}, readonly id = '') {}

    append(...kids: FakeEl[]): this {
        kids.forEach((kid) => { kid.parent = this; this.children.push(kid); });
        return this;
    }
    appendChild(kid: FakeEl): FakeEl { this.append(kid); return kid; }
    before(el: FakeEl): void {
        const siblings = this.parent!.children;
        el.parent = this.parent;
        siblings.splice(siblings.indexOf(this), 0, el);
    }
    remove(): void {
        if (!this.parent) return;
        this.parent.children.splice(this.parent.children.indexOf(this), 1);
        this.parent = null;
    }
    setAttribute(name: string, value: string): void { this.attrs[name] = value; }
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
// Each ring is 40 wide with a 10 gap; each subplot paints in colour slot ring + 4.
const innerROf = (ring: number): number => 100 + ring * 50;
const outerROf = (ring: number): number => innerROf(ring) + 40;
const slotOf = (ring: number): string => `slot-${ring + 4}`;

function radii(ring: number): Record<string, string> {
    return { 'data-inner-r': String(innerROf(ring)), 'data-outer-r': String(outerROf(ring)) };
}

function sceneGroup(basename: string, act: number, ring: number, itemType: 'Scene' | 'Beat' = 'Scene'): FakeEl {
    return new FakeEl(['rt-scene-group'], {
        'data-item-type': itemType,
        'data-act': String(act),
        'data-ring': String(ring),
        'data-start-angle': String(angleOf(basename)),
        'data-path': encodeURIComponent(path(basename)),
        ...radii(ring),
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
    const label = (ring: number, name: string): FakeEl =>
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(ring), 'data-subplot-name': name, 'data-color-index': String(ring + 4) });
    svg.append(
        new FakeEl(['rt-void-cell'], { 'data-ring': String(KEEPERS_RING), ...radii(KEEPERS_RING) }),
        label(OUTER, 'Main Plot'),
        label(SHIPWRECK_RING, SHIPWRECK),
        label(KEEPERS_RING, KEEPERS),
        new FakeEl(['rt-number-squares']),
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
    shiftHeld: boolean;
    target: { ring: number; element: FakeEl } | null;
    membershipOf(ring: number): string | null;
    beginDrag(): void;
    updateFeedback(): void;
    reset(): void;
    finishDrop(shift: boolean): Promise<void>;
    onPointerUp(event: PointerEvent): Promise<void>;
};

function subplotDrag(mode: string, subplots: Record<string, string | string[]> = lighthouseSubplots) {
    const { svg, groups } = buildTimeline();
    const controller = new SubplotRingDragController({ plugin: makePlugin(subplots), renderScope } as never, svg as never, { mode, onRefresh: () => {} });
    const internals = controller as unknown as SubplotInternals;
    // What startDrag records for a grab on `ring`, then the drag begins.
    const grab = (basename: string, fromRing: number): FakeEl => {
        const group = groups.get(`${fromRing}:${basename}`)!;
        internals.sourceGroup = group;
        internals.sourcePath = path(basename);
        internals.sourceRing = fromRing;
        internals.sourceSubplot = internals.membershipOf(fromRing);
        internals.beginDrag();
        return group;
    };
    const pointAt = (toRing: number): void => {
        internals.target = { ring: toRing, element: new FakeEl(['rt-void-cell'], { 'data-ring': String(toRing) }) };
    };
    // The pointer over `toRing`, Shift held or not.
    const hover = (basename: string, fromRing: number, toRing: number, shift: boolean): FakeEl => {
        const group = grab(basename, fromRing);
        internals.shiftHeld = shift;
        pointAt(toRing);
        internals.updateFeedback();
        return group;
    };
    const drag = async (basename: string, fromRing: number, toRing: number, shift: boolean): Promise<void> => {
        grab(basename, fromRing);
        pointAt(toRing);
        await internals.finishDrop(shift);
    };
    const outlines = (): FakeEl[] => svg.querySelectorAll('.rt-membership-ring-outline');
    return { internals, svg, drag, hover, outlines };
}

beforeEach(() => {
    confirmation.hold = false;
    confirmation.resolvers.length = 0;
    shown.length = 0;
    accents.length = 0;
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
            actionSummary: `${t('ui.subplotRingDragController.sceneNumber', { number: '14' })}: ${describeSubplotMembershipChange({ kind: 'move', from: SHIPWRECK, to: KEEPERS })}`,
            showRenameImpact: false,
            contextLabel: t('ui.subplotRingDragController.contextLabel'),
            contextChange: `${SHIPWRECK} → ${KEEPERS}`,
            badge: t('ui.subplotRingDragController.badgeMove'),
            title: t('ui.subplotRingDragController.confirmTitle'),
        });
    });

    it('Shift at the drop adds the destination and keeps the grabbed subplot', async () => {
        const { drag } = subplotDrag('narrative');
        await drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);

        expect(memberships[0].change).toEqual({ kind: 'add', to: KEEPERS });
        expect(shown[0]).toMatchObject({ contextChange: `${SHIPWRECK} → ${SHIPWRECK}, ${KEEPERS}`, badge: t('ui.subplotRingDragController.badgeAdd') });
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

describe('subplot ring drag — what the author sees', () => {
    it('a move outlines the whole destination ring, under the number squares, in its colour', () => {
        const { svg, hover, outlines } = subplotDrag('narrative');
        hover('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);

        expect(outlines()).toHaveLength(1);
        const [outline] = outlines();
        expect(outline.styles['--rt-membership-color']).toBe(slotOf(KEEPERS_RING));
        const expected = ringOutlinePath(innerROf(KEEPERS_RING), outerROf(KEEPERS_RING));
        expect(outline.children.map((child) => child.getAttribute('d'))).toEqual([expected, expected]);
        const order = svg.children;
        expect(order.indexOf(outline)).toBeLessThan(order.indexOf(svg.querySelector('.rt-number-squares')!));
    });

    it('the grabbed scene wears its own colour, then the destination\'s on a move', () => {
        const { internals, hover } = subplotDrag('narrative');
        const group = hover('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);
        expect(group.styles['--rt-membership-color']).toBe(slotOf(KEEPERS_RING));

        internals.target = null;
        internals.updateFeedback();
        expect(group.styles['--rt-membership-color']).toBe(slotOf(SHIPWRECK_RING));
    });

    it('with Shift (add) the scene stays where it is, so it keeps its own colour', () => {
        const { hover, outlines } = subplotDrag('narrative');
        const group = hover('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);
        expect(group.styles['--rt-membership-color']).toBe(slotOf(SHIPWRECK_RING));
        expect(outlines()).toHaveLength(1);
    });

    it('a drop that would change nothing outlines nothing', () => {
        const { hover, outlines } = subplotDrag('narrative', { ...lighthouseSubplots, [path('14 Scene')]: [SHIPWRECK, KEEPERS] });
        const group = hover('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);
        expect(outlines()).toHaveLength(0);
        expect(group.styles['--rt-membership-color']).toBe(slotOf(SHIPWRECK_RING));
    });

    it('ending the drag clears the outline and the colour', () => {
        const { internals, hover, outlines } = subplotDrag('narrative');
        const group = hover('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);
        internals.reset();
        expect(outlines()).toHaveLength(0);
        expect(group.styles['--rt-membership-color']).toBeUndefined();
    });

    it('the confirmation wears the destination\'s colour, for a move and an add', async () => {
        await subplotDrag('narrative').drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);
        await subplotDrag('narrative').drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, true);
        expect(accents).toEqual([slotOf(KEEPERS_RING), slotOf(KEEPERS_RING)]);
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
        expect(describeSceneFile('14 Scene')).toBe(t('ui.subplotRingDragController.sceneNumber', { number: '14' }));
        expect(describeSceneFile('3 The Wreck')).toBe(t('ui.subplotRingDragController.sceneNumberLabel', { number: '3', label: 'The Wreck' }));
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

        expect(shown[0].actionSummary).toBe(`${t('ui.outerRingDragController.sceneNumber', { number: '14' })} | ${t('ui.outerRingDragController.sceneNumber', { number: '12' })}`);
        expect(renumbered[0].length).toBeGreaterThan(0);
        expect(renumbered[0].every((update) => update.subplots === undefined)).toBe(true);
        expect(memberships).toHaveLength(0);
    });
});


describe('native modal interaction after a ring drop', () => {
    it.each([true, false])('a pointer release on the confirmation controls never starts another drop (Begin=%s)', async (begin) => {
        confirmation.hold = true;
        const { drag, internals } = subplotDrag('narrative');
        const drop = drag('14 Scene', SHIPWRECK_RING, KEEPERS_RING, false);
        expect(shown).toHaveLength(1);
        // The window listener also receives the pointer-up preceding the
        // dialog's Begin/Cancel click. It must leave that one dialog alone.
        const buttonRelease = internals.onPointerUp({ shiftKey: false } as PointerEvent);
        try {
            expect(shown).toHaveLength(1);
        } finally {
            confirmation.resolvers.forEach((resolve, index) => resolve(index === 0 && begin));
            await Promise.all([drop, buttonRelease]);
        }
        expect(memberships).toHaveLength(begin ? 1 : 0);
    });
});
