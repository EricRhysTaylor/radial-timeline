import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('release notes packaging', () => {
    it.each([true, false])('embeds permanent tag links when isDraft=%s', (isDraft) => {
        const source = readFileSync(new URL('../sync-release-notes.mjs', import.meta.url), 'utf8')
            .replace(/^import .*;\r?\n/gm, '');
        let output = '';

        runInNewContext(source, {
            execSync: (command: string) => {
                if (command === 'gh release list --limit 50') {
                    return '7.6.1\tLatest\t7.6.1\n7.0.0\t\t7.0.0';
                }
                if (command.startsWith('gh release view ')) {
                    return JSON.stringify({
                        name: 'Release notes', body: 'Fixes', isDraft,
                        publishedAt: '2026-10-18T00:00:00Z',
                        url: 'https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/untagged-temporary'
                    });
                }
                throw new Error(`Unexpected command: ${command}`);
            },
            existsSync: () => false,
            writeFileSync: (_path: string, contents: string) => { output = contents; },
            console: { log() {}, warn() {}, error() {} },
            process: { exit: (code: number) => { throw new Error(`Script exited: ${code}`); } }
        });

        const bundle = JSON.parse(output);
        expect(bundle.latest.url).toBe('https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/7.6.1');
        expect(bundle.major.url).toBe('https://github.com/EricRhysTaylor/Radial-Timeline/releases/tag/7.0.0');
        expect(bundle.latest.isDraft).toBe(isDraft);
        expect(bundle.entries.every((entry: { url: string }) => !entry.url.includes('untagged-'))).toBe(true);
    });
});
