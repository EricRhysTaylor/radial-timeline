import { describe, expect, it, vi } from 'vitest';
import { TooltipElement } from '../../tests/mocks/tooltipDom';
import { setAccessibleLabel, setTooltip, withAccessibleLabel, withTooltip } from './domTooltip';

vi.mock('obsidian', () => ({
    setTooltip: (element: HTMLElement, text: string) => element.setAttribute('aria-label', text)
}));
function fixture() {
    const parent = new TooltipElement();
    const button = parent.appendChild(new TooltipElement());
    return { parent, button, element: button as unknown as HTMLElement };
}

describe('single HTML tooltip ownership', () => {
    it('keeps icon names accessible without a browser or Obsidian hover label', () => {
        const { parent, element } = fixture();
        element.setAttribute('title', 'Rename'); element.setAttribute('aria-label', 'Rename');
        setAccessibleLabel(element, 'Rename');
        expect(element.hasAttribute('title')).toBe(false);
        expect(element.hasAttribute('aria-label')).toBe(false);
        const name = parent.children.find(child => child.id === element.getAttribute('aria-labelledby'));
        expect(name?.textContent).toBe('Rename'); expect(name?.hasAttribute('hidden')).toBe(true);
    });
    it('reuses the name through repeated updates and icon replacement', () => {
        const { parent, button, element } = fixture();
        for (let i = 0; i < 20; i++) { button.children = []; setAccessibleLabel(element, `State ${i}`); }
        expect(parent.children).toHaveLength(2);
        expect(parent.children[1].textContent).toBe('State 19');
    });
    it('names void inputs through a sibling in the same document', () => {
        const { button, element } = fixture();
        setAccessibleLabel(element, 'Folder');
        expect(button.children).toHaveLength(0); expect(element.getAttribute('aria-labelledby')).toBeTruthy();
    });
    it('removes hover help that repeats visible text, ignoring punctuation and whitespace', () => {
        const { button, element } = fixture();
        const text = new TooltipElement(); text.nodeType = 3; text.textContent = 'Save…'; button.appendChild(text);
        setTooltip(element, '  Save  ');
        expect(element.hasAttribute('aria-label')).toBe(false);
    });
    it('excludes hidden names from visible-text comparisons', () => {
        const { button, element } = fixture();
        const text = new TooltipElement(); text.nodeType = 3; text.textContent = 'Save'; button.appendChild(text);
        setAccessibleLabel(element, 'Save current file');
        setTooltip(element, 'Save'); expect(element.hasAttribute('aria-label')).toBe(false);
    });
    it('retains explanatory help and removes the competing native and custom renderers', () => {
        const { element } = fixture();
        element.setAttribute('title', 'Old'); element.setAttribute('data-tooltip', 'Old'); element.setAttribute('data-rt-tip', 'Old');
        setTooltip(element, 'Removes the profile. Files are preserved.');
        expect(element.getAttribute('aria-label')).toBe('Removes the profile. Files are preserved.');
        for (const attr of ['title', 'data-tooltip', 'data-rt-tip']) expect(element.hasAttribute(attr)).toBe(false);
    });
    it('keeps separately authored help when the accessible name changes, then clears it explicitly', () => {
        const { element } = fixture();
        setTooltip(element, 'Review timing conflicts.'); setAccessibleLabel(element, 'Scene time');
        expect(element.getAttribute('aria-label')).toBe('Review timing conflicts.');
        setTooltip(element, ''); setAccessibleLabel(element, 'New state');
        expect(element.hasAttribute('aria-label')).toBe(false);
    });
    it.each(['buttonEl', 'extraSettingsEl', 'toggleEl'] as const)('preserves component chaining for %s', key => {
        const { element } = fixture();
        // SAFE: exercise the exact public element slot without constructing an Obsidian component.
        const component = { [key]: element } as unknown as import('obsidian').ButtonComponent;
        expect(withAccessibleLabel(component, 'Settings')).toBe(component);
        expect(withTooltip(component, 'Only affects future exports.')).toBe(component);
        expect(element.getAttribute('aria-label')).toBe('Only affects future exports.');
    });
    it('uses an SVG description and labelledby without triggering Obsidian or browser hover', () => {
        const { button } = fixture(); button.namespaceURI = 'http://www.w3.org/2000/svg';
        const element = button as unknown as SVGElement;
        setAccessibleLabel(element, 'Rotate timeline');
        expect(button.children[0].namespaceURI).toBe(button.namespaceURI);
        expect(button.children[0].hasAttribute('hidden')).toBe(false);
        expect(element.hasAttribute('aria-label')).toBe(false); expect(element.hasAttribute('title')).toBe(false);
        expect(element.getAttribute('aria-labelledby')).toBe(button.children[0].id);
    });
});

it('does not count nested hidden labels or SVG icon descriptions as visible button text', () => {
    const { button, element } = fixture();
    const content = button.appendChild(new TooltipElement());
    const text = content.appendChild(new TooltipElement()); text.nodeType = 3; text.textContent = 'Save';
    const hidden = content.appendChild(new TooltipElement()); hidden.setAttribute('hidden', ''); hidden.textContent = 'Other label';
    const icon = content.appendChild(new TooltipElement()); icon.namespaceURI = 'http://www.w3.org/2000/svg'; icon.textContent = 'Save icon';
    setTooltip(element, 'Save'); expect(element.hasAttribute('aria-label')).toBe(false);
});
