import type { BeatDefinition } from '../../../types/settings';

export type FieldEntryValue = string | string[];
export type FieldEntry = { key: string; value: FieldEntryValue; required: boolean };
export type BeatRow = BeatDefinition;
export type BeatNoteCustomContentSummary = {
    notesWithTemplateCustomContent: number;
    notesWithExtraCustomContent: number;
    templateCustomKeys: string[];
    extraCustomKeys: string[];
};
