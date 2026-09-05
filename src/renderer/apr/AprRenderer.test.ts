import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '../../settings/defaults';
import type { TimelineItem } from '../../types';
import { computeAprLayout } from './aprLayout';
import { createAprSVG } from './AprRenderer';
import { getExportPreset } from './aprPresets';

describe('APR renderer', () => {
    it('renders Ring-stage export outer border at the same thickness as the inner stage ring', () => {
        const exportPreset = getExportPreset('large', 'standard');
        const layout = computeAprLayout(exportPreset);
        const scenes: TimelineItem[] = [
            {
                title: 'Working Scene',
                status: 'Working',
                'Publish Stage': 'Author',
                act: 1,
                actNumber: 1,
                subplot: 'Main Plot',
            } as TimelineItem,
        ];

        const { svgString } = createAprSVG(scenes, {
            size: 'large',
            exportPreset,
            bookTitle: 'Book',
            progressPercent: 25,
            showScenes: false,
            showProgressPercent: false,
            showBranding: false,
            stageColors: DEFAULT_SETTINGS.publishStageColors,
            publishStageLabel: 'Author',
            portableSvg: true,
        });

        const outerBorder = svgString.match(new RegExp(`<circle cx="0" cy="0" r="${layout.ringOuterR}"[^>]*stroke-width="([^"]+)"`));
        const innerStageRing = svgString.match(new RegExp(`<circle cx="0" cy="0" r="${layout.ringInnerR}" fill="[^"]+" stroke="[^"]+" stroke-width="([^"]+)"`));

        expect(outerBorder?.[1]).toBe(String(layout.strokes.centerRing));
        expect(innerStageRing?.[1]).toBe(String(layout.strokes.centerRing));
    });
});
