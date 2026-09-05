import { describe, expect, it } from 'vitest';
import { computeAprLayout } from './aprLayout';
import { getAprPreset, getExportPreset } from './aprPresets';

describe('APR layout pattern density', () => {
    it('keeps Social preview Working patterns visible at 450px', () => {
        const layout = computeAprLayout(getAprPreset('large'));

        expect(layout.outerPx).toBe(450);
        expect(layout.patternScale).toBeCloseTo(0.375);
    });

    it('scales export pattern density with output size', () => {
        const preview = computeAprLayout(getAprPreset('large'));
        const exportLayout = computeAprLayout(getExportPreset('large', 'standard'));

        expect(exportLayout.outerPx).toBe(1200);
        expect(exportLayout.patternScale).toBeCloseTo(preview.patternScale * (1200 / 450));
    });
});
