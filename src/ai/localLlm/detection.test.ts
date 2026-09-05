import { describe, expect, it } from 'vitest';
import type { LocalLlmModelEntry } from './transport';
import {
    chooseAutoLocalModel,
    chooseAutoLocalServer,
    listLocalServerCandidates,
    probeLocalServers,
    type DetectedLocalServer
} from './detection';

const model = (id: string, contextWindow?: number): LocalLlmModelEntry => ({ id, contextWindow } as LocalLlmModelEntry);

describe('listLocalServerCandidates', () => {
    it('probes the three defaults and adds a distinct configured server once', () => {
        const defaults = listLocalServerCandidates({ backend: 'ollama', baseUrl: '' });
        expect(defaults.map(c => c.backend)).toEqual(['ollama', 'lmStudio', 'openaiCompatible']);
        const withCustom = listLocalServerCandidates({ backend: 'openaiCompatible', baseUrl: 'http://localhost:9999/v1' });
        expect(withCustom).toHaveLength(4);
        expect(withCustom[3].label).toContain('localhost:9999');
    });

    it('does not repeat a configured server that matches a default', () => {
        expect(listLocalServerCandidates({ backend: 'ollama', baseUrl: 'http://localhost:11434/v1/' })).toHaveLength(3);
    });
});

describe('probeLocalServers', () => {
    it('keeps servers that answered with models, sorted by id, and drops failures and empty answers', async () => {
        const candidates = listLocalServerCandidates({ backend: 'ollama', baseUrl: '' });
        const detected = await probeLocalServers(candidates, async candidate => {
            if (candidate.backend === 'ollama') return [model('zeta'), model('alpha')];
            if (candidate.backend === 'lmStudio') return [];
            throw new Error('ERR_CONNECTION_REFUSED');
        });
        expect(detected).toHaveLength(1);
        expect(detected[0].backend).toBe('ollama');
        expect(detected[0].models.map(m => m.id)).toEqual(['alpha', 'zeta']);
        expect(detected[0].serverKey).toBe(detected[0].serverKey.toLowerCase());
    });
});

describe('chooseAutoLocalServer', () => {
    const a = { serverKey: 'a', models: [] } as unknown as DetectedLocalServer; // SAFE: only serverKey is read
    const b = { serverKey: 'b', models: [] } as unknown as DetectedLocalServer; // SAFE: only serverKey is read

    it('takes a lone server, else the configured one, else the first', () => {
        expect(chooseAutoLocalServer([b], 'a')).toBe(b);
        expect(chooseAutoLocalServer([a, b], 'b')).toBe(b);
        expect(chooseAutoLocalServer([a, b], 'zzz')).toBe(a);
        expect(chooseAutoLocalServer([], 'a')).toBeNull();
    });
});

describe('chooseAutoLocalModel', () => {
    const tier = (m: LocalLlmModelEntry) => (m.id.startsWith('big') ? 3 : 1);
    const models = [model('small', 8_000), model('big-a', 32_000), model('big-b', 128_000)];

    it('keeps a current model that is still loaded', () => {
        expect(chooseAutoLocalModel(models, 'small', tier)).toBeNull();
    });

    it('picks the highest tier, tie-broken by context window, when the current model is gone or unset', () => {
        expect(chooseAutoLocalModel(models, '', tier)?.id).toBe('big-b');
        expect(chooseAutoLocalModel(models, 'deleted', tier)?.id).toBe('big-b');
        expect(chooseAutoLocalModel([], 'x', tier)).toBeNull();
    });
});
