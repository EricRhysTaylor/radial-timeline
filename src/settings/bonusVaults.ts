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
        pageUrl: 'https://community.radialtimeline.com/go/rt-settings-classic-pride',
        get description() { return t('ui.bonusVaults.prideDescription'); },
        // Austen's narrator stays close to Elizabeth: third person.
        books: [{ title: 'Pride & Prejudice', sourceFolder: 'Pride & Prejudice', narrationMode: 'third' }],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/pride-and-prejudice/2026-11-10/pride-and-prejudice-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-demo-download',
            sha256: '6545a6bb03684d41aabdbc36960cbd12e5089966a6f811180ec66dfbefab5455',
            bytes: 21007200,
            root: 'Pride & Prejudice Demo Vault',
            edition: '2026-11-10'
        }
    },
    {
        id: 'odyssey',
        title: 'The Odyssey',
        author: 'Homer',
        get countLabel() { return t('ui.bonusVaults.odysseyCountLabel'); },
        status: 'available',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/odyssey.jpg'); },
        pageUrl: 'https://community.radialtimeline.com/go/rt-settings-classic-odyssey',
        get description() { return t('ui.bonusVaults.odysseyDescription'); },
        // Homer's narrator sees everything; the scenes Odysseus tells himself (Books 9 to 12) say first.
        books: [{ title: 'The Odyssey', sourceFolder: 'The Odyssey', narrationMode: 'omni' }],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/odyssey/2026-11-10/odyssey-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-odyssey-download',
            sha256: 'd5bd5ed370e94cabaf62db5c106f986513530c57273d5a58e3e3d86575c85b3a',
            bytes: 1105676,
            root: 'Obsidian Vault Odyssey Demo',
            edition: '2026-11-10'
        }
    },
    {
        id: 'sherlock-holmes',
        title: 'Sherlock Holmes',
        author: 'Doyle',
        get countLabel() { return t('ui.bonusVaults.sherlockCountLabel'); },
        status: 'available',
        get thumb() { return getEmbeddedAssetDataUri('demo-vaults/sherlock-holmes.jpg'); },
        pageUrl: 'https://community.radialtimeline.com/go/rt-settings-classic-sherlock',
        get description() { return t('ui.bonusVaults.sherlockDescription'); },
        // Watson narrates in the first person; the scenes of the American flashbacks say omniscient.
        books: [
            { title: 'A Study in Scarlet', sourceFolder: '01 A Study in Scarlet', narrationMode: 'first' },
            { title: 'The Sign of the Four', sourceFolder: '02 The Sign of the Four', narrationMode: 'first' },
            { title: 'The Hound of the Baskervilles', sourceFolder: '03 The Hound of the Baskervilles', narrationMode: 'first' },
            { title: 'The Valley of Fear', sourceFolder: '04 The Valley of Fear', narrationMode: 'first' }
        ],
        archive: {
            url: 'https://gjffqdfjcjdmqxuqlzsj.supabase.co/storage/v1/object/public/demo-vault/sherlock-holmes/2026-11-10/sherlock-holmes-demo-vault.zip',
            downloadUrl: 'https://community.radialtimeline.com/go/rt-welcome-sherlock-download',
            sha256: 'b5e938c51dbd19fa44ca53cf176a184a4786a94604bebec17c4589091f209293',
            bytes: 5492385,
            root: 'Obsidian Vault Sherlock Holmes Demo',
            edition: '2026-11-10'
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
