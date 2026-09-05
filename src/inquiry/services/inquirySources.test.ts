import { describe, expect, it } from 'vitest';
import { buildInquirySourcesViewModel } from './inquirySources';
import type { EvidenceDocumentMeta, InquiryCitation } from '../state';

describe('buildInquirySourcesViewModel', () => {
    it('keeps direct manuscript citation rendering intact for evidence documents', () => {
        const citations: InquiryCitation[] = [
            { citedText: 'Longer cited excerpt from manuscript.', documentIndex: 0 },
            { citedText: 'Short quote.', documentIndex: 0 }
        ];
        const docs: EvidenceDocumentMeta[] = [
            {
                title: 'The Departure',
                path: 'Scenes/The Departure.md',
                sceneId: 'S1',
                evidenceClass: 'scene'
            }
        ];

        const vm = buildInquirySourcesViewModel(citations, docs);
        expect(vm.hasContent).toBe(true);
        expect(vm.totalCount).toBe(1);
        expect(vm.items[0]).toMatchObject({
            attributionType: 'direct_manuscript',
            title: 'The Departure',
            classLabel: 'Scene',
            citationCount: 2
        });
        expect(vm.items[0].excerpt).toContain('Longer cited excerpt');
    });

    it('renders direct manuscript quotes at full length without ellipsis (no truncation)', () => {
        // 800-char verbatim quote — far longer than the legacy 120-char cap.
        const longQuote = 'A'.repeat(400) + ' ' + 'B'.repeat(399);
        const citations: InquiryCitation[] = [
            { citedText: longQuote, documentIndex: 0 }
        ];
        const docs: EvidenceDocumentMeta[] = [
            { title: 'Scene One', path: 'Scenes/One.md', sceneId: 'S1', evidenceClass: 'scene' }
        ];

        const vm = buildInquirySourcesViewModel(citations, docs);
        expect(vm.items[0].excerpt).toBe(longQuote);
        expect(vm.items[0].excerpt.endsWith('…')).toBe(false);
        expect(vm.items[0].excerpt.length).toBe(longQuote.length);
    });

    it('renders OpenAI-style external attribution when no manuscript document metadata exists', () => {
        const citations: InquiryCitation[] = [
            {
                attributionType: 'tool_url',
                sourceLabel: 'Style Guide',
                sourceId: 'https://example.com/style',
                url: 'https://example.com/style',
                citedText: 'Shorter sentences improve pace.'
            },
            {
                attributionType: 'tool_url',
                sourceLabel: 'Style Guide',
                sourceId: 'https://example.com/style',
                url: 'https://example.com/style',
                citedText: 'Use shorter sentences in high-pressure scenes.'
            },
            {
                attributionType: 'tool_file',
                sourceLabel: 'notes.md',
                sourceId: 'file_123',
                fileId: 'file_123',
                filename: 'notes.md',
                citedText: 'Character motivation notes.'
            }
        ];

        const vm = buildInquirySourcesViewModel(citations, undefined);
        expect(vm.hasContent).toBe(true);
        expect(vm.totalCount).toBe(2);

        const urlSource = vm.items.find(item => item.attributionType === 'tool_url');
        expect(urlSource).toMatchObject({
            title: 'Style Guide',
            classLabel: 'Tool URL',
            citationCount: 2,
            url: 'https://example.com/style'
        });

        const fileSource = vm.items.find(item => item.attributionType === 'tool_file');
        expect(fileSource).toMatchObject({
            title: 'notes.md',
            classLabel: 'Tool File',
            citationCount: 1
        });
    });

    it('returns empty state when no citation data is provided', () => {
        const vm = buildInquirySourcesViewModel(undefined, undefined);
        expect(vm).toEqual({
            items: [],
            totalCount: 0,
            initialCount: 0,
            hasContent: false
        });
    });

    it('derives scene anchors from finding refs using verbatim evidence_quote', () => {
        const docs: EvidenceDocumentMeta[] = [
            {
                title: 'The Departure',
                path: 'Scenes/The Departure.md',
                sceneId: 'scn_a1b2c3d4',
                evidenceClass: 'scene'
            },
            {
                title: 'Netherfield Ball',
                path: 'Scenes/Netherfield Ball.md',
                sceneId: 'scn_deadbeef',
                evidenceClass: 'scene'
            }
        ];

        const vm = buildInquirySourcesViewModel(undefined, docs, [
            {
                refId: 'scn_a1b2c3d4',
                kind: 'continuity',
                headline: 'The emotional turn arrives before enough setup.',
                bullets: ['Pressure advances faster than the underlying motive.'],
                evidenceQuote: 'She turned away before he could speak again.',
                related: [],
                evidenceType: 'scene'
            },
            {
                refId: 'scn_a1b2c3d4',
                kind: 'escalation',
                headline: 'The beat lands but the plateau is underwritten.',
                bullets: [],
                evidenceQuote: '',
                related: [],
                evidenceType: 'scene'
            },
            {
                refId: 'scn_unknown',
                kind: 'unclear',
                headline: 'This should be ignored because it cannot be resolved.',
                bullets: [],
                related: [],
                evidenceType: 'scene'
            }
        ]);

        expect(vm.hasContent).toBe(true);
        expect(vm.totalCount).toBe(1);
        expect(vm.items[0]).toMatchObject({
            attributionType: 'scene_anchor',
            title: 'The Departure',
            path: 'Scenes/The Departure.md',
            classLabel: 'Scene',
            citationCount: 1
        });
        expect(vm.items[0].excerpt).toBe('She turned away before he could speak again.');
        expect(vm.items[0].excerpt.endsWith('…')).toBe(false);
    });

    it('omits scene-anchor entries entirely when no finding emits an evidence_quote', () => {
        // Sources is for verifiable quotes. A finding without an evidence_quote
        // is commentary, not a citation — it must NOT appear here under a fake
        // "1 citation" label. The finding still surfaces in scene notes.
        const docs: EvidenceDocumentMeta[] = [
            {
                title: 'Authorial Notes Scene',
                path: 'Scenes/Notes.md',
                sceneId: 'scn_notes001',
                evidenceClass: 'scene'
            }
        ];

        const vm = buildInquirySourcesViewModel(undefined, docs, [
            {
                refId: 'scn_notes001',
                kind: 'unclear',
                headline: 'Scene exists only as authorial notes.',
                bullets: ['No prose to cite.'],
                related: [],
                evidenceType: 'scene'
            }
        ]);

        expect(vm.hasContent).toBe(false);
        expect(vm.items).toHaveLength(0);
    });

    it('keeps only findings that emit a verbatim evidence_quote and drops the rest', () => {
        const docs: EvidenceDocumentMeta[] = [
            { title: 'Quoted Scene', path: 'Scenes/Quoted.md', sceneId: 'scn_quoted01', evidenceClass: 'scene' },
            { title: 'Empty Scene',  path: 'Scenes/Empty.md',  sceneId: 'scn_empty001', evidenceClass: 'scene' }
        ];

        const vm = buildInquirySourcesViewModel(undefined, docs, [
            {
                refId: 'scn_quoted01',
                kind: 'continuity',
                headline: 'Real ground.',
                bullets: [],
                evidenceQuote: 'He pressed his palm flat against the cold glass.',
                related: [],
                evidenceType: 'scene'
            },
            {
                refId: 'scn_empty001',
                kind: 'unclear',
                headline: 'Just commentary.',
                bullets: [],
                evidenceQuote: '',
                related: [],
                evidenceType: 'scene'
            }
        ]);

        expect(vm.totalCount).toBe(1);
        expect(vm.items[0]).toMatchObject({
            attributionType: 'scene_anchor',
            title: 'Quoted Scene',
            classLabel: 'Scene'
        });
        expect(vm.items[0].excerpt).toBe('He pressed his palm flat against the cold glass.');
    });
});
