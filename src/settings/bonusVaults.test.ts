import { describe, expect, it } from 'vitest';
import { BONUS_VAULTS } from './bonusVaults';

describe('Classic Collection page links', () => {
    it('go through registered, counted /go/ links rather than a site path that can move', () => {
        const links = BONUS_VAULTS.filter(vault => vault.status === 'available').map(vault => vault.pageUrl);
        expect(links).toEqual([
            'https://community.radialtimeline.com/go/rt-settings-classic-pride',
            'https://community.radialtimeline.com/go/rt-settings-classic-odyssey',
            'https://community.radialtimeline.com/go/rt-settings-classic-sherlock',
        ]);
    });
});
