import { App, TFolder } from 'obsidian';
import {
    ensureInquiryContentLogsRoot,
    ensureInquiryLogsRoot,
    ensurePulseContentLogsRoot,
    resolveInquiryLogsRoot,
    resolvePulseContentLogsRoot
} from '../../ai/log';

export function resolveInquiryLogFolder(): string {
    return resolveInquiryLogsRoot();
}

export async function ensureInquiryLogFolder(app: App): Promise<TFolder | null> {
    return ensureInquiryLogsRoot(app.vault);
}

export async function ensureInquiryContentLogFolder(app: App): Promise<TFolder | null> {
    return ensureInquiryContentLogsRoot(app.vault);
}

export function resolvePulseContentLogFolder(): string {
    return resolvePulseContentLogsRoot();
}

export async function ensurePulseContentLogFolder(app: App): Promise<TFolder | null> {
    return ensurePulseContentLogsRoot(app.vault);
}
