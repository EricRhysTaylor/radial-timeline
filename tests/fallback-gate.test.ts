import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs: string[] = [];
const SCRIPT = path.resolve(process.cwd(), 'scripts/fallback-gate.mjs');

async function createTempWorkspace() {
    const dir = await mkdtemp(path.join(tmpdir(), 'rt-fallback-gate-'));
    tempDirs.push(dir);
    await mkdir(path.join(dir, 'src'), { recursive: true });
    await mkdir(path.join(dir, 'scripts'), { recursive: true });
    return dir;
}

async function writeSource(workspace: string, relativePath: string, content: string) {
    const full = path.join(workspace, 'src', relativePath);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, content, 'utf8');
}

function runGate(workspace: string, args: string[] = []): { code: number; stdout: string; stderr: string } {
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: workspace,
        encoding: 'utf8',
    });
    return {
        code: result.status ?? -1,
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
    };
}

function parseSummary(stdout: string): { total: number; byRule: Record<string, number> } {
    const totalMatch = stdout.match(/^- total: (\d+)/m);
    const total = totalMatch ? Number(totalMatch[1]) : NaN;
    const byRule: Record<string, number> = {};
    const ruleRe = /^ {2}- ([a-z0-9-]+): (\d+)/gm;
    let m: RegExpExecArray | null;
    while ((m = ruleRe.exec(stdout)) !== null) {
        byRule[m[1]] = Number(m[2]);
    }
    return { total, byRule };
}

afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

describe('fallback-gate scanner', () => {
    it('counts silent-catch with empty return', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function f(x: string) {
                try { return JSON.parse(x); } catch { return ''; }
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        expect(r.code).toBe(0);
        const s = parseSummary(r.stdout);
        expect(s.byRule['silent-catch']).toBe(1);
    });

    it('exempts silent-catch when // SAFE: annotation is on the catch line', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function f(x: string) {
                try { return JSON.parse(x); } catch { return ''; } // SAFE: malformed input flows to default
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['silent-catch']).toBe(0);
    });

    it('does not match a catch that rethrows or logs', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function f(x: string) {
                try { return JSON.parse(x); } catch (e) { console.error(e); throw e; }
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['silent-catch']).toBe(0);
    });

    it('matches or-chain-3 with three OR operators', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function name(a: unknown, b: unknown, c: unknown, d: unknown) {
                return a || b || c || d;
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['or-chain-3']).toBe(1);
    });

    it('does not match a 2-OR chain', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function name(a: unknown, b: unknown, c: unknown) {
                return a || b;
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['or-chain-3']).toBe(0);
    });

    it('matches nullish-literal `?? "default"`', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export const title = (x: string | undefined) => x ?? 'Untitled';
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['nullish-literal']).toBeGreaterThanOrEqual(1);
    });

    it('does not match nullish with variable RHS', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export const title = (x: string | undefined, fallback: string) => x ?? fallback;
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['nullish-literal']).toBe(0);
    });

    it('exempts nullish-literal with // SAFE: annotation', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export const title = (x: string | undefined) => x ?? 'Untitled'; // SAFE: UX default
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['nullish-literal']).toBe(0);
    });

    it('matches switch-default-return when no assertNever/throw precedes', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export function pick(x: 'a' | 'b'): string {
                switch (x) {
                    case 'a': return 'A';
                    case 'b': return 'B';
                    default: return 'X';
                }
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['switch-default-return']).toBe(1);
    });

    it('does not match switch-default when default uses assertNever', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            declare function assertNever(x: never): never;
            export function pick(x: 'a' | 'b'): string {
                switch (x) {
                    case 'a': return 'A';
                    case 'b': return 'B';
                    default:
                        return assertNever(x);
                }
            }
        `);
        const r = runGate(ws, ['--report', '--quiet']);
        const s = parseSummary(r.stdout);
        expect(s.byRule['switch-default-return']).toBe(0);
    });

    it('--maintenance fails when current > baseline', async () => {
        const ws = await createTempWorkspace();
        // baseline says 0 nullish-literals
        await writeFile(
            path.join(ws, 'scripts/fallback-baseline.json'),
            JSON.stringify({
                maintenance: {
                    totalWarnings: 0,
                    warningsByRule: {
                        'silent-catch': 0,
                        'or-chain-3': 0,
                        'nullish-literal': 0,
                        'or-literal': 0,
                        'switch-default-return': 0,
                    },
                    updatedAt: new Date().toISOString(),
                    mode: 'maintenance',
                },
            }),
            'utf8',
        );
        // but the source has one
        await writeSource(ws, 'a.ts', `
            export const title = (x: string | undefined) => x ?? 'Untitled';
        `);
        const r = runGate(ws, ['--maintenance']);
        expect(r.code).toBe(1);
        expect(r.stderr).toMatch(/Fallback gate failed/);
    });

    it('--maintenance passes when current === baseline', async () => {
        const ws = await createTempWorkspace();
        await writeSource(ws, 'a.ts', `
            export const title = (x: string | undefined) => x ?? 'Untitled';
        `);
        // First, build baseline from the current source
        const upd = runGate(ws, ['--update-baseline']);
        expect(upd.code).toBe(0);
        // Now maintenance should pass
        const r = runGate(ws, ['--maintenance']);
        expect(r.code).toBe(0);
        expect(r.stdout).toMatch(/Fallback gate passed/);
    });
});
