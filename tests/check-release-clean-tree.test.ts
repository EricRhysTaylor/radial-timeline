import { describe, expect, it } from 'vitest';
import { unrelatedChanges } from '../scripts/check-release-clean-tree.mjs';

const z = (...entries: string[]) => `${entries.join('\0')}\0`;

describe('release stops on uncommitted files it would sweep up', () => {
    it('a clean tree passes', () => {
        expect(unrelatedChanges('')).toEqual([]);
    });

    it('release-notes drafts are part of the release', () => {
        expect(unrelatedChanges(z(' M docs/releases/draft-for-release-8.2.2.md', '?? docs/releases/draft-for-release-8.3.0.md'))).toEqual([]);
    });

    it('names modified, new and staged files the release would commit', () => {
        const found = unrelatedChanges(z(' M src/demoVaults/demoImportPlan.ts', '?? scripts/new.mjs', 'A  src/added.ts'));
        expect(found.map(f => f.path)).toEqual(['src/demoVaults/demoImportPlan.ts', 'scripts/new.mjs', 'src/added.ts']);
    });

    it('a rename reports its new path once, not its old path as a file of its own', () => {
        const found = unrelatedChanges(z('R  src/new-name.ts', 'src/old-name.ts', ' M README.md'));
        expect(found.map(f => f.path)).toEqual(['src/new-name.ts', 'README.md']);
    });

    it('a file elsewhere in docs/releases is not a notes draft', () => {
        expect(unrelatedChanges(z(' M docs/releases/README.md')).map(f => f.path)).toEqual(['docs/releases/README.md']);
    });
});
