import { PRIDE_AND_PREJUDICE_THUMB } from '../branding/bonusVaultThumbs';
import type { SampleBookDefinition } from '../utils/sampleVault';

export interface DemoArchive {
    url: string;
    sha256: string;
    bytes: number;
    root: string;
}

/** Curated demo library. Only published collections have an active action. */
export interface BonusVaultDef {
    id: string;
    title: string;
    author: string;
    countLabel: string;
    status: 'available' | 'coming-soon';
    thumb?: string;
    description?: string;
    books?: readonly SampleBookDefinition[];
    archive?: DemoArchive;
}

export const BONUS_VAULTS: readonly BonusVaultDef[] = [
    {
        id: 'pride-and-prejudice',
        title: 'Pride & Prejudice',
        author: 'Austen',
        countLabel: '61 chapters',
        status: 'available',
        thumb: PRIDE_AND_PREJUDICE_THUMB,
        description: 'Recommended first demo. Saved Pulse, four Gossamer signals, and three Inquiry briefings.',
        books: [{ title: 'Pride & Prejudice', sourceFolder: 'Pride & Prejudice' }],
        archive: {
            url: 'https://community.radialtimeline.com/go/rt-welcome-demo-download',
            sha256: '9c898b04621f156b0d5bd6f3cf2d3b1ef54abe13f11a2e6fbd2459e6c7aaedf2',
            bytes: 739102,
            root: 'Pride & Prejudice Demo Vault'
        }
    },
    {
        id: 'odyssey',
        title: 'The Odyssey',
        author: 'Homer',
        countLabel: '89 scenes',
        status: 'available',
        description: 'Explore the complete journey with saved Pulse, four Gossamer signals, and three Inquiry briefings.',
        books: [{ title: 'The Odyssey', sourceFolder: 'The Odyssey' }],
        archive: {
            url: 'https://community.radialtimeline.com/go/rt-welcome-odyssey-download',
            sha256: '13c21a3f60e823bfbb67521160060916bba6c13d26611d67f79994e636ba8e82',
            bytes: 1098230,
            root: 'Obsidian Vault Odyssey Demo'
        }
    },
    {
        id: 'sherlock-holmes',
        title: 'Sherlock Holmes',
        author: 'Doyle',
        countLabel: '4 novels · 56 chapters',
        status: 'available',
        description: 'Our first collection: switch between four complete novels and their saved analyses.',
        books: [
            { title: 'A Study in Scarlet', sourceFolder: '01 A Study in Scarlet' },
            { title: 'The Sign of the Four', sourceFolder: '02 The Sign of the Four' },
            { title: 'The Hound of the Baskervilles', sourceFolder: '03 The Hound of the Baskervilles' },
            { title: 'The Valley of Fear', sourceFolder: '04 The Valley of Fear' }
        ],
        archive: {
            url: 'https://community.radialtimeline.com/go/rt-welcome-sherlock-download',
            sha256: 'aace53768d279cd6f8f881712aedcf94e7f444985caf892d89ade0e0d579b9cb',
            bytes: 5483077,
            root: 'Obsidian Vault Sherlock Holmes Demo'
        }
    },
    {
        id: 'faerie-queene',
        title: 'The Faerie Queene',
        author: 'Spenser',
        countLabel: 'In preparation',
        status: 'coming-soon'
    }
];
