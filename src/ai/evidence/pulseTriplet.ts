export enum EvidenceMethod {
    PULSE_TRIPLET_CENTERED = 'PULSE_TRIPLET_CENTERED'
}

export interface PulseTripletEvidence {
    method: EvidenceMethod.PULSE_TRIPLET_CENTERED;
    focus: string;
    scenes: {
        previous: string;
        current: string;
        next: string;
    };
}

export function buildPulseTriplet(prev: string, mid: string, next: string): PulseTripletEvidence {
    return {
        method: EvidenceMethod.PULSE_TRIPLET_CENTERED,
        focus: mid,
        scenes: {
            previous: prev,
            current: mid,
            next
        }
    };
}
