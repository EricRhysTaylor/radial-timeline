import type RadialTimelinePlugin from '../main';

export type ProEntitlementState = 'active' | 'inactive';

export interface ProEntitlement {
    state: ProEntitlementState;
    isProActive: boolean;
    hasProLicenseKey: boolean;
    isProEnabled: boolean;
}

export function isProLicenseKeyValid(key: string | undefined): boolean {
    if (!key || key.trim().length === 0) return false;
    return key.trim().length >= 16;
}

export function getProEntitlement(plugin: RadialTimelinePlugin): ProEntitlement {
    const hasProLicenseKey = isProLicenseKeyValid(plugin.settings.proLicenseKey);
    const isProEnabled = plugin.settings.proAccessEnabled !== false;
    // Pro requires a valid license key; the toggle only disables access.
    const isProActive = hasProLicenseKey && isProEnabled;
    return {
        state: isProActive ? 'active' : 'inactive',
        isProActive,
        hasProLicenseKey,
        isProEnabled
    };
}

export function isProActive(plugin: RadialTimelinePlugin): boolean {
    return getProEntitlement(plugin).isProActive;
}
