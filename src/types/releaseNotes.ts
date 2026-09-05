/*
 * Embedded release notes bundle definitions
 */

export interface EmbeddedReleaseNotesEntry {
    version: string;
    title: string;
    body: string;
    url?: string;
    publishedAt?: string;
}

export interface EmbeddedReleaseNotesBundle {
    entries?: EmbeddedReleaseNotesEntry[];
    majorVersion?: string | null;
    major?: EmbeddedReleaseNotesEntry | null;
    latest?: EmbeddedReleaseNotesEntry | null;
    patches?: EmbeddedReleaseNotesEntry[];
}
