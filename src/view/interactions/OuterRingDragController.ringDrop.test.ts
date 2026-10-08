import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import type { DragConfirmCurrentMoveSummary } from '../../modals/DragConfirmModal';
import type { SceneUpdate } from '../../services/SceneReorderService';
import { OuterRingDragController } from './OuterRingDragController';

// What the confirm dialog was asked to show, and what was written to the vault.
const shown: DragConfirmCurrentMoveSummary[] = [];
const applied: SceneUpdate[][] = [];

vi.mock('../../modals/DragConfirmModal', () => ({
    DragConfirmModal: class {
        constructor(_app: unknown, summary: DragConfirmCurrentMoveSummary) {
            shown.push(summary);
        }
        waitForBegin(): Promise<boolean> { return Promise.resolve(true); }
        updateProgress(): void {}
        finishWithDismiss(): Promise<void> { return Promise.resolve(); }
    },
}));

vi.mock('../../services/SceneReorderService', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../../services/SceneReorderService')>()),
    applySceneNumberUpdates: vi.fn((_app: unknown, updates: SceneUpdate[]) => {
        applied.push(updates);
        return Promise.resolve();
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
const KEEPERS_RING = 1;

// The Lighthouse, Book 2 around Act 2 (act index 1), outer ring in manuscript order.
const SCENES: Array<[string, number, 'Scene' | 'Beat', string]> = [
    ['10 Scene', 0, 'Scene', 'Main Plot'],
    ['10.01 Debate', 0, 'Beat', ''],
    ['11 Scene', 1, 'Scene', 'The Shipwreck'],
    ['11.01 Break into Two', 1, 'Beat', ''],
    ['12 Scene', 1, 'Scene', "The Keeper's Letters"],
    ['12.01 B Story', 1, 'Beat', ''],
    ['13 Scene', 1, 'Scene', 'Main Plot'],
    ['14 Scene', 1, 'Scene', 'The Shipwreck'],
    ['14.01 Fun and Games', 1, 'Beat', ''],
    ['15 Scene', 1, 'Scene', "The Keeper's Letters"],
    ['21 Scene', 2, 'Scene', "The Keeper's Letters"],
];

const path = (basename: string): string => `Book/${basename}.md`;
const angleOf = (basename: string): number => SCENES.findIndex(([name]) => name === basename) * 0.1;

function buildTimeline(): { svg: FakeEl; innerScene: FakeEl } {
    const svg = new FakeEl(['radial-timeline-svg']);
    SCENES.forEach(([basename, act, itemType], index) => {
        svg.append(new FakeEl(['rt-scene-group'], {
            'data-item-type': itemType,
            'data-act': String(act),
            'data-ring': String(OUTER),
            'data-start-angle': String(index * 0.1),
            'data-path': encodeURIComponent(path(basename)),
            'data-subplot-index': '0',
        }).append(new FakeEl(['rt-scene-path'], {}, `outer-${index}`)));
    });
    // The Keeper's Letters ring: a scene in Act 3, and in Sequence alignment a
    // gap in Act 2 at scene 11's angle — where scene 14 was dropped in the report.
    const innerScene = new FakeEl(['rt-scene-group'], {
        'data-item-type': 'Scene',
        'data-act': '2',
        'data-ring': String(KEEPERS_RING),
        'data-start-angle': String(angleOf('21 Scene')),
        'data-path': encodeURIComponent(path('21 Scene')),
    }).append(new FakeEl(['rt-scene-path'], {}, 'inner-21'));
    svg.append(
        innerScene,
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(OUTER), 'data-subplot-name': 'Main Plot' }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': '2', 'data-subplot-name': 'The Shipwreck' }),
        new FakeEl(['rt-subplot-ring-label-text'], { 'data-ring': String(KEEPERS_RING), 'data-subplot-name': "The Keeper's Letters" }),
    );
    return { svg, innerScene };
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

type ControllerInternals = {
    sourceSceneId: string | null;
    sourcePath: string | null;
    sourceSceneGroup: FakeEl | null;
    currentTarget: unknown;
    finishDrag(): Promise<void>;
};

function pickUp(controller: OuterRingDragController, svg: FakeEl, basename: string): ControllerInternals {
    const internals = controller as unknown as ControllerInternals;
    const group = svg.querySelectorAll('.rt-scene-group').find((g) => g.getAttribute('data-path') === encodeURIComponent(path(basename)) && g.getAttribute('data-ring') === String(OUTER))!;
    internals.sourceSceneGroup = group;
    internals.sourceSceneId = group.querySelector('.rt-scene-path')!.id;
    internals.sourcePath = path(basename);
    return internals;
}

const subplotsOfLighthouse = Object.fromEntries(SCENES.filter(([, , type]) => type === 'Scene').map(([b, , , s]) => [path(b), s]));

describe('OuterRingDragController — drop on a subplot ring', () => {
    beforeEach(() => {
        shown.length = 0;
        applied.length = 0;
    });

    it('changes only the subplot, names the real source subplot, and renames nothing', async () => {
        const { svg } = buildTimeline();
        const controller = makeController(svg, subplotsOfLighthouse);
        const internals = pickUp(controller, svg, '14 Scene');
        internals.currentTarget = {
            type: 'void', element: new FakeEl(['rt-void-cell']), act: 1, ring: KEEPERS_RING,
            startAngle: angleOf('11 Scene'), endAngle: angleOf('11 Scene') + 0.1, isOuterRing: false,
        };
        await internals.finishDrag();

        expect(shown).toHaveLength(1);
        expect(shown[0]).toMatchObject({
            actionSummary: "Move Scene 14 to The Keeper's Letters",
            renameCount: 0,
            contextChange: "Act 2 • The Shipwreck → Act 2 • The Keeper's Letters",
            title: 'Confirm subplot change',
        });
        expect(applied).toEqual([[{ path: path('14 Scene'), newNumber: '14', actNumber: undefined, subplots: ["The Keeper's Letters"] }]]);
    });

    it('treats a drop on a scene in a subplot ring as a drop on that ring, act included', async () => {
        const { svg, innerScene } = buildTimeline();
        const controller = makeController(svg, subplotsOfLighthouse);
        const internals = pickUp(controller, svg, '14 Scene');
        internals.currentTarget = { type: 'scene', group: innerScene, sceneId: 'inner-21', act: 2, ring: KEEPERS_RING };
        await internals.finishDrag();

        expect(shown).toHaveLength(1);
        expect(shown[0].actionSummary).toBe("Move Scene 14 to Act 3 • The Keeper's Letters");
        expect(shown[0].contextChange).toBe("Act 2 • The Shipwreck → Act 3 • The Keeper's Letters");
        const numberOf = (basename: string): number => Number(applied[0].find((update) => update.path === path(basename))?.newNumber);
        // First in Act 3: it moves past scene 15 (the last of Act 2) and no further.
        expect(applied[0].find((update) => update.path === path('14 Scene'))).toMatchObject({ actNumber: 3, subplots: ["The Keeper's Letters"] });
        expect(numberOf('14 Scene')).toBe(numberOf('15 Scene') + 1);
        expect(numberOf('21 Scene')).toBe(numberOf('14 Scene') + 1);
    });

    it('asks nothing when the scene is already in that subplot and act', async () => {
        const { svg } = buildTimeline();
        const controller = makeController(svg, subplotsOfLighthouse);
        const internals = pickUp(controller, svg, '12 Scene');
        internals.currentTarget = {
            type: 'void', element: new FakeEl(['rt-void-cell']), act: 1, ring: KEEPERS_RING,
            startAngle: angleOf('13 Scene'), endAngle: angleOf('13 Scene') + 0.1, isOuterRing: false,
        };
        await internals.finishDrag();
        expect(shown).toHaveLength(0);
        expect(applied).toHaveLength(0);
    });
});

describe('OuterRingDragController — reorder on the outer ring', () => {
    beforeEach(() => {
        shown.length = 0;
        applied.length = 0;
    });

    it('never writes a subplot, whatever the target scene belongs to', async () => {
        const { svg } = buildTimeline();
        const controller = makeController(svg, subplotsOfLighthouse);
        const internals = pickUp(controller, svg, '14 Scene');
        const target = svg.querySelectorAll('.rt-scene-group').find((g) => g.getAttribute('data-path') === encodeURIComponent(path('12 Scene')))!;
        internals.currentTarget = { type: 'scene', group: target, sceneId: target.querySelector('.rt-scene-path')!.id, act: 1, ring: OUTER };
        await internals.finishDrag();

        expect(shown).toHaveLength(1);
        expect(shown[0].actionSummary).toBe('Move Scene 14 before Scene 12');
        expect(applied[0].length).toBeGreaterThan(0);
        expect(applied[0].every((update) => update.subplots === undefined)).toBe(true);
    });
});
