import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { setupRotationController } from './RotationController';

function fakeElement() {
    const attributes = new Map<string, string>();
    const classes = new Set<string>();
    return {
        attributes,
        classes,
        setAttribute: (name: string, value: string) => { attributes.set(name, value); },
        getAttribute: (name: string) => attributes.get(name) ?? null,
        removeAttribute: (name: string) => { attributes.delete(name); },
        classList: { add: (cls: string) => { classes.add(cls); }, remove: (cls: string) => { classes.delete(cls); } },
        closest: () => null,
    };
}

function mountRotation({ runtimeView, savedRotation }: { runtimeView: boolean; savedRotation: boolean }) {
    const parts: Record<string, ReturnType<typeof fakeElement>> = {
        '#timeline-rotatable': fakeElement(),
        '.ert-scene-foreground': fakeElement(),
        '#rotation-toggle': fakeElement(),
        '#rotation-arrow-up': fakeElement(),
        '#rotation-arrow-down': fakeElement(),
    };
    const svg = {
        ...fakeElement(),
        querySelector: (selector: string) => parts[selector] ?? null,
        querySelectorAll: () => [],
    };
    svg.setAttribute('data-segment-count', '3');
    if (runtimeView) svg.setAttribute('data-runtime-view', 'true');

    let onToggleClick: (e: Event) => void = () => {};
    const view = {
        currentMode: 'narrative',
        getRotationState: () => savedRotation,
        setRotationState: vi.fn(),
        applyRotationToNumberSquares: vi.fn(),
        renderScope: {
            register: vi.fn(),
            registerDomEvent: (_el: HTMLElement, _event: string, handler: (e: Event) => void) => { onToggleClick = handler; },
        },
    };
    setupRotationController(view, svg as unknown as SVGSVGElement); // SAFE: the controller reads only the attributes, selectors and class lists faked here

    return {
        rotatable: parts['#timeline-rotatable'],
        svg,
        view,
        clickToggle: () => onToggleClick({ stopPropagation: () => {} } as Event), // SAFE: the handler only calls stopPropagation
    };
}

describe('rotation controller', () => {
    it('applies a saved rotation in the Narrative view', () => {
        const { rotatable, svg } = mountRotation({ runtimeView: false, savedRotation: true });
        expect(rotatable.getAttribute('transform')).toBe('rotate(-120)');
        expect(svg.getAttribute('data-rotated')).toBe('true');
    });

    it('shows the runtime view unrotated and keeps the saved rotation for later', () => {
        const { rotatable, svg, view } = mountRotation({ runtimeView: true, savedRotation: true });
        expect(rotatable.getAttribute('transform')).toBeNull();
        expect(svg.getAttribute('data-rotated')).toBe('false');
        expect(view.applyRotationToNumberSquares).toHaveBeenCalledWith(svg, false);
        expect(view.setRotationState).not.toHaveBeenCalled();
    });

    it('ignores toggle clicks in the runtime view', () => {
        const { rotatable, view, clickToggle } = mountRotation({ runtimeView: true, savedRotation: false });
        clickToggle();
        expect(rotatable.getAttribute('transform')).toBeNull();
        expect(view.setRotationState).not.toHaveBeenCalled();
    });

    it('hides the toggle in the runtime view', () => {
        const css = readFileSync(resolve(process.cwd(), 'src/styles/scenes.css'), 'utf8');
        expect(css).toMatch(/\.radial-timeline-svg\[data-runtime-view="true"\] #rotation-toggle \{\s*display: none;\s*\}/);
    });
});
