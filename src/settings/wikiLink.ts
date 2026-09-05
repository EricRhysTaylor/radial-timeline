import { Setting, setIcon } from 'obsidian';
import { ERT_CLASSES } from '../ui/classes';

/**
 * Adds a wiki link icon to a setting's name element.
 * @param setting The Obsidian Setting object
 * @param wikiPage The name of the wiki page (e.g., "AI-Analysis.md" or "Advanced-YAML.md")
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

    const wikiLink = nameEl.querySelector('.ert-wiki-link, .ert-setting-heading-wikilink');
    if (wikiLink) {
        wikiLink.classList.add('ert-wiki-link');
        right.appendChild(wikiLink);
    }

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
 * Adds a wiki link icon to any HTMLElement.
 * @param el The target HTMLElement (usually a header or label)
 * @param wikiPage The name of the wiki page
 */
export function addWikiLinkToElement(el: HTMLElement, wikiPage: string): void {
    if (!el) return;

    // Remove extension if present to make the URL cleaner, though GitHub handles .md
    // GitHub Wiki URLs usually don't have .md for the page view, just the name without extension.
    // e.g. https://github.com/user/repo/wiki/Page-Name
    const pageName = wikiPage.replace(/\.md$/, '');
    
    const link = el.createEl('a', {
        href: `https://github.com/EricRhysTaylor/radial-timeline/wiki/${pageName}`,
        cls: 'ert-wiki-link',
        attr: {
            'aria-label': 'Read more in the wiki',
            'target': '_blank',
            'rel': 'noopener'
        }
    });

    // Add the diagonal arrow icon
    setIcon(link, 'external-link');
    
    // Styling handled by .ert-wiki-link in src/styles/settings.css
}

function addHeadingIconToElement(el: HTMLElement, icon: string): void {
    if (!el) return;

    el.querySelectorAll('.ert-setting-heading-icon').forEach(existing => existing.remove());
    const iconEl = el.createSpan({ cls: 'ert-setting-heading-icon' });
    setIcon(iconEl, icon);
    el.insertBefore(iconEl, el.firstChild);
}
