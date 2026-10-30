/*
 * Radial Timeline (tm) Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */
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
import { findNewerDemoEdition, renderNewerEditionLine } from '../demoVaults/demoEdition';
import { BONUS_VAULTS } from '../settings/bonusVaults';
import { markBookManagerAutoloadHighlight } from '../settings/bookManagerAutoloadHighlight';
import {
    DEFAULT_BOOK_TITLE,
    deriveBookTitleFromSourcePath,
    getActiveBook
} from '../utils/books';
import { readSampleVaultManifest, registerSampleBookProfiles, type SampleVaultConfig } from '../utils/sampleVault';
import { t } from '../i18n';

interface WelcomeScreenParams {
    container: HTMLElement;
    plugin: RadialTimelinePlugin;
    refreshTimeline: () => void;
}

// A function, not a constant: the copy resolves in the current language each
// time the screen renders. [Bracketed] phrases become links and `backticked`
// phrases become command chips, so translations keep those markers.
const getWelcomeCopy = () => ({
    intro: t('ui.welcomeScreen.intro'),
    cards: {
        website: {
            title: t('ui.welcomeScreen.websiteTitle'),
            desc: t('ui.welcomeScreen.websiteDesc'),
            cta: t('ui.welcomeScreen.websiteCta')
        },
        sampleChecking: {
            title: t('ui.welcomeScreen.sampleCheckingTitle'),
            desc: t('ui.welcomeScreen.sampleCheckingDesc'),
            cta: t('ui.welcomeScreen.sampleCheckingCta')
        },
        sampleGet: {
            title: t('ui.welcomeScreen.sampleGetTitle'),
            desc: t('ui.welcomeScreen.sampleGetDesc'),
            cta: t('ui.welcomeScreen.sampleGetCta')
        },
        sampleOpen: {
            title: (name: string) => t('ui.welcomeScreen.sampleOpenTitle', { name }),
            desc: (name: string) => t('ui.welcomeScreen.sampleOpenDesc', { name }),
            cta: t('ui.welcomeScreen.sampleOpenCta')
        },
        design: {
            title: t('ui.welcomeScreen.designTitle'),
            desc: t('ui.welcomeScreen.designDesc'),
            cta: t('ui.welcomeScreen.designCta'),
            secondary: t('ui.welcomeScreen.designSecondary')
        },
        onboard: {
            title: t('ui.welcomeScreen.onboardTitle'),
            desc: t('ui.welcomeScreen.onboardDesc'),
            cta: t('commands.onboardManuscript')
        }
    },
    workflow: {
        lead: t('ui.welcomeScreen.workflowLead'),
        steps: [
            { icon: 'compass', text: t('ui.welcomeScreen.workflowStepBookManager'), link: 'book-manager' },
            { icon: 'file-plus', text: t('ui.welcomeScreen.workflowStepCreateNote') },
            { icon: 'layers', text: t('ui.welcomeScreen.workflowStepPopulate') },
            { icon: 'map-pin', text: t('ui.welcomeScreen.workflowStepDecide') },
            { icon: 'target', text: t('ui.welcomeScreen.workflowStepTrack') }
        ]
    },
    feedback: t('ui.welcomeScreen.feedback'),
    feedbackContact: t('ui.welcomeScreen.feedbackContact'),
    updateNote: t('ui.welcomeScreen.updateNote'),
    backupNotice: t('ui.welcomeScreen.backupNotice')
} as const);

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

/**
 * Append `text` to `parent`, turning each [bracketed] phrase into a link to
 * the next href in `hrefs`, so a sentence with links stays one translatable
 * string.
 */
const appendTextWithLinks = (parent: HTMLElement, text: string, hrefs: readonly string[], linkCls?: string): void => {
    let linkIndex = 0;
    for (const part of text.split(/(\[[^\]]+\])/g)) {
        if (part.startsWith('[') && part.endsWith(']')) {
            parent.createEl('a', { cls: linkCls, text: part.slice(1, -1), href: hrefs[linkIndex++] });
        } else if (part) {
            parent.appendText(part);
        }
    }
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
            throw new Error(t('ui.welcomeScreen.sampleFolderMissing', { folder: book.sourceFolder }));
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
        new Notice(error instanceof Error ? error.message : t('ui.welcomeScreen.unableToOpenSample'));
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

/**
 * A packaged sample is a vault whose Book Manager is not set up yet. Every
 * author's Inquiry sidecar records their active book too, so once a book points
 * at a real folder the vault is the author's own: never call it a sample, and
 * never register sample books or sample Inquiry sources into it.
 */
const isPackagedSampleVault = async (plugin: RadialTimelinePlugin): Promise<boolean> => {
    const configured = (plugin.settings.books || []).some(book => {
        const folder = book.sourceFolder.trim();
        return folder.length > 0 && plugin.app.vault.getAbstractFileByPath(normalizePath(folder)) instanceof TFolder;
    });
    return !configured && await hasInquirySessionSidecarInVault(plugin.app);
};

const openBookManagerFromWelcome = async (plugin: RadialTimelinePlugin): Promise<void> => {
    if (await isPackagedSampleVault(plugin)) {
        try {
            const config = resolveSampleVaultConfig(plugin);
            const targetId = await ensureSampleBookProject(plugin, config);
            if (targetId) {
                await ensureSampleInquirySources(plugin);
                markBookManagerAutoloadHighlight(targetId);
                await plugin.setActiveBookId(targetId);
            }
        } catch (error) {
            new Notice(error instanceof Error ? error.message : t('ui.welcomeScreen.unableToOpenSample'));
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
 * In a vault Book Manager has not set up, the Inquiry sidecar (Radial
 * Timeline/Inquiry/Sessions/sessions.json) is the clearest signal that the
 * vault carries packaged Radial Timeline data (see isPackagedSampleVault).
 * Check before showing the sample download/signup path; otherwise a sample
 * vault can look like it needs to be fetched again. Fire-and-forget;
 * mutating a detached container after the view closes is harmless.
 */
const hydrateSampleVaultCard = async (
    refs: CardRefs,
    plugin: RadialTimelinePlugin,
    refreshTimeline: () => void,
    onDetected: () => void
): Promise<void> => {
    const WELCOME_COPY = getWelcomeCopy();
    if (!(await isPackagedSampleVault(plugin))) {
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
        refs.title.setText(t('ui.welcomeScreen.sampleNeedsAttention'));
        refs.desc.setText(error instanceof Error ? error.message : t('ui.welcomeScreen.invalidSampleConfig'));
        refs.cta.setText(WELCOME_COPY.cards.design.cta);
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
        ? t('ui.welcomeScreen.sampleVaultName')
        : displayNameToBookTitle(config?.displayName, config?.bookFolder);
    const newerEdition = await findNewerDemoEdition(plugin.app, BONUS_VAULTS, config?.bookFolder);

    refs.root.removeClass('rt-welcome-card-pending');
    refs.root.addClass('rt-welcome-card-detected');
    // Title leads with the detected book name ("Pride & Prejudice detected"),
    // capitalized for the generic fallback ("Sample vault detected").
    const titleName = name.charAt(0).toUpperCase() + name.slice(1);
    refs.title.setText(WELCOME_COPY.cards.sampleOpen.title(titleName));
    refs.desc.setText(config?.books && config.books.length > 1
        ? t('ui.welcomeScreen.exploreAllBooks', { count: config.books.length, name })
        : WELCOME_COPY.cards.sampleOpen.desc(name));
    if (newerEdition) {
        renderNewerEditionLine(refs.desc, plugin, newerEdition, { line: 'rt-welcome-card-edition', link: 'rt-welcome-card-secondary' });
    }
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
    const WELCOME_COPY = getWelcomeCopy();

    // Background RT logo - large and faint
    const bgIcon = container.createDiv({ cls: 'rt-welcome-bg-icon' });
    appendWelcomeBackgroundLogo(bgIcon);

    // Huge Welcome Title (custom styled block, not an H1)
    container.createDiv({ cls: 'rt-welcome-title', text: t('ui.welcomeScreen.welcomeTitle') });

    const body = container.createDiv({ cls: 'rt-welcome-body' });

    // Two description paragraphs stay together directly under the title. The
    // feedback line's [bracketed] phrase links to Community Help.
    body.createEl('p', { cls: 'rt-welcome-paragraph', text: WELCOME_COPY.intro });
    const feedbackP = body.createEl('p', { cls: 'rt-welcome-paragraph' });
    appendTextWithLinks(feedbackP, WELCOME_COPY.feedback, [WELCOME_URLS.feedback], 'ert-welcome-step-link');
    feedbackP.appendText(' ');
    appendTextWithLinks(feedbackP, WELCOME_COPY.feedbackContact, [WELCOME_URLS.contact], 'ert-welcome-step-link');

    // Starting points: a finished demo, a new book, or an imported manuscript.
    const cards = body.createDiv({ cls: 'rt-welcome-cards' });

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
        secondaryLabel: t('ui.welcomeScreen.browseDemoProjects'),
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

    const onboardRefs = buildCard(cards, plugin, {
        number: nextNumber(),
        icon: CARD_ICONS.onboard,
        title: WELCOME_COPY.cards.onboard.title,
        desc: WELCOME_COPY.cards.onboard.desc,
        ctaLabel: WELCOME_COPY.cards.onboard.cta,
        onActivate: () => { new OnboardingModal(plugin.app, plugin).open(); }
    });

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
    makeLinkRow(linksColLeft, t('ui.welcomeScreen.linkYoutube'), WELCOME_URLS.youtube);
    makeLinkRow(linksColLeft, t('ui.welcomeScreen.linkWiki'), WELCOME_URLS.wiki);
    makeLinkRow(linksColRight, t('ui.welcomeScreen.linkCommunity'), WELCOME_URLS.community);
    makeLinkRow(linksColRight, t('ui.welcomeScreen.linkIssues'), WELCOME_URLS.issues);

    // Backup Notice
    const backupNotice = body.createDiv({ cls: 'rt-welcome-backup-notice' });
    const iconContainer = backupNotice.createDiv({ cls: 'rt-welcome-backup-icon' });
    setIcon(iconContainer, 'archive-restore');

    const backupText = backupNotice.createDiv({ cls: 'rt-welcome-backup-text' });
    const backupPara = backupText.createDiv();
    appendTextWithLinks(backupPara, WELCOME_COPY.backupNotice, [
        'https://help.obsidian.md/backup',
        'https://obsidian.md/sync',
        'https://obsidian.md/plugins?id=obsidian-git'
    ]);
}
