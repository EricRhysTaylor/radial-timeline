import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Publish settings Book Pages row layout', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/PublishSection.ts'), 'utf8');
    const css = readFileSync(resolve(process.cwd(), 'src/styles/rt-ui.css'), 'utf8');

    it('keeps Book Pages title and badges inside a single responsive row cell', () => {
        expect(source).toContain("createDiv({ cls: 'ert-matter-preview-main' })");
        expect(source).toContain("main.createEl('a', {");
        expect(source).toContain("main.createSpan({ cls: 'ert-matter-preview-link'");
        expect(source).toContain("main.createDiv({ cls: 'ert-matter-preview-badges' })");
        expect(source).toContain("dMain.createDiv({ cls: 'ert-matter-preview-badges' })");
    });

    it('reserves explicit control columns instead of relying on grid auto-placement', () => {
        const rowRule = css.match(/\.ert-ui\.ert-scope--settings \.ert-matter-preview-row \{[\s\S]*?\n\}/)?.[0] ?? '';
        const mainRule = css.match(/\.ert-ui\.ert-scope--settings \.ert-matter-preview-main \{[\s\S]*?\n\}/)?.[0] ?? '';
        const publishingMobileStart = css.indexOf(
            '@media (max-width: 720px)',
            css.indexOf('.ert-ui.ert-scope--settings .ert-bookmeta-source-link:hover')
        );
        const publishingMobileCss = css.slice(publishingMobileStart, publishingMobileStart + 1600);
        const mobileRowRule = publishingMobileCss.match(/\.ert-ui\.ert-scope--settings \.ert-matter-preview-row \{[\s\S]*?\n  \}/)?.[0] ?? '';

        expect(rowRule).toContain('grid-template-columns: auto auto minmax(0, 1fr);');
        expect(mainRule).toContain('grid-template-columns: minmax(0, 1fr) auto;');
        expect(mobileRowRule).toContain('grid-template-columns: auto auto minmax(0, 1fr);');
        expect(mobileRowRule).not.toContain('grid-template-columns: 1fr;');
    });
});
