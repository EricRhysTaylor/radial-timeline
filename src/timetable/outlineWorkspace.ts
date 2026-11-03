import type { TFile, Workspace, WorkspaceLeaf } from 'obsidian';
import { t } from '../i18n';

type Direction = 'vertical' | 'horizontal';
type Entry = { pane: WorkspaceLeaf | null; timeline: WorkspaceLeaf | null; path: string; direction: Direction; pending: Promise<void> };

// A Bases view can be recreated while its leaf remains open. Keep ownership on
// the leaf, and serialize requests so rapid selections cannot create duplicates.
const entries = new WeakMap<WorkspaceLeaf, Entry>();

export function currentOutlineReference(workspace: Workspace, table: WorkspaceLeaf): TFile | null {
    const entry = entries.get(table);
    const pane = entry?.pane;
    if (!entry || !pane || !workspace.getLeavesOfType('markdown').includes(pane) || pane.getViewState().pinned) return null;
    const file = (pane.view as { file?: TFile | null }).file;
    return file?.path === entry.path ? file : null;
}

export async function openOutlineReference(workspace: Workspace, table: WorkspaceLeaf, file: TFile, direction: Direction, timelineLayout?: boolean): Promise<WorkspaceLeaf> {
    let entry = entries.get(table);
    if (!entry) {
        entry = { pane: null, timeline: null, path: '', direction, pending: Promise.resolve() };
        entries.set(table, entry);
    }
    const state = entry;
    let result: WorkspaceLeaf | undefined;
    const request = state.pending.catch(() => {}).then(async () => {
        const current = state.pane;
        const owned = current && workspace.getLeavesOfType('markdown').includes(current)
            && !current.getViewState().pinned && (current.view as { file?: TFile | null }).file?.path === state.path;
        const timeline = state.timeline;
        const ownsTimeline = timeline && workspace.getLeavesOfType('radial-timeline').includes(timeline)
            && !timeline.getViewState().pinned;
        const wantsTimeline = timelineLayout ?? !!ownsTimeline;
        if (owned && state.direction === direction && wantsTimeline === !!ownsTimeline) {
            if (state.path !== file.path) await current.openFile(file, { active: true });
            state.path = file.path;
            await workspace.revealLeaf(current);
            result = current;
            return;
        }
        // Remove only panes we created and still own before rebuilding the split.
        // This lets the timeline occupy the full left side rather than one row.
        let createdTimeline: WorkspaceLeaf | null = null;
        let displacedReference = false;
        const previousFile = owned ? (current.view as { file?: TFile | null }).file : null;
        const restoreReference = async () => {
            if (!displacedReference || !previousFile) return;
            const restored = workspace.createLeafBySplit(table, state.direction);
            try { await restored.openFile(previousFile, { active: true }); state.pane = restored; }
            catch { restored.detach(); }
        };
        if (wantsTimeline && !ownsTimeline) {
            if (owned) { current.detach(); state.pane = null; displacedReference = true; }
            const newTimeline = workspace.createLeafBySplit(table, 'vertical', true);
            try {
                await newTimeline.setViewState({ type: 'radial-timeline', active: false });
            } catch (error) {
                newTimeline.detach();
                await restoreReference();
                throw error;
            }
            state.timeline = newTimeline; createdTimeline = newTimeline;
        }
        const pane = workspace.createLeafBySplit(table, direction);
        try {
            await pane.openFile(file, { active: true });
        } catch (error) {
            pane.detach();
            if (createdTimeline) { createdTimeline.detach(); state.timeline = null; }
            await restoreReference();
            throw error;
        }
        if (ownsTimeline && !wantsTimeline) { timeline.detach(); state.timeline = null; }
        if (owned && state.pane === current) current.detach();
        state.pane = pane;
        state.path = file.path;
        state.direction = direction;
        result = pane;
    });
    state.pending = request;
    await request;
    if (!result) throw new Error(t('ui.timetable.outlineReferenceOpenFailed'));
    return result;
}
