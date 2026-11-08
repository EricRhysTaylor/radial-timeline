/*
 * Radial Timeline Plugin for Obsidian
 * Copyright (c) 2025 Eric Rhys Taylor
 * Licensed under a Source-Available, Non-Commercial License. See LICENSE file for details.
 *
 * The one gate every AI network request passes before a socket opens.
 *
 * "AI off sends nothing" (docs/privacy-and-security.md) covers more than
 * runs: key checks, local server detection, model lists, diagnostics and the
 * model-data refreshes all talk to a provider or a server. Each caller also
 * checks the master switch so it can show the right state, but this gate is
 * what makes the promise hold for a caller that forgets: the cloud transport
 * (`requestProvider`), the local server transport and the model-data fetches
 * all assert it first.
 *
 * The plugin binds it to Settings → AI → Enable AI LLM features on load.
 * Unbound, it refuses: a request that runs before the plugin has said AI is
 * on never leaves.
 */

import { t } from '../../i18n';

/** Thrown when an AI request is attempted while AI is off. */
export class AiNetworkBlockedError extends Error {
    constructor() {
        super(t('notices.aiTurnedOff'));
        this.name = 'AiNetworkBlockedError';
    }
}

let readAiEnabled: (() => boolean) | null = null;

/**
 * Bind the gate to the master switch. Returns the unbind function, for the
 * plugin's register() cleanup.
 */
export function bindAiNetworkGate(read: () => boolean): () => void {
    readAiEnabled = read;
    return () => {
        if (readAiEnabled === read) readAiEnabled = null;
    };
}

/** True only when the plugin has bound the gate and AI is on. */
export function isAiNetworkAllowed(): boolean {
    return readAiEnabled !== null && readAiEnabled() === true;
}

/** Refuse before any AI request leaves the plugin while AI is off. */
export function assertAiNetworkAllowed(): void {
    if (!isAiNetworkAllowed()) throw new AiNetworkBlockedError();
}
