import { describe, expect, it } from 'vitest';
import { TFile, type App } from 'obsidian';
import {
    describeSubplotMembershipChange,
    findSubplotKey,
    planSubplotMembership,
    readSubplotMemberships,
    restoreSubplotField,
    writeSubplotMemberships,
} from './SubplotMembership';

describe('planSubplotMembership — the plan\'s table for memberships A, B, C', () => {
    const abc = ['A', 'B', 'C'];
    it('drag A to D moves it: B, C, D', () => {
        expect(planSubplotMembership(abc, { kind: 'move', from: 'A', to: 'D' })).toEqual(['B', 'C', 'D']);
    });
    it('Shift-drag to D adds it: A, B, C, D', () => {
        expect(planSubplotMembership(abc, { kind: 'add', to: 'D' })).toEqual(['A', 'B', 'C', 'D']);
    });
    it('drag A to C, already a member, drops only A: B, C', () => {
        expect(planSubplotMembership(abc, { kind: 'move', from: 'A', to: 'C' })).toEqual(['B', 'C']);
    });
    it('Shift-drag to C, already a member, changes nothing', () => {
        expect(planSubplotMembership(abc, { kind: 'add', to: 'C' })).toBeNull();
    });
    it('either gesture onto A itself changes nothing', () => {
        expect(planSubplotMembership(abc, { kind: 'move', from: 'A', to: 'A' })).toBeNull();
        expect(planSubplotMembership(abc, { kind: 'add', to: 'A' })).toBeNull();
    });
});

describe('planSubplotMembership — Main Plot', () => {
    it('moves an explicit Main Plot like any other membership', () => {
        expect(planSubplotMembership(['Main Plot'], { kind: 'move', from: 'Main Plot', to: 'The Shipwreck' })).toEqual(['The Shipwreck']);
    });
    it('returns a scene with no membership left to Main Plot', () => {
        expect(planSubplotMembership(['The Shipwreck'], { kind: 'remove', from: 'The Shipwreck' })).toEqual(['Main Plot']);
    });
    it('treats a scene with no Subplot field as Main Plot', () => {
        // Dragging it drops Main Plot for the new subplot; Shift-dragging keeps Main Plot.
        expect(planSubplotMembership([], { kind: 'move', from: 'Main Plot', to: 'The Shipwreck' })).toEqual(['The Shipwreck']);
        expect(planSubplotMembership([], { kind: 'add', to: 'The Shipwreck' })).toEqual(['Main Plot', 'The Shipwreck']);
        expect(planSubplotMembership([], { kind: 'remove', from: 'Main Plot' })).toBeNull();
        expect(planSubplotMembership([], { kind: 'add', to: 'Main Plot' })).toBeNull();
    });
    it('ignores blank and repeated names already in the field', () => {
        expect(planSubplotMembership(['A', ' A ', ''], { kind: 'add', to: 'B' })).toEqual(['A', 'B']);
    });
});

describe('describeSubplotMembershipChange', () => {
    it('reads as the preview does', () => {
        expect(describeSubplotMembershipChange({ kind: 'move', from: 'The Shipwreck', to: "The Keeper's Letters" })).toBe("Move The Shipwreck → The Keeper's Letters");
        expect(describeSubplotMembershipChange({ kind: 'add', to: "The Keeper's Letters" })).toBe("Add The Keeper's Letters");
        expect(describeSubplotMembershipChange({ kind: 'remove', from: 'The Shipwreck' })).toBe('Remove The Shipwreck');
    });
});

// processFrontMatter over a plain object, like Obsidian's.
function fakeApp(frontmatter: Record<string, unknown>): App {
    return {
        metadataCache: { getFileCache: () => ({ frontmatter }) },
        fileManager: {
            processFrontMatter: (_file: TFile, fn: (fm: Record<string, unknown>) => void) => {
                fn(frontmatter);
                return Promise.resolve();
            },
        },
    } as unknown as App;
}

describe('reading and writing the Subplot field', () => {
    const file = new TFile('Book/14 Scene.md');

    it('writes one name as a string and several as a list, in the existing key', async () => {
        const fm: Record<string, unknown> = { subplot: 'The Shipwreck', Act: 2 };
        await writeSubplotMemberships(fakeApp(fm), file, ['The Shipwreck', "The Keeper's Letters"]);
        expect(fm).toEqual({ subplot: ['The Shipwreck', "The Keeper's Letters"], Act: 2 });
        await writeSubplotMemberships(fakeApp(fm), file, ["The Keeper's Letters"]);
        expect(fm.subplot).toBe("The Keeper's Letters");
    });

    it('follows a custom key mapping', () => {
        const fm = { Thread: ['A', 'B'] };
        expect(findSubplotKey(fm, { Thread: 'Subplot' })).toBe('Thread');
        expect(readSubplotMemberships(fakeApp(fm), file, { Thread: 'Subplot' })).toEqual(['A', 'B']);
    });

    it('restores exactly what was there, including no field at all', async () => {
        const listed: Record<string, unknown> = { Subplot: ['A', 'B'] };
        const snapshot = await writeSubplotMemberships(fakeApp(listed), file, ['C']);
        await restoreSubplotField(fakeApp(listed), file, snapshot);
        expect(listed).toEqual({ Subplot: ['A', 'B'] });

        const none: Record<string, unknown> = { Act: 1 };
        const fromNothing = await writeSubplotMemberships(fakeApp(none), file, ['The Shipwreck']);
        await restoreSubplotField(fakeApp(none), file, fromNothing);
        expect(none).toEqual({ Act: 1 });
    });
});
