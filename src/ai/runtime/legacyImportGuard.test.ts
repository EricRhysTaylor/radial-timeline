import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const LEGACY_IMPORT_RE = /from\s+['"](?:\.\.\/)+api\/(providerRouter|openaiApi|anthropicApi|geminiApi|localAiApi)['"]/g;

function walk(dir: string): string[] {
    const entries = readdirSync(dir);
    const files: string[] = [];
    for (const entry of entries) {
        const full = join(dir, entry);
        const stats = statSync(full);
        if (stats.isDirectory()) {
            files.push(...walk(full));
            continue;
        }
        if (full.endsWith('.ts') && !full.endsWith('.test.ts')) {
            files.push(full);
        }
    }
    return files;
}

function isAllowedLegacyImportPath(path: string): boolean {
    return path.includes('/src/api/')
        || path.includes('/src/ai/providers/')
        || path.includes('/src/settings/')
        || path.includes('/src/ai/');
}

describe('legacy AI API quarantine', () => {
    it('feature modules do not import legacy API modules directly', () => {
        const srcRoot = resolve(process.cwd(), 'src');
        const offenders: string[] = [];
        for (const file of walk(srcRoot)) {
            if (isAllowedLegacyImportPath(file)) continue;
            const source = readFileSync(file, 'utf8');
            if (LEGACY_IMPORT_RE.test(source)) {
                offenders.push(file.replace(`${process.cwd()}/`, ''));
            }
            LEGACY_IMPORT_RE.lastIndex = 0;
        }
        expect(offenders).toEqual([]);
    });
});

