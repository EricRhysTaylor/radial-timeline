import { withAccessibleLabel } from '../utils/domTooltip';
import { Setting, setIcon } from 'obsidian';
import { ERT_CLASSES } from '../ui/classes';
import { t } from '../i18n';
import { WORKFLOW_VIDEOS, workflowVideoUrl, type WorkflowVideoKey } from './workflowVideos';
import { docsUrl } from '../utils/docsUrl';

/**
 * Adds a docs link icon to a setting's name element.
 * @param setting The Obsidian Setting object
 * @param wikiPage The wiki page name, with an optional anchor (e.g. "Settings-Core#acts");
 *   it opens on docs.radialtimeline.com, which keeps the wiki's page names
 */
export function addWikiLink(setting: Setting, wikiPage: string): void {
    addWikiLinkToElement(setting.nameEl, wikiPage);
}

const HEADING_ICON_ALIASES: Record<string, string> = {
    form: 'form-input'
};

export function addHeadingIcon(setting: Setting, icon: string): void {
    const resolved = HEADING_ICON_ALIASES[icon] ?? icon;
    addHeadingIconToElement(setting.nameEl, resolved);
}

export function applyErtHeaderLayout(
    setting: Setting,
    options: { variant?: 'inline' | 'block'; indent?: 'flush' | 'indent' } = {}
): { header: HTMLElement; left: HTMLElement; main: HTMLElement; right: HTMLElement } | null {
    const nameEl = setting.nameEl;
    if (!nameEl) return null;
    const descEl = setting.descEl;
    const infoEl = setting.settingEl.querySelector('.setting-item-info');
    if (!infoEl) return null;

    infoEl.empty();
    const descHtml = descEl ? descEl.innerHTML.trim() : '';
    const hasDesc = Boolean(descEl && descHtml.length > 0);
    const variant = options.variant ?? (hasDesc ? 'block' : 'inline');
    const useHeader2 = hasDesc;
    const headerWrapper = useHeader2
        ? infoEl.createDiv({
            cls: [
                ERT_CLASSES.HEADER2,
                options.indent === 'indent' ? ERT_CLASSES.HEADER2_INDENT : ERT_CLASSES.HEADER2_FLUSH
            ]
        })
        : infoEl;
    const headerVariant = variant === 'block' ? ERT_CLASSES.HEADER_BLOCK : ERT_CLASSES.HEADER_INLINE;
    const header = headerWrapper.createDiv({
        cls: [ERT_CLASSES.HEADER, headerVariant]
    });
    const left = header.createDiv({ cls: ERT_CLASSES.HEADER_LEFT });
    const main = header.createDiv({ cls: ERT_CLASSES.HEADER_MAIN });
    const right = header.createDiv({ cls: ERT_CLASSES.HEADER_RIGHT });

    const iconEl = nameEl.querySelector('.ert-setting-heading-icon');
    if (iconEl) {
        left.appendChild(iconEl);
    } else {
        header.addClass(ERT_CLASSES.HEADER_NO_LEFT);
    }

    // The wiki link, and a workflow video's play icon beside it when there is one.
    nameEl.querySelectorAll('.ert-wiki-link, .ert-setting-heading-wikilink').forEach(link => {
        link.classList.add('ert-wiki-link');
        right.appendChild(link);
    });

    nameEl.classList.add(ERT_CLASSES.SECTION_TITLE);
    main.appendChild(nameEl);
    if (descEl && hasDesc) {
        descEl.classList.add(ERT_CLASSES.SECTION_DESC);
        headerWrapper.appendChild(descEl);
    } else if (descEl) {
        descEl.remove();
    }

    return { header, left, main, right };
}

/**
 * Adds a docs link icon to any HTMLElement.
 * @param el The target HTMLElement (usually a header or label)
 * @param wikiPage The wiki page name, with an optional anchor
 */
export function addWikiLinkToElement(el: HTMLElement, wikiPage: string): void {
    if (!el) return;

    // Links open the page on docs.radialtimeline.com, which is built from the
    // published wiki and keeps its page names and section anchors.
    const link = withAccessibleLabel(el.createEl('a', {
        href: docsUrl(wikiPage),
        cls: 'ert-wiki-link',
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), 'Read more in the docs');

    // Add the diagonal arrow icon
    setIcon(link, 'external-link');
    
    // Styling handled by .ert-wiki-link in src/styles/settings.css
}

/**
 * Adds a workflow video's play button to a setting's name element, ahead of
 * its wiki link. Nothing is added while the video isn't published.
 */
export function addVideoLink(setting: Setting, video: WorkflowVideoKey): void {
    addVideoLinkToElement(setting.nameEl, video, 'ert-wiki-link');
}

/**
 * Adds a workflow video's play button to any element. `linkClass` is the class
 * of the wiki link beside it (a heading's, a modal badge's or a badge pill's),
 * so the two sit together; the video comes first and stands out in gold
 * (`.ert-video-link`). Nothing is added while the video isn't published.
 */
export function addVideoLinkToElement(el: HTMLElement, video: WorkflowVideoKey, linkClass: string): void {
    const href = workflowVideoUrl(video);
    if (!el || !href) return;
    const wiki = el.querySelector(`:scope > .${linkClass}`);
    const link = withAccessibleLabel(el.createEl('a', {
        href,
        cls: [linkClass, 'ert-video-link'],
        attr: { 'target': '_blank', 'rel': 'noopener' }
    }), t('ui.workflowVideos.watch', { title: t(WORKFLOW_VIDEOS[video].titleKey) }));
    setIcon(link, 'rt-video-play');
    if (wiki) el.insertBefore(link, wiki);
}

function addHeadingIconToElement(el: HTMLElement, icon: string): void {
    if (!el) return;

    el.querySelectorAll('.ert-setting-heading-icon').forEach(existing => existing.remove());
    const iconEl = el.createSpan({ cls: 'ert-setting-heading-icon' });
    setIcon(iconEl, icon);
    el.insertBefore(iconEl, el.firstChild);
}
