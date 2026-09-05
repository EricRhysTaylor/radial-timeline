import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('RuntimeProcessingModal progress chrome', () => {
    const sourcePath = resolve(process.cwd(), 'src/modals/RuntimeProcessingModal.ts');

    function getMethodSource(methodName: string, nextMethodName: string): string {
        const source = readFileSync(sourcePath, 'utf8');
        const start = source.indexOf(methodName);
        const end = source.indexOf(nextMethodName, start + methodName.length);
        expect(start).toBeGreaterThanOrEqual(0);
        expect(end).toBeGreaterThan(start);
        return source.slice(start, end);
    }

    it('only renders the AI prompt/context details panel for AI estimation runs', () => {
        const showProgressView = getMethodSource('private showProgressView', 'public updateProgress');
        const modeGate = showProgressView.indexOf("if (this.selectedMode === 'ai') {");
        const aiDetails = showProgressView.indexOf("createEl('details', { cls: 'ert-ai-advanced-details' })");

        expect(modeGate).toBeGreaterThanOrEqual(0);
        expect(aiDetails).toBeGreaterThan(modeGate);
    });

    it('clears any stale AI context before starting a new runtime estimation run', () => {
        const startProcessing = getMethodSource('private async startProcessing', 'private showProgressView');

        expect(startProcessing).toContain('this.aiAdvancedContext = null;');
        expect(startProcessing.indexOf('this.aiAdvancedContext = null;')).toBeLessThan(startProcessing.indexOf('this.showProgressView();'));
    });
});
