import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('Inquiry settings normalization', () => {
    it('uses InquiryCorpusService as the only class/material normalization source', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/InquirySection.ts'), 'utf8');
        expect(source.includes("from '../../inquiry/services/InquiryCorpusService'")).toBe(true);
        expect(source.includes('const normalizeMaterialMode =')).toBe(false);
        expect(source.includes('const normalizeClassContribution =')).toBe(false);
        expect(source.includes('const normalizeInquirySources =')).toBe(false);
        expect(source.includes('const getClassScopeConfig =')).toBe(false);
        expect(source.includes('const isSynopsisCapableClass =')).toBe(false);
        expect(source.includes('const normalizeContributionMode =')).toBe(false);
    });
});
