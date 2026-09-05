/*
 * Radial Timeline Plugin for Obsidian — Bug Report Helpers
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 */

import { App, Platform } from 'obsidian';

export const BUG_REPORT_REPO = 'EricRhysTaylor/Radial-Timeline';
export const BUG_REPORT_EMAIL = 'bug@radialtimeline.com';

export type BugReportSource = 'rt' | 'inquiry';

export interface BugReportEnv {
    pluginVersion: string;
    obsidianVersion: string;
    platform: string;
    source: BugReportSource;
}

export interface BugReportPayload {
    description: string;
    errorText: string;
    env: BugReportEnv;
    hasScreenshot: boolean;
}

export function gatherEnv(app: App, pluginVersion: string, source: BugReportSource): BugReportEnv {
    const appWithVersion = app as App & { appVersion?: string };
    const obsidianVersion = appWithVersion.appVersion ?? 'unknown';
    const platformName = Platform.isMobile
        ? (Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'Mobile')
        : (Platform.isMacOS ? 'macOS' : Platform.isWin ? 'Windows' : Platform.isLinux ? 'Linux' : 'Desktop');
    return {
        pluginVersion,
        obsidianVersion,
        platform: platformName,
        source,
    };
}

interface ElectronDesktopSource {
    id: string;
    name: string;
}

interface ElectronModule {
    desktopCapturer?: {
        getSources: (opts: { types: string[] }) => Promise<ElectronDesktopSource[]>;
    };
    remote?: {
        desktopCapturer?: {
            getSources: (opts: { types: string[] }) => Promise<ElectronDesktopSource[]>;
        };
    };
}

function getElectronModule(): ElectronModule | null {
    try {
        const req = (window as unknown as { require?: (id: string) => unknown }).require;
        if (typeof req !== 'function') return null;
        return req('electron') as ElectronModule;
    } catch {
        return null;
    }
}

async function streamToBlob(stream: MediaStream): Promise<Blob | null> {
    try {
        const track = stream.getVideoTracks()[0];
        if (!track) return null;
        const video = activeWindow.createEl('video');
        video.srcObject = stream;
        video.muted = true;
        await video.play();
        // Give the first frame a tick to render.
        await new Promise((resolve) => window.setTimeout(resolve, 120));
        const width = video.videoWidth || 1280;
        const height = video.videoHeight || 720;
        const canvas = activeWindow.createEl('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.drawImage(video, 0, 0, width, height);
        return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
    } finally {
        stream.getTracks().forEach((t) => t.stop());
    }
}

export type CaptureFailure = 'unavailable' | 'cancelled' | 'error';

export interface CaptureResult {
    blob: Blob | null;
    failure?: CaptureFailure;
}

/**
 * Capture a single frame of the Obsidian window.
 *
 * Strategy:
 * 1. Prefer Electron's `desktopCapturer` (works in Obsidian without session config).
 * 2. Fall back to `navigator.mediaDevices.getDisplayMedia` (browser path).
 */
export async function captureScreenshot(): Promise<CaptureResult> {
    const electron = getElectronModule();
    const desktopCapturer = electron?.desktopCapturer ?? electron?.remote?.desktopCapturer;
    if (desktopCapturer) {
        try {
            const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
            const obsidian = sources.find((s) => /obsidian/i.test(s.name)) ?? sources[0];
            if (!obsidian) return { blob: null, failure: 'unavailable' };
            // Electron chromeMediaSource constraint — non-standard, but supported in Electron's getUserMedia.
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: false,
                video: {
                    mandatory: {
                        chromeMediaSource: 'desktop',
                        chromeMediaSourceId: obsidian.id,
                        maxWidth: 4096,
                        maxHeight: 4096,
                    },
                } as unknown as MediaTrackConstraints,
            });
            const blob = await streamToBlob(stream);
            return { blob, failure: blob ? undefined : 'error' };
        } catch {
            // Fall through to getDisplayMedia.
        }
    }

    const mediaDevices = navigator.mediaDevices as MediaDevices & {
        getDisplayMedia?: (constraints?: MediaStreamConstraints) => Promise<MediaStream>;
    };
    if (typeof mediaDevices?.getDisplayMedia !== 'function') {
        return { blob: null, failure: 'unavailable' };
    }
    let stream: MediaStream;
    try {
        stream = await mediaDevices.getDisplayMedia({
            video: { displaySurface: 'window' } as MediaTrackConstraints,
            audio: false,
        });
    } catch (err) {
        const name = (err as { name?: string })?.name;
        return { blob: null, failure: name === 'NotAllowedError' ? 'cancelled' : 'unavailable' };
    }
    const blob = await streamToBlob(stream);
    return { blob, failure: blob ? undefined : 'error' };
}

/**
 * Write a PNG blob to the system clipboard so the user can paste it into GitHub's issue form.
 * Returns true on success.
 */
export async function copyImageToClipboard(blob: Blob): Promise<boolean> {
    const clipboard = navigator.clipboard as Clipboard & {
        write?: (data: ClipboardItem[]) => Promise<void>;
    };
    if (typeof clipboard?.write !== 'function' || typeof ClipboardItem === 'undefined') {
        return false;
    }
    try {
        await clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        return true;
    } catch {
        return false;
    }
}

function formatIssueBody(payload: BugReportPayload): string {
    const lines: string[] = [];
    lines.push('### Description');
    lines.push(payload.description.trim() || '_(none provided)_');
    lines.push('');
    if (payload.errorText.trim()) {
        lines.push('### Error / Log');
        lines.push('```');
        lines.push(payload.errorText.trim());
        lines.push('```');
        lines.push('');
    }
    lines.push('### Screenshot');
    if (payload.hasScreenshot) {
        lines.push('_Screenshot is on your clipboard — paste it here with ⌘V / Ctrl+V._');
    } else {
        lines.push('_(none)_');
    }
    lines.push('');
    lines.push('### Environment');
    lines.push(`- Plugin version: ${payload.env.pluginVersion}`);
    lines.push(`- Obsidian version: ${payload.env.obsidianVersion}`);
    lines.push(`- Platform: ${payload.env.platform}`);
    lines.push(`- Reported from: ${payload.env.source === 'rt' ? 'Radial Timeline view' : 'Inquiry view'}`);
    return lines.join('\n');
}

export function buildIssueUrl(payload: BugReportPayload): string {
    const title = payload.description.trim().split('\n')[0].slice(0, 80) || 'Bug report';
    const params = new URLSearchParams({
        title: `[Bug]: ${title}`,
        body: formatIssueBody(payload),
        labels: 'bug',
    });
    return `https://github.com/${BUG_REPORT_REPO}/issues/new?${params.toString()}`;
}

/**
 * Build a plain-text body for the mailto: fallback. Mail clients render
 * plain text directly, so no markdown headings — labels only.
 */
function formatEmailBody(payload: BugReportPayload): string {
    const lines: string[] = [];
    lines.push('Description');
    lines.push(payload.description.trim() || '(none provided)');
    lines.push('');
    if (payload.errorText.trim()) {
        lines.push('Error / Log');
        lines.push(payload.errorText.trim());
        lines.push('');
    }
    lines.push('Screenshot');
    if (payload.hasScreenshot) {
        lines.push('A screenshot is on your clipboard — paste it into this message before sending.');
    } else {
        lines.push('(none)');
    }
    lines.push('');
    lines.push('Environment');
    lines.push(`- Plugin version: ${payload.env.pluginVersion}`);
    lines.push(`- Obsidian version: ${payload.env.obsidianVersion}`);
    lines.push(`- Platform: ${payload.env.platform}`);
    lines.push(`- Reported from: ${payload.env.source === 'rt' ? 'Radial Timeline view' : 'Inquiry view'}`);
    return lines.join('\n');
}

/**
 * Build a mailto: URL for users who don't have (or don't want) a GitHub account.
 * Opens the OS default mail client with subject and body prefilled.
 * Mail clients can't accept attachments through mailto, so the screenshot
 * still rides via clipboard like the GitHub path.
 */
export function buildMailtoUrl(payload: BugReportPayload, recipient = BUG_REPORT_EMAIL): string {
    const title = payload.description.trim().split('\n')[0].slice(0, 80) || 'Bug report';
    const params = new URLSearchParams({
        subject: `[Radial Timeline Bug] ${title}`,
        body: formatEmailBody(payload),
    });
    // URLSearchParams encodes spaces as '+'; mailto expects '%20' for query values.
    const query = params.toString().replace(/\+/g, '%20');
    return `mailto:${recipient}?${query}`;
}
