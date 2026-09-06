import { describe, expect, it } from 'vitest';
import { renderImportedLayoutSummary } from './ImportedLayoutSummary';
import type { PandocLayoutTemplate } from '../../../types';
class ElementStub {
    children: ElementStub[] = []; text = ''; cls = '';
    createDiv(options: { text?: string; cls?: string }) { const child = new ElementStub(); child.text = options.text ?? ''; child.cls = options.cls ?? ''; this.children.push(child); return child; }
    allText(): string { return this.text + this.children.map(child => child.allText()).join(' '); }
}
describe('Imported publishing layout summary', () => {
    it('renders a generic preview and the supplied description without reading vault state', () => {
        const root = new ElementStub(); const layout: PandocLayoutTemplate = { id: 'custom', name: 'Custom', preset: 'novel', path: 'layout.tex' };
        renderImportedLayoutSummary(root as unknown as HTMLElement, layout, 'Author description');
        expect(root.allText()).toContain('Author description'); expect(root.allText()).toContain('Template Preview');
        expect(root.allText()).toContain('Custom formatting');
    });
    it.each([
        ['chaptered', 'Chapter One'], ['literary', 'Winter Light'],
        ['manuscript', 'Manuscript Page'], ['book', 'Book Page']
    ] as const)('preserves the %s preview and limits metadata to four nonempty traits', (kind, title) => {
        const root = new ElementStub();
        const layout: PandocLayoutTemplate = { id: 'custom', name: 'Custom', preset: 'novel', path: 'layout.tex',
            importDetection: { styleHint: kind, mockPreviewKind: kind, confidence: 'high',
                traits: [' Running headers ', '', 'Chapter structure', 'Font choice', 'Page spacing', 'Ignored fifth trait'] } };
        renderImportedLayoutSummary(root as unknown as HTMLElement, layout, 'Description');
        expect(root.allText()).toContain(title); expect(root.allText()).toContain('Headers');
        expect(root.allText()).not.toContain('Ignored fifth trait');
        expect(root.children[0].children[0].children).toHaveLength(5);
    });

});
