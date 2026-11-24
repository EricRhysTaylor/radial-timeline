import { MarkdownView, Notice, getFrontMatterInfo, type App, type TFile } from 'obsidian';
import { t } from '../i18n';
import { revealHighlight } from '../utils/fileUtils';

/** A proportional viewport marker, with a small minimum size for very long scenes. */
export function readerScale(viewport: number, content: number, scroll: number): { size: number; top: number } | null {
    if (viewport <= 0 || content <= viewport) return null;
    const size = Math.max(0.06, Math.min(1, viewport / content));
    const position = Math.max(0, Math.min(1, scroll / (content - viewport)));
    return { size: size * 100, top: position * (1 - size) * 100 };
}

/** Keep the note's exact source characters so identical words navigate to their own positions. */
export function sceneBodyStart(source: string): number {
    const info = getFrontMatterInfo(source);
    return info.exists ? info.contentStart : 0;
}

/** Display the exact source, making ordinary note links usable without changing character offsets. */
export function renderReaderText(reader: HTMLElement, source: string, app: App, file: TFile): void {
    reader.replaceChildren();
    const links = /(?<!!)\[\[([^\]\n]+)\]\]|(?<!!)\[([^\]\n]+)\]\(([^)\n]+)\)/g;
    let start = 0;
    for (const match of source.matchAll(links)) {
        const index = match.index;
        reader.appendChild(reader.ownerDocument.createTextNode(source.slice(start, index)));
        const anchor = reader.ownerDocument.createElement('a');
        anchor.textContent = match[0];
        const target = match[1]?.split('|')[0] ?? match[3];
        anchor.setAttribute('href', target);
        if (/^https?:\/\//i.test(target)) {
            anchor.setAttribute('target', '_blank');
            anchor.setAttribute('rel', 'noopener noreferrer');
        }
        anchor.onclick = event => {
            event.stopPropagation();
            if (!/^https?:\/\//i.test(target)) {
                event.preventDefault();
                void app.workspace.openLinkText(target, file.path);
            }
        };
        reader.appendChild(anchor);
        start = index + match[0].length;
    }
    reader.appendChild(reader.ownerDocument.createTextNode(source.slice(start)));
}

/** Open or reuse a separate window showing this note, then select its exact source position. */
export async function openScenePopout(app: App, file: TFile, origin: Document, snapshot?: string, offset?: number): Promise<boolean> {
    const current = await app.vault.read(file);
    if (snapshot !== undefined && current !== snapshot) {
        new Notice(t('ui.timetable.panelReaderChanged'));
        return false;
    }
    let leaf = app.workspace.getLeavesOfType('markdown').find(candidate =>
        candidate.view instanceof MarkdownView && candidate.view.file?.path === file.path
        && candidate.getRoot() !== app.workspace.rootSplit && candidate.view.containerEl.ownerDocument !== origin);
    if (!leaf) {
        leaf = app.workspace.getLeaf('window');
        await leaf.openFile(file, { active: true, state: { mode: 'source' } });
    } else {
        const state = leaf.getViewState();
        await leaf.setViewState({ ...state, state: { ...state.state, mode: 'source' }, active: true });
    }
    await app.workspace.revealLeaf(leaf);
    app.workspace.setActiveLeaf(leaf, { focus: true });
    const view = leaf.view;
    if (view instanceof MarkdownView && offset !== undefined) {
        // A dirty editor may differ from disk; do not navigate to a misleading location.
        if (snapshot !== undefined && view.editor.getValue() !== snapshot) {
            new Notice(t('ui.timetable.panelReaderChanged'));
            return false;
        }
        // Pop-out layout and the Markdown editor both attach asynchronously.
        const win = view.containerEl.ownerDocument.defaultView;
        if (win) await new Promise<void>(resolve => win.requestAnimationFrame(() => win.requestAnimationFrame(() => resolve())));
        const position = view.editor.offsetToPos(Math.min(offset, view.editor.getValue().length));
        view.editor.focus();
        view.editor.setCursor(position);
        view.editor.scrollIntoView({ from: position, to: position }, true);
        // Obsidian's editor scroll does not account for a long Properties block.
        await revealHighlight(app, file, { content: snapshot ?? current, matches: [[offset, offset + 1]] });
    }
    return true;
}

/** Return a character offset in the source-preserving reader at a pointer position. */
export function readerOffset(reader: HTMLElement, x: number, y: number): number | null {
    const doc = reader.ownerDocument;
    const range = doc.caretRangeFromPoint(x, y);
    if (!range || !reader.contains(range.startContainer)) return null;
    const before = doc.createRange();
    before.selectNodeContents(reader);
    before.setEnd(range.startContainer, range.startOffset);
    return before.toString().length;
}
