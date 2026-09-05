import type { RadialTimelineSettings } from '../types';
import { isProLicenseKeyValid } from './proEntitlement';

export const DEFAULT_PRO_OPEN_BETA_KEY = 'RT-PRO-OPEN-BETA';

export function seedProEntitlement(settings: RadialTimelineSettings): boolean {
    let changed = false;

    if (!isProLicenseKeyValid(settings.proLicenseKey)) {
        settings.proLicenseKey = DEFAULT_PRO_OPEN_BETA_KEY;
        changed = true;
    }

    // Recovery guard. The Pro switch is currently hidden in Settings → Pro, so a
    // vault that stored proAccessEnabled: false has no way back — every Pro
    // workflow stays quiet with no visible control to restore it. While the
    // switch is hidden, force the flag on at load.
    // Remove this block if the toggle is ever unhidden, or it will fight the user.
    if (settings.proAccessEnabled === false) {
        settings.proAccessEnabled = true;
        changed = true;
    }

    return changed;
}
