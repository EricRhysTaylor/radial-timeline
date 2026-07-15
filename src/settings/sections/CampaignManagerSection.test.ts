import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('campaign Community publishing controls', () => {
    it('keeps consent, status, and the immediate send action in one setting row', () => {
        const source = readFileSync(resolve(process.cwd(), 'src/settings/sections/CampaignManagerSection.ts'), 'utf8');

        expect(source.match(/\.setName\('Send to Community'\)/g)).toHaveLength(1);
        expect(source.includes(".setName('Community APR')")).toBe(false);
        expect(source.indexOf('.addToggle((toggle)')).toBeLessThan(source.indexOf('.addButton(button => button'));
        expect(source.includes('${communityStatus}')).toBe(true);
    });
});
