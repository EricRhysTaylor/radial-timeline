import type { RadialTimelineView } from '../../view/TimeLineView';
import { currentTimelineColoring, currentTimelineLens, onTimelineOverlayChange } from '../../timetable/timetableRegistry';
import { getActivePlanetaryProfile } from '../../utils/planetaryTime';
import { openTimeReference } from './editor';
import { onReferenceSelection, hoverTimeReference, pinTimeReference, currentReferenceSelection, type ReferenceSelection } from './selection';
import { readTimeReferences, type TimeReference } from './model';
import { ReferencePopover, referencePopoverContent } from './popover';

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
        // Outside the lens, or (while names are picked in the color key) a scene that doesn't list them all.
        const picking = !!coloring && coloring.picks.length > 0;
        const outside = (path: string): boolean => (!!lens && !lens.paths.has(path)) || (picking && !coloring.values.has(path));
        // References draw in the theme's text color in every coloring, so a lens or a pick only filters them.
        svg.querySelectorAll<SVGElement>('.ert-time-reference-connector').forEach(connector => {
            const reference = references.get(keysOf(connector)[0]);
            connector.classList.toggle('ert-time-reference-filtered', !!reference && outside(reference.path));
        });
        svg.querySelectorAll<SVGElement>('.ert-time-reference, .ert-time-reference-origin').forEach(group => {
            const candidates = keysOf(group).map(key => references.get(key)).filter((ref): ref is TimeReference => !!ref);
            group.classList.toggle('ert-time-reference-filtered', (!!lens || picking) && candidates.every(candidate => outside(candidate.path)));
        });
    };
    // Keep overflow beside its date label in the inner text lane. Measure the
    // actual font so counts never climb the stack into the scene-title radius.
    const positionOverflowCounts = (): void => {
        svg.querySelectorAll<SVGGElement>('.ert-time-reference[data-reference-overflow]').forEach(group => {
            const count = group.querySelector<SVGTextElement>('.ert-time-reference-count')!;
            const slot = group.dataset.referenceSlot;
            const labelGroup = Array.from(svg.querySelectorAll<SVGGElement>('.ert-time-reference'))
                .find(candidate => candidate.dataset.referenceSlot === slot && candidate.querySelector('.ert-time-reference-label'));
            const label = labelGroup?.querySelector<SVGTextElement>('.ert-time-reference-range');
            const radius = Math.hypot(Number(group.dataset.referenceX), Number(group.dataset.referenceY));
            let rotation = 0;
            if (label && group.dataset.extent === 'earlier') {
                labelGroup!.querySelector('.ert-time-reference-label')!
                    .setAttribute('transform', `rotate(${-(count.getComputedTextLength() + 12) / radius * 180 / Math.PI})`);
            } else if (label) {
                rotation = (label.getComputedTextLength() + 12) / radius;
                group.setAttribute('transform', `rotate(${rotation * 180 / Math.PI})`);
            }
            const bounds = count.getBBox(), x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
            const hit = group.querySelector('.ert-time-reference-hit')!;
            hit.setAttribute('x', String(x - 10)); hit.setAttribute('y', String(y - 10));
            group.dataset.referenceX = String(x * Math.cos(rotation) - y * Math.sin(rotation));
            group.dataset.referenceY = String(x * Math.sin(rotation) + y * Math.cos(rotation));
        });
    };
    update();
    view.renderScope.register(onTimelineOverlayChange(update));
    const applySelection = (selection: ReferenceSelection | null): void => {
        svg.classList.toggle('ert-has-reference-selection', !!selection && references.has(selection.key));
        svg.querySelectorAll('.ert-time-reference-origin[data-source-path]').forEach(group => {
            group.classList.toggle('is-active', !!selection && group.getAttribute('data-source-path') === encodeURIComponent(selection.path));
        });
        const markers = Array.from(svg.querySelectorAll<SVGElement>('.ert-time-reference'));
        const selected = markers.find(group => !!selection && keysOf(group).includes(selection.key));
        svg.querySelectorAll<SVGElement>('.ert-time-reference-connector').forEach(connector => {
            const active = !!selection && keysOf(connector).includes(selection.key);
            connector.classList.toggle('is-active', active);
            if (active && selected && !connector.classList.contains('ert-time-reference-break')) {
                // Same-date stacks share a route; its last leg follows the selected passage marker.
                connector.setAttribute('d', connector.getAttribute('d')!.replace(/ L [^L]+$/, ` L ${selected.dataset.referenceX} ${selected.dataset.referenceY}`));
            }
        });
        markers.forEach(group => {
            group.classList.toggle('is-active', group === selected);
            group.classList.toggle('is-date-active', !!selected && group.dataset.referenceSlot === selected.dataset.referenceSlot);
        });
    };
    view.renderScope.register(onReferenceSelection(applySelection));
    // The view attaches its fragment after interaction setup. Measure only once
    // that SVG is attached, then refresh a selection that may target a count.
    const win = svg.ownerDocument.defaultView!;
    const countFrame = win.requestAnimationFrame(() => {
        positionOverflowCounts();
        applySelection(currentReferenceSelection());
    });
    view.renderScope.register(() => win.cancelAnimationFrame(countFrame));
    // The marker's popover: the references it holds, readable, beside the marker on the side away from the center.
    const doc = svg.ownerDocument;
    const popover = new ReferencePopover(doc);
    view.renderScope.register(() => popover.hide());
    const choicesOf = (group: Element): TimeReference[] => keysOf(group).map(key => references.get(key)).filter((ref): ref is TimeReference => !!ref);
    const sourceTitle = (path: string): string => Array.from(svg.querySelectorAll('.ert-time-reference-origin'))
        .find(origin => origin.getAttribute('data-source-path') === encodeURIComponent(path))?.querySelector('desc')?.textContent ?? '';
    const showPopover = (group: Element, choose?: (reference: TimeReference) => void): void => {
        const choices = choicesOf(group);
        if (!choices.length) return;
        const content = referencePopoverContent(group.getAttribute('data-extent') ?? undefined,
            choices.map(reference => ({ reference, source: sourceTitle(reference.path) })),
            { clipped: group.hasAttribute('data-clipped'), planetCalendar: !!getActivePlanetaryProfile(view.plugin.settings) });
        // The timeline's center on screen, and its reach: the drawing fills the shorter side of the SVG.
        const box = svg.getBoundingClientRect();
        popover.show(content, group, { x: box.left + box.width / 2, y: box.top + box.height / 2 }, Math.min(box.width, box.height) / 2, choose);
    };
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerover', (event: Event) => {
        const group = groupOf(event.target);
        if (!group) return;
        const reference = references.get(keysOf(group)[0]);
        if (reference) hoverTimeReference({ path: reference.path, key: reference.key });
        if (!popover.pinned) showPopover(group);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'pointerout', (event: Event) => {
        const group = groupOf(event.target);
        if (!group || group.contains((event as PointerEvent).relatedTarget as Node | null)) return;
        hoverTimeReference(null);
        if (!popover.pinned) popover.hide();
    });
    const activate = (group: Element): void => {
        const choices = choicesOf(group);
        const open = (reference: TimeReference): void => { pinTimeReference({ path: reference.path, key: reference.key }); void openTimeReference(view.plugin, reference, group); };
        if (choices.length === 1) { popover.hide(); open(choices[0]); }
        // A group's references, to choose one: the same popover, with each reference a button.
        else showPopover(group, open);
    };
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'click', (event: Event) => {
        const group = groupOf(event.target);
        if (!group) { hoverTimeReference(null); pinTimeReference(null); popover.hide(); return; }
        event.stopPropagation(); activate(group);
    });
    view.renderScope.registerDomEvent(doc as unknown as HTMLElement, 'pointerdown', (event: Event) => {
        if (popover.pinned && !popover.contains(event.target) && !groupOf(event.target)) popover.hide();
    });
    view.renderScope.registerDomEvent(doc as unknown as HTMLElement, 'keydown', (event: Event) => {
        if ((event as KeyboardEvent).key === 'Escape' && popover.pinned) popover.hide();
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'wheel', () => popover.hide());
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'focusin', (event: Event) => {
        const group = groupOf(event.target);
        const reference = group ? references.get(keysOf(group)[0]) : undefined;
        if (reference) hoverTimeReference({ path: reference.path, key: reference.key });
        if (group && !popover.pinned) showPopover(group);
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'focusout', (event: Event) => {
        if (!groupOf(event.target)) return;
        hoverTimeReference(null);
        if (!popover.pinned) popover.hide();
    });
    view.renderScope.registerDomEvent(svg as unknown as HTMLElement, 'keydown', (event: Event) => {
        const key = (event as KeyboardEvent).key;
        const group = groupOf(event.target);
        if (group && (key === 'Enter' || key === ' ')) { event.preventDefault(); event.stopPropagation(); activate(group); }
    });
}
