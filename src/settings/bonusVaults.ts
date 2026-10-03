import { PRIDE_AND_PREJUDICE_THUMB } from '../branding/bonusVaultThumbs';

/** Curated demo library. Only published collections have an active action. */
export interface BonusVaultDef {
    id: string;
    title: string;
    author: string;
    countLabel: string;
    status: 'available' | 'coming-soon';
    thumb?: string;
}

// Reuse the established plugin discovery route; the website owns downloads.
export const DEMO_LIBRARY_URL = 'https://community.radialtimeline.com/go/rt-welcome-demo';

export const BONUS_VAULTS: readonly BonusVaultDef[] = [
    {
        id: 'pride-and-prejudice',
        title: 'Pride & Prejudice',
        author: 'Austen',
        countLabel: '61 chapters',
        status: 'available',
        thumb: PRIDE_AND_PREJUDICE_THUMB
    },
    {
        id: 'odyssey',
        title: 'The Odyssey',
        author: 'Homer',
        countLabel: '89 scenes',
        status: 'coming-soon'
    },
    {
        id: 'sherlock-holmes',
        title: 'Sherlock Holmes',
        author: 'Doyle',
        countLabel: '4 novels · 56 chapters',
        status: 'coming-soon'
    },
    {
        id: 'faerie-queene',
        title: 'The Faerie Queene',
        author: 'Spenser',
        countLabel: 'In preparation',
        status: 'coming-soon'
    }
];
