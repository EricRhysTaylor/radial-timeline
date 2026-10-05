/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
/* global __RT_RELEASE__ -- build-time flag injected by esbuild define; see esbuild.config.mjs */
import { openSettingsTab } from '../utils/obsidianInternals';
import { normalizePath, Notice, setIcon, TFolder } from 'obsidian';
import RadialTimelinePlugin from '../main';
import { BookDesignerModal } from '../modals/BookDesignerModal';
import { OnboardingModal } from '../modals/OnboardingModal';
import { RT_LOGO_PATHS, RT_LOGO_VIEWBOX } from '../branding/rtLogo';
import { WELCOME_AUTHOR_IMAGE } from '../branding/welcomeAuthorImage';
import { hasInquirySessionSidecarInVault, readInquirySidecarVaultIdentity } from '../inquiry/InquiryArtifactStore';
import { mergeSampleInquirySources } from '../inquiry/sampleInquirySources';
import { DemoLibraryModal } from '../modals/DemoLibraryModal';
import { markBookManagerAutoloadHighlight } from '../settings/bookManagerAutoloadHighlight';
import {
    DEFAULT_BOOK_TITLE,
    deriveBookTitleFromSourcePath,
    getActiveBook
} from '../utils/books';
import { readSampleVaultManifest, registerSampleBookProfiles, type SampleVaultConfig } from '../utils/sampleVault';

interface WelcomeScreenParams {
    container: HTMLElement;
    plugin: RadialTimelinePlugin;
    refreshTimeline: () => void;
}

const WELCOME_COPY = {
    intro: 'Radial Timeline turns long-form narratives into a single, navigable story map. Track scenes, subplots, characters, beats, and timelines across novels, sagas, memoirs, and other sustained fiction or nonfiction projects. Pick a starting point below.',
    cards: {
        website: {
            title: 'Visit the website',
            desc: 'Join the community and share your journey at your own comfort level. Learn about the features available using the Radial Timeline & Editorialist ecosystem and get help.',
            cta: 'Open Website'
        },
        sampleChecking: {
            title: 'Explore a sample vault',
            desc: 'Checking this vault for saved sample books and analysis.',
            cta: 'Checking vault...'
        },
        sampleGet: {
            title: 'Explore a finished book',
            desc: 'Add a complete demo project to this vault. Explore the scenes, beats, Pulse, Gossamer, and saved Inquiry briefings. No API key needed.',
            cta: 'Choose a demo project'
        },
        sampleOpen: {
            title: (name: string) => `${name} detected`,
            desc: (name: string) => `This vault ships a ready-to-explore ${name}. Open it to drop straight into a finished story on the timeline.`,
            cta: 'Open the sample vault'
        },
        design: {
            title: 'Set Book Project',
            desc: 'Choose the manuscript folder that drives the timeline, exports, Inquiry scope, and Book Manager.',
            cta: 'Open Book Manager',
            secondary: '→ or open Book Designer'
        },
        onboard: {
            title: 'Manuscript onboarding',
            desc: 'Bring an existing draft into the timeline. Point it at your book folder and it splits scenes, fills the YAML across acts, and previews everything before anything is written.',
            cta: 'Onboard manuscript'
        }
    },
    workflow: {
        lead: 'Starting a new vault?',
        steps: [
            { icon: 'compass', text: 'Set your novel folder inside the vault with [Book Manager].', link: 'book-manager' },
            { icon: 'file-plus', text: 'Open the Command Palette `⌘ + P` and run `Create note`, or scaffold quickly with `Book Designer`.' },
            { icon: 'layers', text: 'Populate scenes and then expand with subplots, beat systems and more.' },
            { icon: 'map-pin', text: 'Decide early: How many acts? What is the span of time? Consider helpful context markers with backdrop notes or micro-backdrops.' },
            { icon: 'target', text: "Once you get in the rhythm, don't forget to track your writing session time and word count and set due dates for scenes or publish stages." }
        ]
    },
    feedback: 'Take a moment to [share your feedback] about Radial Timeline and the features you would like to see next to smooth your writing workflow. Radial Timeline is expanding in every direction, and your feedback helps guide it.',
    feedbackContactLead: ' Community feedback requires sign-in. Without a Community account, use our ',
    feedbackContactLabel: 'contact form',
    feedbackClosing: '. Happy Writing!',
    updateNote: 'The Community is live — connect from Radial Timeline plugin settings → Community and share your writing journey.'
} as const;

// Discovery links go through the Community's counted redirector
// (community.radialtimeline.com/go/<slug>). Each slug must exist in the
// Community repo's lib/go-links.json registry, which owns the destination.
// Functional links (wiki, issues, help, contact) stay direct.
const WELCOME_URLS = {
    website: 'https://community.radialtimeline.com/go/rt-welcome-site',
    wiki: 'https://github.com/EricRhysTaylor/radial-timeline/wiki',
    community: 'https://community.radialtimeline.com/go/rt-welcome-community',
    issues: 'https://github.com/EricRhysTaylor/radial-timeline/issues',
    youtube: 'https://community.radialtimeline.com/go/rt-welcome-youtube',
    feedback: 'https://community.radialtimeline.com/help',
    contact: 'https://www.radialtimeline.com/contact'
} as const;

const CARD_ICONS = {
    website: 'globe',
    sample: 'book-open',
    design: 'compass',
    onboard: 'book-up'
} as const;

const SVG_NS = 'http://www.w3.org/2000/svg';

const openRadialTimelineSettings = (
    plugin: RadialTimelinePlugin,
    tab: 'core' | 'social' | 'inquiry' | 'publishing' | 'ai' | 'advanced' = 'core'
): void => {
    if (plugin.settingsTab) {
        plugin.settingsTab.setActiveTab(tab);
    }
    openSettingsTab(plugin.app);
};

const appendWelcomeBackgroundLogo = (parent: HTMLElement): void => {
    const doc = parent.ownerDocument;
    const svg = doc.createElementNS(SVG_NS, 'svg');
    svg.setAttr('viewBox', `${RT_LOGO_VIEWBOX.x} ${RT_LOGO_VIEWBOX.y} ${RT_LOGO_VIEWBOX.width} ${RT_LOGO_VIEWBOX.height}`);
    svg.setAttr('preserveAspectRatio', 'xMidYMid meet');
    svg.setAttr('aria-hidden', 'true');

    const defs = doc.createElementNS(SVG_NS, 'defs');
    const gradient = doc.createElementNS(SVG_NS, 'linearGradient');
    gradient.setAttr('id', 'rt-welcome-bg-logo-gradient');
    gradient.setAttr('x1', '0%');
    gradient.setAttr('y1', '0%');
    gradient.setAttr('x2', '0%');
    gradient.setAttr('y2', '100%');

    const start = doc.createElementNS(SVG_NS, 'stop');
    start.setAttr('offset', '0%');
    start.setAttr('stop-color', '#ffffff');
    start.setAttr('stop-opacity', '0.01');

    const middle = doc.createElementNS(SVG_NS, 'stop');
    middle.setAttr('offset', '50%');
    middle.setAttr('stop-color', '#ffffff');
    middle.setAttr('stop-opacity', '0.125');

    const end = doc.createElementNS(SVG_NS, 'stop');
    end.setAttr('offset', '100%');
    end.setAttr('stop-color', '#ffffff');
    end.setAttr('stop-opacity', '0.01');

    gradient.append(start, middle, end);
    defs.append(gradient);
    svg.append(defs);

    RT_LOGO_PATHS.forEach((pathData) => {
        const path = doc.createElementNS(SVG_NS, 'path');
        path.setAttr('d', pathData);
        path.setAttr('fill', 'url(#rt-welcome-bg-logo-gradient)');
        svg.append(path);
    });

    parent.appendChild(svg);
};

interface CardRefs {
    root: HTMLElement;
    title: HTMLElement;
    desc: HTMLElement;
    cta: HTMLElement;
    /** Rebind the card's primary action — used after async sample-vault detection. */
    setActivate: (fn: () => void) => void;
}

interface CardSpec {
    hero?: boolean;
    icon: string;
    number: string;
    title: string;
    desc: string;
    ctaLabel: string;
    onActivate: () => void;
    secondaryLabel?: string;
    onSecondaryActivate?: () => void;
}

const buildCard = (parent: HTMLElement, plugin: RadialTimelinePlugin, spec: CardSpec): CardRefs => {
    const root = parent.createDiv({ cls: 'rt-welcome-card' });
    if (spec.hero) root.addClass('rt-welcome-card-hero');
    root.setAttr('role', 'button');
    root.setAttr('tabindex', '0');
    root.setAttr('data-card-number', spec.number);

    const bgIconEl = root.createDiv({ cls: 'rt-welcome-card-bg-icon' });
    setIcon(bgIconEl, spec.icon);

    const iconEl = root.createDiv({ cls: 'rt-welcome-card-icon' });
    setIcon(iconEl, spec.icon);

    const title = root.createDiv({ cls: 'rt-welcome-card-title', text: spec.title });
    const desc = root.createDiv({ cls: 'rt-welcome-card-desc' });
    desc.createDiv({ cls: 'rt-welcome-card-desc-text', text: spec.desc });
    if (spec.secondaryLabel && spec.onSecondaryActivate) {
        const secondaryRow = desc.createDiv({ cls: 'rt-welcome-card-secondary-row' });
        const secondary = secondaryRow.createEl('a', {
            cls: 'rt-welcome-card-secondary',
            href: '#',
            text: spec.secondaryLabel
        });
        plugin.registerDomEvent(secondary, 'click', (evt) => {
            evt.preventDefault();
            evt.stopPropagation();
            spec.onSecondaryActivate?.();
        });
    }
    const cta = root.createDiv({ cls: 'rt-welcome-card-cta', text: spec.ctaLabel });

    // The whole card is the primary affordance; activate is rebindable so the
    // Sample Vault card can swap its action after async detection resolves.
    let activate = spec.onActivate;
    plugin.registerDomEvent(root, 'click', () => activate());
    plugin.registerDomEvent(root, 'keydown', (evt: KeyboardEvent) => {
        if (evt.target === root && (evt.key === 'Enter' || evt.key === ' ')) {
            evt.preventDefault();
            activate();
        }
    });

    return { root, title, desc, cta, setActivate: (fn) => { activate = fn; } };
};

const displayNameToBookTitle = (displayName: string | undefined, bookFolder: string | undefined): string => {
    const cleaned = (displayName || '').replace(/\s+Sample\s+Vault\s*$/i, '').trim();
    return cleaned || deriveBookTitleFromSourcePath(bookFolder) || DEFAULT_BOOK_TITLE;
};

/**
 * Reads a shipped sample vault's declarative manifest, if present. Discovery
 * follows docs/engineering/sample-vaults.md: scan markdown frontmatter for
 * `rt_sample_vault: true`. Returns the friendly name + book folder so the
 * Sample Vault card can open the right book. Absent manifest is a normal,
 * meaningful default (not every detected sample carries a config yet).
 */
const findSampleVaultConfig = (plugin: RadialTimelinePlugin): SampleVaultConfig | null => {
    const files = plugin.app.vault.getMarkdownFiles();
    for (const file of files) {
        const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (fm && fm.rt_sample_vault === true) {
            return readSampleVaultManifest(fm);
        }
    }
    return null;
};

const inferBookFolderFromSceneNotes = (plugin: RadialTimelinePlugin): SampleVaultConfig | null => {
    const counts = new Map<string, number>();
    for (const file of plugin.app.vault.getMarkdownFiles()) {
        const fm = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
        if (!fm || (fm.Class !== 'Scene' && fm.class !== 'Scene')) continue;
        const parts = normalizePath(file.path).split('/').filter(Boolean);
        if (parts.length < 2) continue;
        const root = parts[0];
        const abstract = plugin.app.vault.getAbstractFileByPath(root);
        if (!(abstract instanceof TFolder)) continue;
        counts.set(root, (counts.get(root) || 0) + 1);
    }

    let bestFolder = '';
    let bestCount = 0;
    counts.forEach((count, folder) => {
        if (count > bestCount || (count === bestCount && folder.localeCompare(bestFolder) < 0)) {
            bestFolder = folder;
            bestCount = count;
        }
    });

    if (!bestFolder || bestCount === 0) return null;
    return {
        displayName: deriveBookTitleFromSourcePath(bestFolder) || bestFolder,
        bookFolder: bestFolder
    };
};

const resolveSampleVaultConfig = (plugin: RadialTimelinePlugin): SampleVaultConfig | null => {
    return findSampleVaultConfig(plugin) || inferBookFolderFromSceneNotes(plugin);
};

const ensureSampleBookProject = async (
    plugin: RadialTimelinePlugin,
    config: SampleVaultConfig | null
): Promise<string | null> => {
    const books = plugin.settings.books || [];
    const bookFolder = config?.bookFolder?.trim();
    if (!bookFolder) return (getActiveBook(plugin.settings) ?? books[0])?.id ?? null;

    const normalizedBookFolder = normalizePath(bookFolder);
    const definitions = config?.books ?? [{
        title: displayNameToBookTitle(config?.displayName, normalizedBookFolder),
        sourceFolder: normalizedBookFolder
    }];
    for (const book of definitions) {
        if (!(plugin.app.vault.getAbstractFileByPath(book.sourceFolder) instanceof TFolder)) {
            throw new Error(`Sample manuscript folder missing: ${book.sourceFolder}`);
        }
    }
    const registration = registerSampleBookProfiles(books, definitions, normalizedBookFolder);
    if (registration.books.length !== books.length) {
        plugin.settings.books = registration.books;
        await plugin.saveSettings();
    }
    return registration.targetId;
};

const ensureSampleInquirySources = async (plugin: RadialTimelinePlugin): Promise<void> => {
    const nextSources = mergeSampleInquirySources(plugin.settings.inquirySources);
    plugin.settings.inquirySources = nextSources;
    await plugin.saveSettings();
    plugin.getInquiryService().notifySourcesSettingsChanged();
};

/**
 * Opens the detected sample vault: select the book whose source folder matches
 * the manifest, registering all explicitly listed collection books on a fresh
 * install. Existing author profiles remain intact. If no target can be
 * determined, open Book Manager.
 */
const openSampleVault = async (
    plugin: RadialTimelinePlugin,
    config: SampleVaultConfig | null,
    refreshTimeline: () => void
): Promise<void> => {
    let targetId: string | null;
    try {
        targetId = await ensureSampleBookProject(plugin, config);
    } catch (error) {
        new Notice(error instanceof Error ? error.message : 'Unable to open the sample vault.');
        return;
    }

    if (targetId) {
        await ensureSampleInquirySources(plugin);
        markBookManagerAutoloadHighlight(targetId);
        await plugin.setActiveBookId(targetId);
        refreshTimeline();
    } else {
        openRadialTimelineSettings(plugin, 'core');
    }
};

const openBookManagerFromWelcome = async (plugin: RadialTimelinePlugin): Promise<void> => {
    if (await hasInquirySessionSidecarInVault(plugin.app)) {
        try {
            const config = resolveSampleVaultConfig(plugin);
            const targetId = await ensureSampleBookProject(plugin, config);
            if (targetId) {
                await ensureSampleInquirySources(plugin);
                markBookManagerAutoloadHighlight(targetId);
                await plugin.setActiveBookId(targetId);
            }
        } catch (error) {
            new Notice(error instanceof Error ? error.message : 'Unable to open the sample vault.');
        }
    }
    openRadialTimelineSettings(plugin, 'core');
    // Settings render async after the tab opens; scroll the Books heading into
    // view once it exists so the link lands on the right section.
    window.setTimeout(() => {
        activeDocument.querySelector('.ert-books-heading')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 200);
};

/**
 * The Inquiry sidecar (Radial Timeline/Inquiry/Sessions/sessions.json) is the clearest
 * signal that the vault already carries packaged Radial Timeline data. Check
 * for the file before showing the sample download/signup path; otherwise a
 * sample vault can look like it needs to be fetched again. Fire-and-forget;
 * mutating a detached container after the view closes is harmless.
 */
const hydrateSampleVaultCard = async (
    refs: CardRefs,
    plugin: RadialTimelinePlugin,
    refreshTimeline: () => void,
    onDetected: () => void
): Promise<void> => {
    const hasSidecar = await hasInquirySessionSidecarInVault(plugin.app);
    if (!hasSidecar) {
        refs.root.removeClass('rt-welcome-card-pending');
        refs.title.setText(WELCOME_COPY.cards.sampleGet.title);
        refs.desc.setText(WELCOME_COPY.cards.sampleGet.desc);
        refs.cta.setText(WELCOME_COPY.cards.sampleGet.cta);
        refs.setActivate(() => { new DemoLibraryModal(plugin.app, plugin).open(); });
        return;
    }

    // Single-book identity travels in the sidecar. Collections explicitly list
    // their books in a manifest; neither requires private plugin settings.
    const sidecarIdentity = await readInquirySidecarVaultIdentity(plugin.app);
    let fallback: SampleVaultConfig | null;
    try {
        fallback = resolveSampleVaultConfig(plugin);
    } catch (error) {
        refs.root.removeClass('rt-welcome-card-pending');
        refs.title.setText('Sample vault needs attention');
        refs.desc.setText(error instanceof Error ? error.message : 'Invalid sample vault configuration.');
        refs.cta.setText('Open Book Manager');
        refs.setActivate(() => openRadialTimelineSettings(plugin, 'core'));
        return;
    }
    // An explicit collection manifest owns its name/order; a session records only its active book.
    const config: SampleVaultConfig | null = (sidecarIdentity || fallback)
        ? fallback?.books ? fallback : {
            displayName: sidecarIdentity?.displayName ?? fallback?.displayName,
            bookFolder: sidecarIdentity?.bookFolder ?? fallback?.bookFolder
        }
        : null;
    const name = displayNameToBookTitle(config?.displayName, config?.bookFolder).toLowerCase() === DEFAULT_BOOK_TITLE.toLowerCase()
        ? 'sample vault'
        : displayNameToBookTitle(config?.displayName, config?.bookFolder);

    refs.root.removeClass('rt-welcome-card-pending');
    refs.root.addClass('rt-welcome-card-detected');
    // Title leads with the detected book name ("Pride & Prejudice detected"),
    // capitalized for the generic fallback ("Sample vault detected").
    const titleName = name.charAt(0).toUpperCase() + name.slice(1);
    refs.title.setText(WELCOME_COPY.cards.sampleOpen.title(titleName));
    refs.desc.setText(config?.books && config.books.length > 1
        ? `Explore all ${config.books.length} books in ${name}. Choose a novel with the book selector, or explore them together in Saga view.`
        : WELCOME_COPY.cards.sampleOpen.desc(name));
    refs.cta.setText(WELCOME_COPY.cards.sampleOpen.cta);
    refs.setActivate(() => { void openSampleVault(plugin, config, refreshTimeline); });
    onDetected();
};

const applyWelcomeCardOrder = (
    ordered: Array<{ refs: CardRefs; number: string }>
): void => {
    ordered.forEach((entry, index) => {
        entry.refs.root.style.order = String(index + 1);
        entry.refs.root.setAttr('data-card-number', entry.number);
    });
};

export function renderWelcomeScreen({ container, plugin, refreshTimeline }: WelcomeScreenParams): void {
    container.addClass('rt-welcome-view');

    // Background RT logo - large and faint
    const bgIcon = container.createDiv({ cls: 'rt-welcome-bg-icon' });
    appendWelcomeBackgroundLogo(bgIcon);

    // Huge Welcome Title (custom styled block, not an H1)
    container.createDiv({ cls: 'rt-welcome-title', text: 'Welcome' });

    const body = container.createDiv({ cls: 'rt-welcome-body' });

    // Two description paragraphs stay together directly under the title. The
    // feedback line's [bracketed] phrase links to Community Help.
    body.createEl('p', { cls: 'rt-welcome-paragraph', text: WELCOME_COPY.intro });
    const feedbackP = body.createEl('p', { cls: 'rt-welcome-paragraph' });
    for (const part of WELCOME_COPY.feedback.split(/(\[[^\]]+\])/g)) {
        if (part.startsWith('[') && part.endsWith(']')) {
            feedbackP.createEl('a', {
                cls: 'ert-welcome-step-link',
                text: part.slice(1, -1),
                href: WELCOME_URLS.feedback
            });
        } else if (part) {
            feedbackP.appendText(part);
        }
    }
    feedbackP.appendText(WELCOME_COPY.feedbackContactLead);
    feedbackP.createEl('a', {
        cls: 'ert-welcome-step-link',
        text: WELCOME_COPY.feedbackContactLabel,
        href: WELCOME_URLS.contact
    });
    feedbackP.appendText(WELCOME_COPY.feedbackClosing);

    // Hero cards: Sample Vault · Book Project · [Onboard] · Website. The onboard
    // card follows "Set Book Project" (onboarding needs a book folder) and, like
    // its command, is dev-build only until the feature ships.
    const showOnboard = !__RT_RELEASE__;
    const cards = body.createDiv({ cls: 'rt-welcome-cards' });
    cards.style.setProperty('--rt-welcome-card-count', String(showOnboard ? 4 : 3));

    // Two-pass numbering keeps badges 01..N sequential in the built order.
    let cardNumber = 0;
    const nextNumber = (): string => String(++cardNumber).padStart(2, '0');

    const sampleRefs = buildCard(cards, plugin, {
        hero: true,
        number: nextNumber(),
        icon: CARD_ICONS.sample,
        title: WELCOME_COPY.cards.sampleChecking.title,
        desc: WELCOME_COPY.cards.sampleChecking.desc,
        ctaLabel: WELCOME_COPY.cards.sampleChecking.cta,
        onActivate: () => undefined,
        secondaryLabel: 'Browse demo projects',
        onSecondaryActivate: () => new DemoLibraryModal(plugin.app, plugin).open()
    });
    sampleRefs.root.addClass('rt-welcome-card-pending');

    const designRefs = buildCard(cards, plugin, {
        number: nextNumber(),
        icon: CARD_ICONS.design,
        title: WELCOME_COPY.cards.design.title,
        desc: WELCOME_COPY.cards.design.desc,
        ctaLabel: WELCOME_COPY.cards.design.cta,
        onActivate: () => { void openBookManagerFromWelcome(plugin); },
        secondaryLabel: WELCOME_COPY.cards.design.secondary,
        onSecondaryActivate: () => { new BookDesignerModal(plugin.app, plugin).open(); }
    });

    const onboardRefs = showOnboard
        ? buildCard(cards, plugin, {
            number: nextNumber(),
            icon: CARD_ICONS.onboard,
            title: WELCOME_COPY.cards.onboard.title,
            desc: WELCOME_COPY.cards.onboard.desc,
            ctaLabel: WELCOME_COPY.cards.onboard.cta,
            onActivate: () => { new OnboardingModal(plugin.app, plugin).open(); }
        })
        : null;

    const websiteRefs = buildCard(cards, plugin, {
        number: nextNumber(),
        icon: CARD_ICONS.website,
        title: WELCOME_COPY.cards.website.title,
        desc: WELCOME_COPY.cards.website.desc,
        ctaLabel: WELCOME_COPY.cards.website.cta,
        onActivate: () => { window.open(WELCOME_URLS.website, '_blank'); }
    });

    void hydrateSampleVaultCard(sampleRefs, plugin, refreshTimeline, () => {
        // On detection the sample vault leads; onboard stays right after Book Project.
        const ordered = [sampleRefs, designRefs, onboardRefs, websiteRefs].filter(
            (refs): refs is CardRefs => refs !== null
        );
        applyWelcomeCardOrder(ordered.map((refs, i) => ({ refs, number: String(i + 1).padStart(2, '0') })));
    });

    // Quick-start workflow, below the hero cards. Inlined author image on the
    // left, steps on the right. Backtick-wrapped segments (e.g. `Create note`)
    // render as inline command/code chips.
    const workflow = body.createDiv({ cls: 'ert-welcome-workflow' });
    workflow.createEl('img', {
        cls: 'ert-welcome-workflow-image',
        attr: { src: WELCOME_AUTHOR_IMAGE, alt: '', 'aria-hidden': 'true' }
    });
    // Maps a step's `link` key to the action its [bracketed] phrase triggers.
    const stepLinkActions: Record<string, () => void> = {
        'book-manager': () => { void openBookManagerFromWelcome(plugin); }
    };
    const workflowContent = workflow.createDiv({ cls: 'ert-welcome-workflow-content' });
    workflowContent.createDiv({ cls: 'ert-welcome-workflow-lead', text: WELCOME_COPY.workflow.lead });
    const workflowSteps = workflowContent.createDiv({ cls: 'ert-welcome-workflow-steps' });
    for (const step of WELCOME_COPY.workflow.steps) {
        const stepEl = workflowSteps.createDiv({ cls: 'ert-welcome-workflow-step' });
        const iconEl = stepEl.createDiv({ cls: 'ert-welcome-workflow-icon' });
        setIcon(iconEl, step.icon);
        const textEl = stepEl.createSpan({ cls: 'ert-welcome-workflow-text' });
        const linkAction = 'link' in step ? stepLinkActions[step.link] : undefined;
        // `code` → inline command chip; [link] → clickable action link.
        for (const part of step.text.split(/(`[^`]+`|\[[^\]]+\])/g)) {
            if (part.startsWith('`') && part.endsWith('`')) {
                textEl.createEl('code', { cls: 'ert-welcome-kbd', text: part.slice(1, -1) });
            } else if (part.startsWith('[') && part.endsWith(']')) {
                const linkEl = textEl.createEl('a', { cls: 'ert-welcome-step-link', text: part.slice(1, -1), href: '#' });
                plugin.registerDomEvent(linkEl, 'click', (evt) => { evt.preventDefault(); linkAction?.(); });
            } else if (part) {
                textEl.appendText(part);
            }
        }
    }

    // Closing notes + odds and ends
    body.createEl('p', { cls: 'rt-welcome-paragraph rt-welcome-footnote', text: WELCOME_COPY.updateNote });

    // Resource links, two columns, ABOVE the backup block.
    // Left column: YouTube, Wiki. Right column: Community, Bug reports.
    const linksWrapper = body.createDiv({ cls: 'rt-welcome-links-wrapper' });
    const links = linksWrapper.createDiv({ cls: 'rt-welcome-links' });
    const linksColLeft = links.createDiv({ cls: 'ert-welcome-links-col' });
    const linksColRight = links.createDiv({ cls: 'ert-welcome-links-col' });
    const makeLinkRow = (col: HTMLElement, label: string, href: string) => {
        const row = col.createDiv({ cls: 'rt-welcome-link-row' });
        row.createEl('a', { href, text: label });
    };
    makeLinkRow(linksColLeft, 'YouTube videos', WELCOME_URLS.youtube);
    makeLinkRow(linksColLeft, 'Wiki — full documentation', WELCOME_URLS.wiki);
    makeLinkRow(linksColRight, 'Community', WELCOME_URLS.community);
    makeLinkRow(linksColRight, 'Bug reports / feature requests', WELCOME_URLS.issues);

    // Backup Notice
    const backupNotice = body.createDiv({ cls: 'rt-welcome-backup-notice' });
    const iconContainer = backupNotice.createDiv({ cls: 'rt-welcome-backup-icon' });
    setIcon(iconContainer, 'archive-restore');

    const backupText = backupNotice.createDiv({ cls: 'rt-welcome-backup-text' });
    const backupPara = backupText.createDiv();
    backupPara.createSpan({ text: 'Back up your Obsidian vault regularly to protect against data loss. Learn more at ' });
    backupPara.createEl('a', { text: 'Obsidian backup guide', href: 'https://help.obsidian.md/backup' });
    backupPara.createSpan({ text: '. Sync does not protect against all forms of data loss. Sync options include ' });
    backupPara.createEl('a', { text: 'Obsidian Sync', href: 'https://obsidian.md/sync' });
    backupPara.createSpan({ text: ' or ' });
    backupPara.createEl('a', { text: 'Obsidian Git', href: 'https://obsidian.md/plugins?id=obsidian-git' });
}
