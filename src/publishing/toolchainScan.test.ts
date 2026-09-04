import { describe, expect, it, vi } from 'vitest';

const executables = new Set<string>();
vi.mock('fs', () => ({
    accessSync: (p: string) => {
        if (!executables.has(p)) throw new Error('ENOENT');
    },
    constants: { X_OK: 1 }
}));

import { isPandocPathValid } from './toolchainScan';

describe('isPandocPathValid', () => {
    it('rejects an empty or whitespace-only value', () => {
        expect(isPandocPathValid(undefined)).toBe(false);
        expect(isPandocPathValid('')).toBe(false);
        expect(isPandocPathValid('   ')).toBe(false);
    });

    it('accepts an absolute path only when it is an executable file', () => {
        executables.add('/opt/homebrew/bin/pandoc');
        expect(isPandocPathValid('/opt/homebrew/bin/pandoc')).toBe(true);
        expect(isPandocPathValid('/usr/local/bin/pandoc')).toBe(false);
        executables.clear();
    });

    it('accepts a Windows drive path the same way', () => {
        executables.add('C:\\Program Files\\Pandoc\\pandoc.exe');
        expect(isPandocPathValid('C:\\Program Files\\Pandoc\\pandoc.exe')).toBe(true);
        expect(isPandocPathValid('D:\\nowhere\\pandoc.exe')).toBe(false);
        executables.clear();
    });

    it('accepts a bare command name, which resolves through PATH at run time', () => {
        expect(isPandocPathValid('pandoc')).toBe(true);
        expect(isPandocPathValid(' pandoc ')).toBe(true);
    });

    it('rejects a relative path with separators, which nothing resolves', () => {
        expect(isPandocPathValid('bin/pandoc')).toBe(false);
        expect(isPandocPathValid('tools\\pandoc.exe')).toBe(false);
    });
});
