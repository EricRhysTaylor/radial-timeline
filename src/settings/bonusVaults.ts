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
    /**
     * Edition stamped inside this ZIP (see demoVaults/demoEdition.ts), the same
     * as its dated object path. Set it only for an archive that carries the
     * stamp: older vaults are offered this edition on the Welcome screen.
     */
    edition?: string;
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
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/pride-and-prejudice/2026-10-30.3/pride-and-prejudice-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-demo-download',
            sha256: '245fd9d86856da7b7e7b749d4e86d2ba19e6d5927efa069047073b32fdab25c6',
            bytes: 1505588,
            root: 'Pride & Prejudice Demo Vault',
            edition: '2026-10-30.3'
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
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/odyssey/2026-10-30/odyssey-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-odyssey-download',
            sha256: 'bbce39e69ed818c5ff3cfe101126e3d5b6893961d762654e9311d6d52c61c430',
            bytes: 1091408,
            root: 'Obsidian Vault Odyssey Demo',
            edition: '2026-10-30'
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
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/sherlock-holmes/2026-10-30/sherlock-holmes-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-sherlock-download',
            sha256: '81095e9e911c74e117f1c73fa176b766be964b62d41b43998039249c75d7978a',
            bytes: 5483224,
            root: 'Obsidian Vault Sherlock Holmes Demo',
            edition: '2026-10-30'
        }
    },
    {
        id: 'faerie-queene',
        title: 'The Faerie Queene',
        author: 'Spenser',
        get countLabel() { return t('ui.bonusVaults.inPreparation'); },
        status: 'coming-soon',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/mystery-vault-gray.webp'); },
        get description() { return t('ui.bonusVaults.secretDescription'); }
    }
];
