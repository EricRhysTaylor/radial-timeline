import { describe, expect, it } from 'vitest';
import { getInquiryCorpusTier } from './inquiryCorpusStripSlotRenderer';

describe('draft length tiers', () => {
    const thresholds = { emptyMax: 10, sketchyMin: 100, mediumMin: 300, substantiveMin: 1000 };
    it('uses the Inquiry boundaries for scene word counts', () => {
        expect(getInquiryCorpusTier(10, thresholds)).toBe('empty');
        expect(getInquiryCorpusTier(299, thresholds)).toBe('sketchy');
        expect(getInquiryCorpusTier(300, thresholds)).toBe('medium');
        expect(getInquiryCorpusTier(999, thresholds)).toBe('medium');
        expect(getInquiryCorpusTier(1000, thresholds)).toBe('substantive');
    });
    it('honors custom boundaries', () => {
        expect(getInquiryCorpusTier(500, { ...thresholds, substantiveMin: 500 })).toBe('substantive');
    });
});
