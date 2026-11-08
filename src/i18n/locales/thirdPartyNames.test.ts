import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { de } from './de';
import { ja } from './ja';
import { ko } from './ko';
import { zh } from './zh';
import { es } from './es';
import { fr } from './fr';
import { th } from './th';
import { vi } from './vi';

/*
 * Public copy names only Obsidian's own features (File recovery, Sync),
 * iCloud, Radial Timeline and Editorialist: never a third-party plugin.
 */

type Tree = { [key: string]: unknown };

function strings(node: Tree, prefix = '', out: Array<[string, string]> = []): Array<[string, string]> {
    for (const [key, value] of Object.entries(node)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (typeof value === 'string') out.push([path, value]);
        else if (value && typeof value === 'object') strings(value as Tree, path, out);
    }
    return out;
}

const THIRD_PARTY_PLUGINS = /obsidian[\s-]?git|dataview|templater|excalidraw|quickadd|meta\s?bind|omnisearch|smart connections|remotely save|livesync|style settings|periodic notes/i;
const locales = { en, de, ja, ko, zh, es, fr, th, vi } as unknown as Record<string, Tree>;

describe.each(Object.keys(locales))('%s copy', locale => {
    it('names no third-party Obsidian plugin', () => {
        const offenders = strings(locales[locale]).filter(([, value]) => THIRD_PARTY_PLUGINS.test(value)).map(([path]) => path);
        expect(offenders).toEqual([]);
    });

    it('gives the Welcome backup notice exactly the links the Welcome screen supplies', () => {
        const welcome = strings(locales[locale]).find(([path]) => path === 'ui.welcomeScreen.backupNotice');
        expect(welcome).toBeDefined();
        expect(welcome![1].match(/\[[^\]]+\]/g)).toHaveLength(2);
        expect(welcome![1]).toContain('iCloud');
    });
});

it('links the Welcome backup notice only to Obsidian', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/view/WelcomeScreen.ts'), 'utf8');
    const call = source.slice(source.indexOf('appendTextWithLinks(backupPara'));
    const hrefs = call.slice(0, call.indexOf(']);')).match(/https:\/\/[^'"]+/g);
    expect(hrefs).toEqual(['https://help.obsidian.md/backup', 'https://obsidian.md/sync']);
});
