import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildPulseTriplet, EvidenceMethod } from './pulseTriplet';

describe('pulse triplet evidence', () => {
    it('uses PULSE_TRIPLET_CENTERED method', () => {
        const triplet = buildPulseTriplet('12', '13', '14');
        expect(triplet.method).toBe(EvidenceMethod.PULSE_TRIPLET_CENTERED);
        expect(triplet.focus).toBe('13');
        expect(triplet.scenes.previous).toBe('12');
        expect(triplet.scenes.current).toBe('13');
        expect(triplet.scenes.next).toBe('14');
    });

    it('scene processor references shared triplet builder', () => {
        const processorPath = resolve(process.cwd(), 'src/sceneAnalysis/Processor.ts');
        const source = readFileSync(processorPath, 'utf8');
        expect(source.includes('buildPulseTriplet(')).toBe(true);
    });
});
