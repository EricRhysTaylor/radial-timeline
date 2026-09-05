import type { TFile } from 'obsidian';

export type BeatStructuralStatusKind = 'complete' | 'missing' | 'issue';

export type BeatStructuralIssueCode =
    | 'missing'
    | 'duplicate'
    | 'act_mismatch'
    | 'out_of_sequence'
    | 'missing_model'
    | 'wrong_model'
    | 'non_beat_class';

export interface BeatSystemStatusScope {
    sourcePath: string;
    bookTitle: string;
    scopeSummary: string;
    reason?: string;
    markdownFileCount: number;
    beatNoteCount: number;
}

export interface BeatExpectedBeat {
    key: string;
    name: string;
    actNumber: number;
    actLabel: string;
    ordinal: number;
}

export interface BeatMatchedNote {
    file: TFile;
    path: string;
    basename: string;
    title: string;
    actNumber?: number;
    beatModel?: string;
    missingBeatModel: boolean;
    classValue?: string;
}

export interface BeatStructuralIssue {
    code: BeatStructuralIssueCode;
    message: string;
}

export interface BeatStructuralBeatStatus {
    expected: BeatExpectedBeat;
    kind: BeatStructuralStatusKind;
    present: boolean;
    matchedNotes: BeatMatchedNote[];
    issues: BeatStructuralIssue[];
    issueCount: number;
    isAligned: boolean;
    label: string;
}

export interface BeatStructuralActStatus {
    actNumber: number;
    label: string;
    beats: BeatStructuralBeatStatus[];
    expectedCount: number;
    presentCount: number;
    completeCount: number;
    issueCount: number;
    labelText: string;
}

export interface BeatStructuralSummary {
    expectedCount: number;
    presentCount: number;
    matchedCount: number;
    completeCount: number;
    issueCount: number;
    missingCount: number;
    duplicateCount: number;
    misalignedCount: number;
    outOfSequenceCount: number;
    missingModelNoteCount: number;
    missingModelBeatCount: number;
    wrongModelBeatCount: number;
    nonBeatClassBeatCount: number;
    missingCreateableCount: number;
    syncedCount: number;
    statusLabel: string;
}

export interface BeatSystemStructuralStatus {
    selectedSystem: string;
    selectedSystemKey: string;
    selectedSystemLabel: string;
    scope: BeatSystemStatusScope;
    expectedBeats: BeatExpectedBeat[];
    matchedBeats: BeatStructuralBeatStatus[];
    beats: BeatStructuralBeatStatus[];
    acts: BeatStructuralActStatus[];
    summary: BeatStructuralSummary;
    matches: {
        activeByBeatKey: Map<string, BeatMatchedNote[]>;
        exactByBeatKey: Map<string, BeatMatchedNote[]>;
        looseByBeatKey: Map<string, BeatMatchedNote[]>;
        missingModelByBeatKey: Map<string, BeatMatchedNote[]>;
    };
}
