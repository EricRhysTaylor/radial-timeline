import { normalizePath, TFolder, type App } from 'obsidian';
import { randomUUID } from 'crypto'; // SAFE: unique vault-local delivery records.
import { strFromU8, unzipSync } from 'fflate';
import type RadialTimelinePlugin from '../main';
import type { ManuscriptExportOutcome, ManuscriptModalResult } from '../modals/ManuscriptOptionsModal';
import { hashProofInput } from './manuscriptProof';
import { readPdfPageCount } from './ManuscriptProofPreview';
import { isPathInFolderScope } from '../utils/pathScope';
import { ExportFailure } from '../utils/exportErrors';
import { clampSplitParts } from '../utils/exportProfileModel';

export type DeliveryFormat = 'pdf' | 'docx' | 'markdown' | 'csv' | 'json';
export interface DeliveryFile {
    path: string; primary: boolean; available: boolean; bytes: number;
    sha256?: string; pages?: number; error?: string; modifiedAfterExport?: boolean; reviewedSha256?: string;
}
export interface ExportDeliveryReceipt {
    schemaVersion: 1;
    createdAt: string;
    checkedAt: string;
    receiptPath: string;
    destination: string;
    outputFolder: string;
    format: DeliveryFormat;
    expectedFiles: number;
    expectedWorkingFiles: number;
    sourceTitle: string;
    sourcePaths: string[];
    options?: ManuscriptModalResult;
    reviewedSourcePaths?: string[];
    files: DeliveryFile[];
    problems: string[];
    generationFailure?: string;
    reviewedAt?: string;
}

/** Reject an invalid explicit destination rather than silently choosing another folder. */
export function validateExportDestination(raw: string, app?: App): string {
    const value = raw.trim().replace(/\\/g, '/');
    if (!value || value.startsWith('/') || /^[A-Za-z]:/.test(value) || /[<>:"|?*]/.test(value) || Array.from(value).some(char => char.charCodeAt(0) < 32)
        || value.split('/').some(part => part === '..' || part === '.' || part.startsWith('.'))) {
        throw new ExportFailure({ category: 'write_failure', message: 'Choose a visible folder inside this vault using a relative path.' });
    }
    const folder = normalizePath(value);
    if (app) {
        let prefix = '';
        for (const part of folder.split('/')) {
            prefix = prefix ? `${prefix}/${part}` : part;
            const entry = app.vault.getAbstractFileByPath(prefix);
            if (entry && !(entry instanceof TFolder)) throw new ExportFailure({ category: 'write_failure', message: `The export destination contains a file where a folder is required: ${prefix}` });
        }
    }
    return folder;
}

export async function ensureExportDestination(app: App, raw: string): Promise<string> {
    const folder = validateExportDestination(raw, app);
    let current = '';
    for (const part of folder.split('/')) {
        current = current ? `${current}/${part}` : part;
        const entry = app.vault.getAbstractFileByPath(current);
        if (entry && !(entry instanceof TFolder)) throw new ExportFailure({ category: 'write_failure', message: `The export destination contains a file where a folder is required: ${current}` });
        if (!entry) await app.vault.createFolder(current);
    }
    return folder;
}

export function deliveryFormat(result: Pick<ManuscriptModalResult, 'exportType' | 'outputFormat' | 'outlinePreset'>): DeliveryFormat {
    if (result.exportType === 'outline') {
        if (result.outlinePreset === 'index-cards-csv') return 'csv';
        if (result.outlinePreset === 'index-cards-json') return 'json';
        return 'markdown';
    }
    return result.outputFormat;
}

async function checkFile(app: App, path: string, primary: boolean, format: DeliveryFormat): Promise<DeliveryFile> {
    const file: DeliveryFile = { path, primary, available: false, bytes: 0 };
    try {
        const bytes = new Uint8Array(await app.vault.adapter.readBinary(path)); // SAFE: exact local generated artifacts may not yet be indexed by Obsidian.
        file.available = true;
        file.bytes = bytes.byteLength;
        file.sha256 = hashProofInput(bytes);
        if (!bytes.length) throw new Error('The file is empty.');
        const extension = format === 'markdown' ? 'md' : format;
        if (primary && !path.toLowerCase().endsWith(`.${extension}`)) throw new Error(`Expected a .${extension} export file.`);
        if (primary && format === 'pdf') file.pages = await readPdfPageCount(bytes);
        else if (primary && format === 'docx') {
            const parts = unzipSync(bytes, { filter: entry => ['word/document.xml', '[Content_Types].xml', '_rels/.rels'].includes(entry.name) });
            const document = parts['word/document.xml'] && strFromU8(parts['word/document.xml']);
            if (!document || !parts['[Content_Types].xml']?.length || !parts['_rels/.rels']?.length
                || !/<w:document\b/.test(document) || !/<w:body\b/.test(document) || !document.includes('</w:body>') || !document.includes('</w:document>')) {
                throw new Error('The Word package is missing its document body or required package parts.');
            }
        } else {
            const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
            if (!text.trim()) throw new Error('The text file has no content.');
            if (primary && format === 'json') JSON.parse(text);
        }
    } catch (error) {
        const code = (error as { code?: string } | null)?.code;
        file.error = code === 'ENOENT' ? 'The file is missing at its exported path.'
            : code === 'EACCES' || code === 'EPERM' ? 'Access to this exported file was denied.'
            : error instanceof Error ? error.message : 'The output could not be read.';
    }
    return file;
}

function deliveryProblems(receipt: ExportDeliveryReceipt): string[] {
    const primary = receipt.files.filter(file => file.primary);
    const working = receipt.files.filter(file => !file.primary);
    const problems: string[] = [];
    if (primary.length !== receipt.expectedFiles) problems.push(`Expected ${receipt.expectedFiles} final files; the export returned ${primary.length}.`);
    if (working.length !== receipt.expectedWorkingFiles) problems.push(`Expected ${receipt.expectedWorkingFiles} working Markdown files; the export returned ${working.length}.`);
    if (new Set(receipt.files.map(file => file.path)).size !== receipt.files.length) problems.push('The export returned duplicate output paths.');
    if (receipt.generationFailure) problems.push(`Generation did not finish: ${receipt.generationFailure}`);
    for (const file of receipt.files) if (file.error) problems.push(`${file.path}: ${file.error}`);
    return problems;
}

export async function writeDeliveryReceipt(app: App, receipt: ExportDeliveryReceipt): Promise<void> {
    await ensureExportDestination(app, receipt.receiptPath.slice(0, receipt.receiptPath.lastIndexOf('/')));
    await app.vault.adapter.write(receipt.receiptPath, JSON.stringify(receipt, null, 2)); // SAFE: portable schema-stamped job record at its exact vault-local path.
}

/** Check actual outputs, including all requested split parts and optional working artifacts. */
export async function checkExportDelivery(plugin: RadialTimelinePlugin, result: ManuscriptModalResult, outcome: ManuscriptExportOutcome, sourceTitle: string, sourcePaths: string[], generationFailure?: string): Promise<ExportDeliveryReceipt> {
    const destination = validateExportDestination(result.outputFolder || outcome.outputFolder || '');
    const folder = validateExportDestination(outcome.outputFolder || destination);
    if (folder !== destination && !isPathInFolderScope(folder, destination)) throw new Error('The generated output folder differs from the reviewed destination.');
    const format = deliveryFormat(result);
    const count = result.splitMode === 'parts' ? clampSplitParts(result.splitParts ?? 2) : 1;
    const rendered = outcome.renderedPaths || (outcome.renderedPath ? [outcome.renderedPath] : []);
    const saved = outcome.savedPaths || (outcome.savedPath ? [outcome.savedPath] : []);
    const primaryPaths = format === 'pdf' || format === 'docx' ? rendered : saved;
    const workingPaths = format === 'pdf' ? saved : [];
    const files: DeliveryFile[] = [];
    for (const [paths, primary] of [[primaryPaths, true], [workingPaths, false]] as const) {
        for (const path of paths) {
            if (validateExportDestination(path) !== path || !isPathInFolderScope(path, folder)) throw new Error('An export returned an output path outside its destination.');
            files.push(await checkFile(plugin.app, path, primary, format));
        }
    }
    const receipt: ExportDeliveryReceipt = {
        schemaVersion: 1, createdAt: new Date().toISOString(), checkedAt: new Date().toISOString(),
        receiptPath: `${folder}/Receipts/${randomUUID()}.json`, destination, outputFolder: folder, format,
        expectedFiles: count, expectedWorkingFiles: format === 'pdf' && result.saveMarkdownArtifact !== false ? count * 2 : 0,
        sourceTitle, sourcePaths: [...sourcePaths], options: structuredClone(result), reviewedSourcePaths: result.reviewedSourcePaths ? [...result.reviewedSourcePaths] : undefined,
        files, problems: [], generationFailure,
    };
    receipt.problems = deliveryProblems(receipt);
    await writeDeliveryReceipt(plugin.app, receipt);
    plugin.settings.lastExportDeliveryReceiptPath = receipt.receiptPath;
    await plugin.saveSettings();
    return receipt;
}

export async function recheckDelivery(app: App, receipt: ExportDeliveryReceipt): Promise<ExportDeliveryReceipt> {
    const next = structuredClone(receipt);
    next.checkedAt = new Date().toISOString();
    next.files = [];
    for (const previous of receipt.files) {
        const file = await checkFile(app, previous.path, previous.primary, receipt.format);
        file.modifiedAfterExport = previous.modifiedAfterExport || file.sha256 !== previous.sha256;
        if (file.sha256 === previous.sha256 && !file.error) file.reviewedSha256 = previous.reviewedSha256;
        if (file.sha256 !== previous.sha256 || file.error) next.reviewedAt = undefined;
        next.files.push(file);
    }
    next.problems = deliveryProblems(next);
    return next;
}

export function isDeliveryReviewed(receipt: ExportDeliveryReceipt): boolean {
    const primary = receipt.files.filter(file => file.primary);
    return receipt.problems.length === 0 && primary.length === receipt.expectedFiles
        && primary.every(file => !!file.sha256 && !file.error && file.reviewedSha256 === file.sha256);
}

export async function readDeliveryReceipt(app: App, path: string): Promise<ExportDeliveryReceipt> {
    if (validateExportDestination(path) !== path) throw new Error('Invalid delivery record path.');
    const value: unknown = JSON.parse(await app.vault.adapter.read(path)); // SAFE: exact local receipt, validated before any contained path is used.
    if (!value || typeof value !== 'object') throw new Error('Invalid export delivery record.');
    const receipt = value as ExportDeliveryReceipt;
    if (receipt.schemaVersion !== 1 || receipt.receiptPath !== path || !['pdf', 'docx', 'markdown', 'csv', 'json'].includes(receipt.format)
        || typeof receipt.outputFolder !== 'string' || typeof receipt.destination !== 'string' || typeof receipt.sourceTitle !== 'string'
        || !Array.isArray(receipt.sourcePaths) || !receipt.sourcePaths.every(p => typeof p === 'string')
        || !Number.isInteger(receipt.expectedFiles) || receipt.expectedFiles < 1 || !Number.isInteger(receipt.expectedWorkingFiles) || receipt.expectedWorkingFiles < 0
        || !Array.isArray(receipt.files) || !Array.isArray(receipt.problems) || !receipt.problems.every(p => typeof p === 'string')
        || (receipt.reviewedSourcePaths !== undefined && (!Array.isArray(receipt.reviewedSourcePaths) || !receipt.reviewedSourcePaths.every(p => typeof p === 'string')))
        || (receipt.generationFailure !== undefined && typeof receipt.generationFailure !== 'string')
        || [receipt.createdAt, receipt.checkedAt].some(date => typeof date !== 'string' || !Number.isFinite(Date.parse(date)))
        || (receipt.reviewedAt !== undefined && (typeof receipt.reviewedAt !== 'string' || !Number.isFinite(Date.parse(receipt.reviewedAt))))) throw new Error('Unsupported or invalid export delivery record.');
    if (validateExportDestination(receipt.outputFolder) !== receipt.outputFolder || validateExportDestination(receipt.destination) !== receipt.destination) throw new Error('Invalid delivery record destination.');
    if (receipt.options && (typeof receipt.options !== 'object' || !['manuscript', 'outline'].includes(receipt.options.exportType)
        || !['narrative', 'reverse-narrative', 'chronological', 'reverse-chronological'].includes(receipt.options.order)
        || (receipt.options.includeMatter !== undefined && typeof receipt.options.includeMatter !== 'boolean')
        || (receipt.options.source !== undefined && (!receipt.options.source || !['book', 'folder', 'file'].includes(receipt.options.source.kind))))) throw new Error('Invalid export choices in the delivery record.');
    if (!isPathInFolderScope(path, receipt.outputFolder) || (receipt.outputFolder !== receipt.destination && !isPathInFolderScope(receipt.outputFolder, receipt.destination))) throw new Error('Invalid delivery record destination.');
    for (const file of receipt.files) {
        if (!file || typeof file.path !== 'string' || typeof file.primary !== 'boolean' || typeof file.available !== 'boolean' || !Number.isFinite(file.bytes) || file.bytes < 0
            || (file.sha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.sha256))
            || (file.reviewedSha256 !== undefined && !/^[a-f0-9]{64}$/.test(file.reviewedSha256))
            || (file.error !== undefined && typeof file.error !== 'string')
            || validateExportDestination(file.path) !== file.path || !isPathInFolderScope(file.path, receipt.outputFolder)) throw new Error('Invalid file in the delivery record.');
    }
    return receipt;
}
