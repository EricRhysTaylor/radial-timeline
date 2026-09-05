import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { verifyEvidence } from '../scripts/check-api-features.mjs';

type IntegrationEntry = {
    id: string;
    implementationStatus: string;
    sourceFiles?: string[];
    implementationEvidence?: unknown[];
};

function loadIntegrations(): IntegrationEntry[] {
    const raw = readFileSync(resolve(process.cwd(), 'scripts/models/plugin-feature-integration.json'), 'utf8');
    return (JSON.parse(raw).integrations || []) as IntegrationEntry[];
}

describe('check-api-features evidence verification', () => {
    it('accepts canonical Anthropic temperature/top_p and OpenAI citations seams', () => {
        const integrations = loadIntegrations().filter(entry =>
            entry.id === 'anthropic-temperature-topP'
            || entry.id === 'anthropic-token-counting'
            || entry.id === 'openai-citations-annotations'
        );

        const failures = verifyEvidence(integrations);

        expect(failures).toEqual([]);
    });

    it('classifies deleted legacy evidence seams as moved instead of missing features', () => {
        const failures = verifyEvidence([{
            id: 'legacy-seam',
            implementationStatus: 'complete',
            sourceFiles: ['src/api/providerRouter.ts'],
            implementationEvidence: [{
                label: 'Legacy router seam',
                allOf: ['providerRouter']
            }]
        }]);

        expect(failures).toHaveLength(1);
        expect(failures[0]?.kind).toBe('feature_present_different_seam');
    });
});
