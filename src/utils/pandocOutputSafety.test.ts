import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs'; // SAFE: isolated test fixture filesystem operations.
import * as os from 'os'; // SAFE: test-only temporary folder locations.
import * as path from 'path'; // SAFE: test-only fixture paths.

const renderer = vi.hoisted(() => ({ mode: 'success', inputs: [] as string[] }));
vi.mock('child_process', async importOriginal => {
    const original = await importOriginal<typeof import('child_process')>();
    return {
        ...original,
        execFile: (_binary: string, args: string[], _options: unknown, done: (error: Error | null, stdout: string, stderr: string) => void) => {
            const outputIndex = args.indexOf('-o') + 1;
            const input = args[outputIndex + 1];
            renderer.inputs.push(input);
            const body = fs.readFileSync(input, 'utf8');
            fs.writeFileSync(args[outputIndex], renderer.mode === 'invalid' ? '' : Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from(body)]));
            done(renderer.mode === 'fail' ? new Error('Render failed') : null, '', renderer.mode === 'fail' ? 'Render failed' : '');
        },
    };
});

import { runPandocOnContent } from './exportFormats';

describe('rendered output safety', () => {
    let folder: string;
    beforeEach(() => {
        folder = fs.mkdtempSync(path.join(os.tmpdir(), 'rt-output-safety-'));
        renderer.mode = 'success';
        renderer.inputs = [];
    });
    afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

    it('preserves an existing deliverable and reports the new name', async () => {
        const requested = path.join(folder, 'Manuscript.docx');
        fs.writeFileSync(requested, 'An existing editor copy');
        const published = await runPandocOnContent('A revised manuscript', requested, { targetFormat: 'docx' });
        expect(published).toBe(path.join(folder, 'Manuscript (2).docx'));
        expect(fs.readFileSync(requested, 'utf8')).toBe('An existing editor copy');
        expect(fs.readFileSync(published).subarray(4).toString()).toBe('A revised manuscript');
        expect(fs.readdirSync(folder)).toEqual(['Manuscript (2).docx', 'Manuscript.docx']);
    });

    it('isolates concurrent inputs and publishes two complete files', async () => {
        const requested = path.join(folder, 'Manuscript.docx');
        const published = await Promise.all(['First', 'Second'].map(body => runPandocOnContent(body, requested, { targetFormat: 'docx' })));
        expect(new Set(published).size).toBe(2);
        expect(new Set(renderer.inputs).size).toBe(2);
        expect(published.map(file => fs.readFileSync(file).subarray(4).toString()).sort()).toEqual(['First', 'Second']);
        expect(fs.readdirSync(folder).filter(name => name.startsWith('.'))).toEqual([]);
    });

    it.each(['fail', 'invalid'])('publishes nothing when the renderer returns %s', async mode => {
        renderer.mode = mode;
        await expect(runPandocOnContent('Manuscript', path.join(folder, 'Manuscript.docx'), { targetFormat: 'docx' })).rejects.toThrow();
        expect(fs.readdirSync(folder)).toEqual([]);
    });
});
