import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Import steps keep their actions in view. Confirm scenes once put Continue
 * below the fold at 1920×1080 and 110%: the dialog grew past the window and
 * scrolled as a whole. It now stops at the window's height and the scene
 * list scrolls inside it.
 */
describe('import dialog layout', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modals/OnboardingModal.ts'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/features/onboarding.css'), 'utf8');
    const block = (selector: string): string => {
        const start = css.indexOf(`${selector} {`);
        expect(start, selector).toBeGreaterThanOrEqual(0);
        return css.slice(start, css.indexOf('}', start));
    };

    it('stops the dialog at the window height', () => {
        expect(source).toContain("modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell', 'ert-modal--onboarding');");
        expect(source).toContain("maxHeight: '92vh'");
        expect(block('.ert-ui.ert-modal--onboarding.modal')).toContain('overflow: hidden');
    });

    /*
     * Each step is a different height. Centered, the dialog re-centered at
     * every step, so its header jumped up and down the window (Vol 14 capture,
     * November 7): it now holds its top edge, and a working message keeps the
     * step's header instead of dropping the dialog to one line.
     */
    it('holds its top edge between steps', () => {
        expect(source).toContain("modalEl.setCssStyles({ width: '832px', maxWidth: '94vw', maxHeight: '92vh', alignSelf: 'flex-start', marginTop: '4vh' });");
        const busy = source.slice(source.indexOf('private renderBusy('), source.indexOf('private renderMessage('));
        expect(busy).toContain(".ert-onb-topbar, .ert-onb-stage, .ert-modal-header");
        expect(busy).not.toContain('contentEl.empty()');
    });

    it('lets only the scene list give up height, so the actions stay in view', () => {
        const container = block('.ert-ui.ert-modal--onboarding .ert-modal-container');
        expect(container).toContain('min-height: 0');
        expect(container).toContain('overflow-y: auto');
        expect(block('.ert-ui.ert-modal--onboarding .ert-onb-list')).toContain('flex: 1 1 auto');
        expect(block('.ert-ui.ert-modal--onboarding .ert-modal-container > :not(.ert-onb-list)')).toContain('flex-shrink: 0');
    });
});
