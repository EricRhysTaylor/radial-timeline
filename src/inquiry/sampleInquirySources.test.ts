import { describe, expect, it } from 'vitest';
import { initializeSampleInquirySources } from './sampleInquirySources';
import type { RadialTimelineSettings } from '../types/settings';

describe('fresh-demo Inquiry source setup', () => {
    it('initializes an empty source configuration without enabling AI', () => {
        const settings = { enableAiSceneAnalysis: false, inquirySources: { classes: [], classScope: [], scanRoots: [] } } as unknown as RadialTimelineSettings;
        initializeSampleInquirySources(settings);
        expect(settings.enableAiSceneAnalysis).toBe(false);
        expect(settings.inquirySources?.classScope).toContain('/');
        expect(settings.inquirySources?.classes?.map(item => item.className)).toEqual(['scene', 'outline']);
    });
    it('preserves existing class choices, scan roots and reference settings', () => {
        const sources = { classes: [{ className: 'scene', enabled: false }], classScope: ['outline'], scanRoots: ['Author'], preset: 'custom' };
        const settings = { inquirySources: sources } as unknown as RadialTimelineSettings;
        initializeSampleInquirySources(settings);
        expect(settings.inquirySources).toBe(sources);
    });
});
