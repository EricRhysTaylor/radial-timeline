/**
 * The Radial Timeline docs site, docs.radialtimeline.com. It is built from the
 * published GitHub wiki (EricRhysTaylor/radial-timeline-docs), so every wiki
 * page keeps its name there and section anchors match the wiki's:
 * `Settings-Core#acts` becomes https://docs.radialtimeline.com/Settings-Core/#acts.
 */
export const DOCS_URL = 'https://docs.radialtimeline.com';

/**
 * A docs page by its wiki page name, with an optional `#anchor` (a trailing
 * `.md` is ignored). No page, or `Home`, is the docs home page.
 */
export function docsUrl(page = ''): string {
    const [name = '', anchor = ''] = page.split('#', 2);
    const pageName = name.replace(/\.md$/, '').replace(/^\/+|\/+$/g, '');
    const path = pageName && pageName !== 'Home' ? `/${pageName}/` : '/';
    return `${DOCS_URL}${path}${anchor ? `#${anchor}` : ''}`;
}
