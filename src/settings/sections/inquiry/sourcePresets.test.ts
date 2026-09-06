import { describe, expect, it } from 'vitest';
import { buildPresetClassConfig } from './sourcePresets';
import type { InquiryClassConfig } from '../../../types/settings';
const config = (className: string): InquiryClassConfig => ({ className, enabled: true, bookScope: 'full', sagaScope: 'full', referenceScope: 'full' });
describe('Inquiry source presets', () => {
    it('preserves canonical full-text normalization for the default scene preset', () => {
        expect(buildPresetClassConfig(config('Scene'), 'default')).toMatchObject({ bookScope: 'full', sagaScope: 'full', referenceScope: 'excluded', enabled: true });
    });
    it.each(['Scene', 'Outline'])('uses summary material for %s in Light and full material in Deep', name => {
        expect(buildPresetClassConfig(config(name), 'light')).toMatchObject({ bookScope: 'summary', sagaScope: 'summary' });
        expect(buildPresetClassConfig(config(name), 'deep')).toMatchObject({ bookScope: 'full', sagaScope: 'full' });
    });
    it('includes reference classes only in Deep and leaves the original config untouched', () => {
        const original = config('Research'); const before = { ...original };
        expect(buildPresetClassConfig(original, 'default')).toMatchObject({ enabled: false, referenceScope: 'excluded' });
        expect(buildPresetClassConfig(original, 'deep')).toMatchObject({ enabled: true, referenceScope: 'full', bookScope: 'excluded', sagaScope: 'excluded' });
        expect(original).toEqual(before);
    });
});
