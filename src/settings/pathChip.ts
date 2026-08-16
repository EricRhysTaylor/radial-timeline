import { App, Notice, Setting, TAbstractFile, TFolder, normalizePath, setIcon } from 'obsidian';
import { RT_SYSTEM_FOLDER } from '../utils/systemFolder';

const VAULT_ROOT_PREFIX = `${RT_SYSTEM_FOLDER}/`;

function shortenVaultPath(vaultPath: string): string {
    const normalized = vaultPath.replace(/^\/+/, '');
    if (normalized.startsWith(VAULT_ROOT_PREFIX)) {
        return normalized.slice(VAULT_ROOT_PREFIX.length);
    }
    return normalized;
}

export function revealFolderInExplorer(app: App, vaultPath: string): void {
    const normalized = normalizePath(vaultPath);
    const folder: TAbstractFile | null = app.vault.getAbstractFileByPath(normalized);
    if (!folder) {
        new Notice(`Folder not found yet: ${normalized}`);
        return;
    }
    if (!(folder instanceof TFolder)) {
        new Notice(`Path is not a folder: ${normalized}`);
        return;
    }
    const explorerLeaf = app.workspace.getLeavesOfType('file-explorer')[0];
    if (!explorerLeaf?.view) {
        new Notice('File explorer is not available.');
        return;
    }
    const explorerView = explorerLeaf.view as unknown as { revealInFolder?: (target: TAbstractFile) => void };
    if (!explorerView.revealInFolder) {
        new Notice('Could not reveal folder.');
        return;
    }
    explorerView.revealInFolder(folder);
    void app.workspace.revealLeaf(explorerLeaf);
}

function getOrCreateChipContainer(setting: Setting): HTMLElement {
    const existing = setting.controlEl.querySelector<HTMLElement>(':scope > .ert-path-chips');
    if (existing) return existing;
    const container = createDiv({ cls: 'ert-path-chips' });
    setting.controlEl.insertBefore(container, setting.controlEl.firstChild);
    setting.controlEl.classList.add('ert-control--with-chips');
    return container;
}

export interface PathChipHandle {
    setCount(count: string | number | null): void;
}

/**
 * Appends a clickable folder-path chip to a Setting's control area.
 * Click reveals the folder in Obsidian's file explorer, unless an
 * `onClick` override is provided (e.g. to open a location modal).
 * Multiple chips on the same row sit side-by-side (and wrap if the
 * row is narrow).
 * Chips are kept in their own container that is inserted before any
 * other control (toggle, dropdown, etc.) regardless of call order.
 *
 * Returns a handle for updating an optional count badge that renders
 * before the folder icon (useful for live counts like "38 content logs").
 */
export function addPathChip(
    setting: Setting,
    app: App,
    vaultPath: string,
    options?: { label?: string; count?: string | number | null; onClick?: () => void }
): PathChipHandle {
    const display = options?.label ?? shortenVaultPath(vaultPath);
    const container = getOrCreateChipContainer(setting);
    const chip = container.createEl('a', {
        cls: 'ert-path-chip',
        attr: {
            href: '#',
            role: 'button',
            'aria-label': options?.onClick
                ? `Change ${vaultPath}`
                : `Reveal ${vaultPath} in file explorer`,
            title: vaultPath
        }
    });
    const countEl = chip.createSpan({ cls: 'ert-path-chip__count' });
    const iconEl = chip.createSpan({ cls: 'ert-path-chip__icon' });
    setIcon(iconEl, 'folder');
    chip.createSpan({ cls: 'ert-path-chip__label', text: display });
    const onClick = options?.onClick;
    chip.addEventListener('click', (evt) => {
        evt.preventDefault();
        if (onClick) {
            onClick();
            return;
        }
        revealFolderInExplorer(app, vaultPath);
    });

    const setCount = (count: string | number | null): void => {
        if (count === null || count === '') {
            countEl.textContent = '';
            countEl.classList.remove('is-visible');
            return;
        }
        countEl.textContent = String(count);
        countEl.classList.add('is-visible');
    };
    setCount(options?.count ?? null);

    return { setCount };
}
