import { normalizePath, type TAbstractFile, TFolder, type Vault } from 'obsidian';

export interface DraftTarget {
  destinationPath: string;
  draftLabel: string;
}

function getAllFolders(vault: Vault): TFolder[] {
  const viaApi = (vault as unknown as { getAllFolders?: () => TFolder[] }).getAllFolders?.();
  if (Array.isArray(viaApi)) return viaApi;
  return vault.getAllLoadedFiles().filter((f): f is TFolder => f instanceof TFolder);
}

function getParentPath(path: string): string {
  const normalized = normalizePath(path).trim();
  if (!normalized) return '';
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? '' : normalized.slice(0, idx);
}

function getBaseFolderName(path: string): string {
  const normalized = normalizePath(path).trim();
  if (!normalized) return '';
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

function hasPath(vault: Vault, path: string): boolean {
  return !!vault.getAbstractFileByPath(normalizePath(path));
}

function isPathWithin(path: string, root: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(root);
  if (!normalizedRoot) return false;
  if (normalizedPath === normalizedRoot) return true;
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix);
}

function parseTrailingNumber(label: string): { stem: string; number: number | null } {
  const trimmed = label.trim();
  const match = trimmed.match(/^(.*?)(?:\s+(\d+))?$/);
  if (!match) return { stem: trimmed || 'Draft', number: null };
  const stem = (match[1] || '').trim() || 'Draft';
  const number = match[2] ? Number(match[2]) : null;
  return { stem, number: Number.isFinite(number) ? number : null };
}

function normalizeDraftLabel(label: string): string {
  return label
    .replace(/[\\/]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function suggestNextDraftLabel(vault: Vault, sourceFolderPath: string): string {
  const sourcePath = normalizePath((sourceFolderPath || '').trim());
  const baseName = getBaseFolderName(sourcePath);
  if (!baseName) return 'Draft 2';
  const parentPath = getParentPath(sourcePath);
  const siblings = getAllFolders(vault).filter(folder => getParentPath(folder.path) === parentPath);
  const escaped = baseName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const draftPattern = new RegExp(`^${escaped}\\s+—\\s+Draft\\s+(\\d+)$`, 'i');

  let maxSeen = 1;
  for (const folder of siblings) {
    const folderName = getBaseFolderName(folder.path);
    const match = folderName.match(draftPattern);
    if (!match) continue;
    const num = Number(match[1]);
    if (Number.isFinite(num)) maxSeen = Math.max(maxSeen, num);
  }

  return `Draft ${Math.max(2, maxSeen + 1)}`;
}

export function resolveDraftTarget(
  vault: Vault,
  sourceFolderPath: string,
  requestedLabel?: string
): DraftTarget {
  const sourcePath = normalizePath((sourceFolderPath || '').trim());
  const baseName = getBaseFolderName(sourcePath);
  if (!baseName) {
    throw new Error('Draft requires a book folder.');
  }

  const parentPath = getParentPath(sourcePath);
  const defaultLabel = suggestNextDraftLabel(vault, sourcePath);
  const initialLabel = normalizeDraftLabel((requestedLabel || '').trim()) || defaultLabel;

  const buildPath = (label: string): string => {
    const folderName = `${baseName} — ${label}`;
    return parentPath ? normalizePath(`${parentPath}/${folderName}`) : normalizePath(folderName);
  };

  let label = initialLabel;
  let destinationPath = buildPath(label);
  if (!hasPath(vault, destinationPath)) {
    return { destinationPath, draftLabel: label };
  }

  const { stem, number } = parseTrailingNumber(label);
  let next = number !== null ? number + 1 : 2;
  while (hasPath(vault, destinationPath)) {
    label = `${stem} ${next}`;
    destinationPath = buildPath(label);
    next += 1;
  }

  return { destinationPath, draftLabel: label };
}

async function ensureFolder(vault: Vault, folderPath: string): Promise<void> {
  const normalized = normalizePath(folderPath);
  if (!normalized) return;
  if (vault.getAbstractFileByPath(normalized)) return;

  const segments = normalized.split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const path = normalizePath(current);
    if (!vault.getAbstractFileByPath(path)) {
      await vault.createFolder(path);
    }
  }
}

function getRelativePath(path: string, rootPath: string): string {
  const normalizedPath = normalizePath(path);
  const normalizedRoot = normalizePath(rootPath);
  const prefix = normalizedRoot.endsWith('/') ? normalizedRoot : `${normalizedRoot}/`;
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : normalizedPath;
}

export async function copyFolderRecursive(vault: Vault, fromPath: string, toPath: string): Promise<void> {
  const sourcePath = normalizePath((fromPath || '').trim());
  const destinationPath = normalizePath((toPath || '').trim());

  if (!sourcePath) throw new Error('Draft requires a book folder.');
  if (!destinationPath) throw new Error('Destination path is required.');
  if (sourcePath === destinationPath) throw new Error('Destination cannot equal source.');
  if (isPathWithin(sourcePath, destinationPath)) throw new Error('Destination cannot contain source folder.');
  if (isPathWithin(destinationPath, sourcePath)) throw new Error('Destination cannot be inside source folder.');

  const sourceFolder = vault.getAbstractFileByPath(sourcePath);
  if (!(sourceFolder instanceof TFolder)) throw new Error(`Source folder not found: ${sourcePath}`);
  if (vault.getAbstractFileByPath(destinationPath)) throw new Error(`Destination already exists: ${destinationPath}`);

  await ensureFolder(vault, destinationPath);

  const folders = getAllFolders(vault)
    .filter(folder => isPathWithin(folder.path, sourcePath))
    .sort((a, b) => a.path.split('/').length - b.path.split('/').length);

  const files = vault.getFiles()
    .filter(file => isPathWithin(file.path, sourcePath))
    .sort((a, b) => a.path.localeCompare(b.path));

  const targetFolders = new Set<string>();
  for (const folder of folders) {
    if (folder.path === sourcePath) continue;
    const rel = getRelativePath(folder.path, sourcePath);
    targetFolders.add(normalizePath(`${destinationPath}/${rel}`));
  }

  for (const file of files) {
    const rel = getRelativePath(file.path, sourcePath);
    const targetPath = normalizePath(`${destinationPath}/${rel}`);
    const targetParent = getParentPath(targetPath);
    if (targetParent) targetFolders.add(targetParent);
  }

  const orderedTargetFolders = Array.from(targetFolders)
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const folderPath of orderedTargetFolders) {
    await ensureFolder(vault, folderPath);
  }

  for (const file of files) {
    const rel = getRelativePath(file.path, sourcePath);
    const targetPath = normalizePath(`${destinationPath}/${rel}`);
    if (file.extension.toLowerCase() === 'md') {
      const data = await vault.read(file);
      await vault.create(targetPath, data);
      continue;
    }
    const data = await vault.readBinary(file);
    await vault.createBinary(targetPath, data);
  }
}

export function isFolderPathMissingOrRoot(sourceFolderPath: string): boolean {
  const normalized = normalizePath((sourceFolderPath || '').trim());
  return normalized.length === 0 || normalized === '/' || normalized === '.';
}

export function isValidBookSourceFolder(file: TAbstractFile | null): file is TFolder {
  return file instanceof TFolder;
}

export function getDraftDisplayTitle(baseTitle: string, draftLabel: string): string {
  const cleanedBase = baseTitle.trim();
  return `${cleanedBase} — ${draftLabel}`;
}
