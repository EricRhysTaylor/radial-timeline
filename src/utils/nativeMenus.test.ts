import { describe, expect, it } from 'vitest';
import { Platform } from 'obsidian';
import { logoMenuTitle, usesNativeMenus } from './nativeMenus';

const app = (value: unknown) => ({ vault: { getConfig: (key: string) => (key === 'nativeMenus' ? value : undefined) } }) as never;

function onPlatform(desktop: boolean, mac: boolean, run: () => void): void {
    const platform = Platform as unknown as { isDesktopApp?: boolean; isMacOS?: boolean };
    const was = { desktop: platform.isDesktopApp, mac: platform.isMacOS };
    try {
        platform.isDesktopApp = desktop;
        platform.isMacOS = mac;
        run();
    } finally {
        platform.isDesktopApp = was.desktop;
        platform.isMacOS = was.mac;
    }
}

describe('native menus', () => {
    it('reads Obsidian\'s Native menus setting on desktop only, unset meaning on for macOS', () => {
        onPlatform(true, false, () => {
            expect(usesNativeMenus(app(true))).toBe(true);
            expect(usesNativeMenus(app(false))).toBe(false);
            expect(usesNativeMenus(app(null))).toBe(false);
            expect(usesNativeMenus({ vault: {} } as never)).toBe(false);
        });
        onPlatform(true, true, () => {
            expect(usesNativeMenus(app(null))).toBe(true);
            expect(usesNativeMenus(app(false))).toBe(false);
        });
        onPlatform(false, false, () => expect(usesNativeMenus(app(true))).toBe(false));
    });

    it('names Radial Timeline only where the menu cannot show its logo', () => {
        onPlatform(true, true, () => {
            expect(logoMenuTitle(app(null), 'Time references…')).toBe('Radial Timeline: Time references…');
            expect(logoMenuTitle(app(false), 'Time references…')).toBe('Time references…');
        });
        onPlatform(true, false, () => expect(logoMenuTitle(app(null), 'Export to PDF, Word, Markdown')).toBe('Export to PDF, Word, Markdown'));
    });
});
