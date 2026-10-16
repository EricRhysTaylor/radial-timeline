import { Menu } from 'obsidian';
import type { RadialTimelineView } from '../../view/TimeLineView';
import { currentTimelineColoring, currentTimelineLens, onTimelineOverlayChange, markTimetableRows } from '../../timetable/timetableRegistry';
import { openTimeReference } from './editor';
import { onReferenceSelection, hoverTimeReference, pinTimeReference } from './selection';
import { readTimeReferences, type TimeReference } from './model';

export function setupTimeReferenceInteractions(view: RadialTimelineView, svg: SVGSVGElement): void {
    const references = new Map<string, TimeReference>();
    // A rendered key contains the captured author declaration, not a second persisted record.
    svg.querySelectorAll('.ert-time-reference[data-reference-keys]').forEach(group => {
        const keys: unknown = JSON.parse(group.getAttribute('data-reference-keys')!);
        if (!Array.isArray(keys)) return;
        keys.forEach((key: unknown) => {
            if (typeof key !== 'string') return;
            const parsed: unknown = JSON.parse(key);
            if (!Array.isArray(parsed)) return;
            const parts: readonly unknown[] = parsed;
            const [path, index, entry] = parts;
            if (typeof path !== 'string' || typeof index !== 'number') return;
            const reference = readTimeReferences([entry], path).references[0];
            if (reference) references.set(key, { ...reference, index, key });
        });
    });
    const groupOf = (target: EventTarget | null): Element | null => target instanceof Element ? target.closest('.ert-time-reference') : null;
    const keysOf = (group: Element): string[] => {
        const parsed: unknown = JSON.parse(group.getAttribute('data-reference-keys') ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((key): key is string => typeof key === 'string') : [];
    };
    const update = (): void => {
        const lens = currentTimelineLens(), coloring = currentTimelineColoring();
        svg.querySelectorAll<SVGElement>('.ert-time-reference-connector').forEach(connector => {
            const reference = references.get(keysOf(connector)[0]);
            const value = reference ? coloring?.values.get(reference.path) : undefined;
            const slot = value === undefined ? undefined : coloring?.legend.find(entry => entry.value === value)?.colorIndex;
            connector.setCssProps({ stroke: coloring ? (slot === undefined ? 'var(--background-modifier-border-hover)' : `var(--rt-subplot-colors-${slot})`) : '' });
            connector.classList.toggle('ert-time-reference-filtered', !!reference && !!lens && !lens.paths.has(reference.path));
        });
        svg.querySelectorAll<SVGElement>('.ert-time-reference').forEach(group => {
            const candidates = keysOf(group).map(key => references.get(key)).filter((ref): ref is TimeReference => !!ref);
            const ref = candidates.find(candidate => !lens || lens.paths.has(candidate.path)) ?? candidates[0];
            group.classList.toggle('ert-time-reference-filtered', !!lens && candidates.every(candidate => !lens.paths.has(candidate.path)));
            if (!ref) return;
            const value = coloring?.values.get(ref.path);
            const slot = value === undefined ? undefined : coloring?.legend.find(entry => entry.value === value)?.colorIndex;
            const fill = coloring ? (slot === undefined ? 'var(--background-modifier-border-hover)' : `var(--rt-subplot-colors-${slot})`) : '';
            group.querySelector<SVGElement>('.ert-time-reference-slice')?.setCssProps({ fill });
        });
    };
    update();
    view.renderScope.register(onTimelineOverlayChange(update));
    view.renderScope.register(onReferenceSelection(selection => {
        svg.querySelectorAll('.rt-scene-group[data-path]').forEach(group => {
            group.classList.toggle('ert-time-reference-source', !!selection && group.getAttribute('data-path') === encodeURIComponent(selection.path));
        });
        const connectors = Array.from(svg.querySelectorAll<SVGElement>('.ert-time-reference-connector'));
        const sourceRings = selection ? connectors.filter(connector => keysOf(connector).some(key => references.get(key)?.path === selection.path))
            .map(connector => Number(connector.dataset.ring)) : [];
        const requestedRing = selection?.ring === undefined ? undefined : Number(selection.ring);
        const activeRing = requestedRing !== undefined && sourceRings.includes(requestedRing) ? requestedRing : Math.max(...sourceRings);
        connectors.forEach(connector => {
            const keys = keysOf(connector);
            const sameRing = Number(connector.dataset.ring) === activeRing;
            connector.classList.toggle('is-related', sameRing && !!selection && keys.some(key => references.get(key)?.path === selection.path));
            connector.classList.toggle('is-active', sameRing && !!selection && keys.includes(selection.key));
        });
        svg.querySelectorAll<SVGElement>('.ert-time-reference').forEach(group => group.classList.toggle('is-active', !!selection && keysOf(group).includes(selection.key)));
    }));
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (event: Event) => {
        const group = groupOf(event.target);
        if (!group) {
            const scene = event.target instanceof Element ? event.target.closest('.rt-scene-group[data-path]') : null;
            const path = scene?.getAttribute('data-path');
            if (path) {
                const sourcePath = decodeURIComponent(path);
                hoverTimeReference([...references.values()].some(ref => ref.path === sourcePath)
                    ? { path: sourcePath, key: '', ring: scene?.getAttribute('data-ring') ?? undefined } : null);
            }
            return;
        }
        const reference = references.get(keysOf(group)[0]);
        if (reference) { hoverTimeReference({ path: reference.path, key: reference.key, ring: group.getAttribute('data-ring') ?? undefined });
            markTimetableRows(reference.path, null, false); }
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (event: Event) => {
        const group = groupOf(event.target);
        if (group && !group.contains((event as PointerEvent).relatedTarget as Node | null)) hoverTimeReference(null);
        if (!group && event.target instanceof Element && event.target.closest('.rt-scene-group')
            && !event.target.closest('.rt-scene-group')?.contains((event as PointerEvent).relatedTarget as Node | null)) hoverTimeReference(null);
    });
    const activate = (group: Element, event?: MouseEvent): void => {
        const choices = keysOf(group).map(key => references.get(key)).filter((ref): ref is TimeReference => !!ref);
        const open = (reference: TimeReference): void => { pinTimeReference({ path: reference.path, key: reference.key, ring: group.getAttribute('data-ring') ?? undefined }); void openTimeReference(view.plugin, reference, group); };
        if (choices.length === 1) open(choices[0]);
        else {
            const menu = new Menu();
            choices.forEach(reference => menu.addItem(item => item.setTitle(`${reference.label} · ${reference.when.text}`).onClick(() => open(reference))));
            if (event) menu.showAtMouseEvent(event);
            else { const rect = group.getBoundingClientRect(); menu.showAtPosition({ x: rect.left, y: rect.bottom }); }
        }
    };
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (event: Event) => {
        const group = groupOf(event.target);
        if (!group) return;
        event.stopPropagation(); activate(group, event as MouseEvent);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'focusin', (event: Event) => {
        const group = groupOf(event.target);
        const reference = group ? references.get(keysOf(group)[0]) : undefined;
        if (reference) hoverTimeReference({ path: reference.path, key: reference.key, ring: group?.getAttribute('data-ring') ?? undefined });
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'focusout', (event: Event) => {
        if (groupOf(event.target)) hoverTimeReference(null);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'keydown', (event: Event) => {
        const key = (event as KeyboardEvent).key;
        const group = groupOf(event.target);
        if (group && (key === 'Enter' || key === ' ')) { event.preventDefault(); event.stopPropagation(); activate(group); }
    });
}
