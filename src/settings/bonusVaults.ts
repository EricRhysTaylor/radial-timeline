import { getEmbeddedAssetDataUri } from '../utils/embeddedAssets';
import type { SampleBookDefinition } from '../utils/sampleVault';
import { t } from '../i18n';

export interface DemoArchive {
    /** Direct archive transfer for Obsidian's downloader. */
    url: string;
    /** Counted browser link for the separate-vault ZIP action. */
    downloadUrl: string;
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
    pageUrl?: string;
    description?: string;
    books?: readonly SampleBookDefinition[];
    archive?: DemoArchive;
}

export const BONUS_VAULTS: readonly BonusVaultDef[] = [
    {
        id: 'pride-and-prejudice',
        title: 'Pride & Prejudice',
        author: 'Austen',
        get countLabel() { return t('ui.bonusVaults.prideCountLabel'); },
        status: 'available',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/pride-and-prejudice.jpg'); },
        pageUrl: 'https://www.radialtimeline.com/resources/pride',
        get description() { return t('ui.bonusVaults.prideDescription'); },
        books: [{ title: 'Pride & Prejudice', sourceFolder: 'Pride & Prejudice' }],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/pride-and-prejudice/2026-10-30/pride-and-prejudice-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-demo-download',
            sha256: '32c043c9cce505ec98efcdd297f66b235b4280036f1645cd22a06812bf4900c7',
            bytes: 729755,
            root: 'Pride & Prejudice Demo Vault'
        }
    },
    {
        id: 'odyssey',
        title: 'The Odyssey',
        author: 'Homer',
        get countLabel() { return t('ui.bonusVaults.odysseyCountLabel'); },
        status: 'available',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/odyssey.jpg'); },
        pageUrl: 'https://www.radialtimeline.com/resources/odyssey',
        get description() { return t('ui.bonusVaults.odysseyDescription'); },
        books: [{ title: 'The Odyssey', sourceFolder: 'The Odyssey' }],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/odyssey-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-odyssey-download',
            sha256: '13c21a3f60e823bfbb67521160060916bba6c13d26611d67f79994e636ba8e82',
            bytes: 1098230,
            root: 'Obsidian Vault Odyssey Demo'
        }
    },
    {
        id: 'sherlock-holmes',
        title: 'Sherlock Holmes',
        author: 'Doyle',
        get countLabel() { return t('ui.bonusVaults.sherlockCountLabel'); },
        status: 'available',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/sherlock-holmes.jpg'); },
        pageUrl: 'https://www.radialtimeline.com/resources/sherlock',
        get description() { return t('ui.bonusVaults.sherlockDescription'); },
        books: [
            { title: 'A Study in Scarlet', sourceFolder: '01 A Study in Scarlet' },
            { title: 'The Sign of the Four', sourceFolder: '02 The Sign of the Four' },
            { title: 'The Hound of the Baskervilles', sourceFolder: '03 The Hound of the Baskervilles' },
            { title: 'The Valley of Fear', sourceFolder: '04 The Valley of Fear' }
        ],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/sherlock-holmes-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-sherlock-download',
            sha256: 'aace53768d279cd6f8f881712aedcf94e7f444985caf892d89ade0e0d579b9cb',
            bytes: 5483077,
            root: 'Obsidian Vault Sherlock Holmes Demo'
        }
    },
    {
        id: 'faerie-queene',
        title: 'The Faerie Queene',
        author: 'Spenser',
        get countLabel() { return t('ui.bonusVaults.inPreparation'); },
        status: 'coming-soon'
    }
];
