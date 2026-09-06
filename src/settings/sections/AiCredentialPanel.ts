import { Component, Notice, Setting as Settings, setIcon } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import type { AiSettingsV1 } from '../../ai/types';
import { validateProviderKeyQuick, type CloudProviderId } from '../../ai/credentials/keyValidation';
import { getCredentialSecretId, setCredentialSecretId } from '../../ai/credentials/credentials';
import { getSecret, setSecret } from '../../ai/credentials/secretStorage';
import { t } from '../../i18n';

export type ProviderKeyUiState = 'ready' | 'not_configured' | 'rejected' | 'network_blocked' | 'checking';
interface CredentialPanelOptions {
    section: HTMLElement;
    provider: CloudProviderId;
    providerName: string;
    keyPlaceholder: string;
    docsUrl: string;
    app: App;
    plugin: RadialTimelinePlugin;
    parentScope: Component;
    secretStorageAvailable: boolean;
    ensureCanonicalAiSettings: () => AiSettingsV1;
    persistCanonical: () => Promise<void>;
    onStateChange: (state: ProviderKeyUiState) => void;
    onInput: (input: HTMLInputElement) => void;
}

export function renderAiCredentialPanel(options: CredentialPanelOptions): { refresh: () => Promise<void> } {
    const { app, plugin, secretStorageAvailable, ensureCanonicalAiSettings, persistCanonical } = options;
    const scope = options.parentScope.addChild(new Component());
    const statusScope = scope.addChild(new Component());
    let disposed = false;
    scope.register(() => { disposed = true; if (secureKeyInput) secureKeyInput.value = ''; });
    const configureSensitiveInput = (inputEl: HTMLInputElement): void => {
        inputEl.type = 'password';
        inputEl.autocomplete = 'new-password';
        inputEl.spellcheck = false;
    };
    const SAVED_KEY_ENTRY_COPY = 'Saved privately on this device. Paste a key, then click outside this field or press Enter/Return to save or replace it. Keys are never written to your settings file.';
    const doc = options.section.ownerDocument;
    // Descriptions are composed straight into Setting.descEl. A
    // DocumentFragment handed to setDesc() rendered as the literal text
    // "[object DocumentFragment]" in the live plugin, so no fragment is
    // built here at all.
    const secretIdSetting = new Settings(options.section)
        .setName(`Obsidian secret name (${options.providerName})`);
    secretIdSetting.descEl.createSpan({
        text: `The name this vault's Obsidian secret storage files your ${options.providerName} API key under. `
    });
    secretIdSetting.descEl.createEl('a', {
        text: 'Get key',
        href: options.docsUrl,
        attr: { target: '_blank', rel: 'noopener' }
    });
    secretIdSetting.descEl.appendText(' Obsidian secret keys are shared across the plugins in this vault.');
    const keyStatusSetting = new Settings(options.section)
        .setName(`${options.providerName} API key status`);
    keyStatusSetting.settingEl.addClass('ert-ai-provider-key-status-row');

    let providerState: ProviderKeyUiState = 'checking';
    let providerStateDetail = '';
    let replaceRequested = false;
    let revealSecretName = false;
    let secureKeySetting: Settings | null = null;
    let secureKeyInput: HTMLInputElement | null = null;
    const setSettingRowVisible = (setting: Settings, visible: boolean): void => {
        if (visible) {
            setting.settingEl.removeAttribute('hidden');
        } else {
            setting.settingEl.setAttribute('hidden', '');
        }
        setting.settingEl.toggleClass('ert-settings-hidden', !visible);
        setting.settingEl.toggleClass('ert-settings-visible', visible);
    };

    const setProviderState = (next: ProviderKeyUiState): void => {
        if (disposed) return;
        statusScope.unload();
        statusScope.load();
        providerState = next;
        const ai = ensureCanonicalAiSettings();
        const secretId = getCredentialSecretId(ai, options.provider).trim();
        const vars = { provider: options.providerName, secret: secretId };
        if (next !== 'network_blocked') providerStateDetail = '';

        const descEl = keyStatusSetting.descEl;
        descEl.empty();
        const stateBlock = descEl.createDiv({ cls: `ert-ai-provider-key-state is-${next}` });
        const icon = stateBlock.createSpan({ cls: 'ert-ai-provider-key-state__icon' });
        setIcon(icon, next === 'ready' ? 'shield-check' : 'shield-alert');
        const body = stateBlock.createSpan({ cls: 'ert-ai-provider-key-state__body' });
        // The headline answers the two questions an author actually has:
        // is a key stored in Obsidian secret storage, and does the
        // provider accept it. Every state names the storage and the name.
        const headline = !secretStorageAvailable
            ? t('settings.ai.credential.statusNoSecretStorage', vars)
            : !secretId
                ? t('settings.ai.credential.statusNoSecretName', vars)
                : next === 'ready'
                    ? t('settings.ai.credential.statusReady', vars)
                    : next === 'rejected'
                        ? t('settings.ai.credential.statusRejected', vars)
                        : next === 'network_blocked'
                            ? t('settings.ai.credential.statusNetworkBlocked', vars)
                            : next === 'checking'
                                ? t('settings.ai.credential.statusChecking', vars)
                                : t('settings.ai.credential.statusNotConfigured', vars);
        body.createSpan({ cls: 'ert-ai-provider-key-state__text', text: headline });

        let helperText = '';
        if (secretStorageAvailable && secretId) {
            if (next === 'not_configured') {
                helperText = t('settings.ai.credential.helperNotConfigured', vars);
            } else if (next === 'rejected') {
                helperText = t('settings.ai.credential.helperRejected', vars);
            } else if (next === 'network_blocked') {
                helperText = providerStateDetail || t('settings.ai.credential.helperNetworkBlocked', vars);
            } else if (next === 'checking') {
                helperText = t('settings.ai.credential.helperChecking', vars);
            }
        }
        if (helperText) {
            body.createSpan({ cls: 'ert-ai-provider-key-state__helper', text: helperText });
        }

        if ((next === 'ready' || next === 'network_blocked') && secretStorageAvailable) {
            const actions = body.createSpan({ cls: 'ert-ai-provider-key-actions' });

            const replaceBtn = doc.win.createEl('button');
            replaceBtn.className = 'ert-ai-provider-key-action';
            replaceBtn.type = 'button';
            replaceBtn.textContent = t('settings.ai.credential.replaceKeyButton');
            statusScope.registerDomEvent(replaceBtn, 'click', () => {
                replaceRequested = true;
                setProviderState(providerState);
                secureKeyInput?.focus();
            });
            actions.appendChild(replaceBtn);

            if (secretId) {
                const copyBtn = doc.win.createEl('button');
                copyBtn.className = 'ert-ai-provider-key-action';
                copyBtn.type = 'button';
                copyBtn.textContent = t('settings.ai.credential.copyKeyNameButton');
                statusScope.registerDomEvent(copyBtn, 'click', () => {
                    revealSecretName = true;
                    setProviderState(providerState);
                    secretIdSetting.settingEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    void navigator.clipboard.writeText(secretId)
                        .then(() => new Notice(t('settings.ai.credential.keyNameCopiedNotice')))
                        .catch(() => new Notice(t('settings.ai.credential.keyNameCopyFailNotice')));
                });
                actions.appendChild(copyBtn);
            }
        }

        const showSecretIdRow = !secretStorageAvailable
            || next !== 'ready'
            || revealSecretName;
        setSettingRowVisible(secretIdSetting, showSecretIdRow);

        if (secureKeySetting) {
            const shouldShowInput = replaceRequested || next === 'not_configured' || next === 'rejected';
            setSettingRowVisible(secureKeySetting, shouldShowInput);
            if (!shouldShowInput && secureKeyInput) secureKeyInput.value = '';
        }
        options.onStateChange(next);

    };

    let revision = 0;
    let checkedAt = 0;
    let failedSaveRevision = -1;
    let inFlight: Promise<void> | null = null;
    // Serialize writes so an older save cannot finish after its replacement.
    let writes: Promise<void> = Promise.resolve();
    const invalidate = (): void => { revision++; checkedAt = 0; inFlight = null; };
    const refresh = async (): Promise<void> => {
        if (disposed) return;
        if (inFlight) return inFlight;
        if (checkedAt && Date.now() - checkedAt < 10_000) return;
        const currentRevision = revision;
        const secretId = getCredentialSecretId(ensureCanonicalAiSettings(), options.provider).trim();
        const isCurrent = (): boolean => !disposed && currentRevision === revision
            && secretId === getCredentialSecretId(ensureCanonicalAiSettings(), options.provider).trim();
        const check = async (): Promise<void> => {
            await writes;
            if (!isCurrent()) return;
            setProviderState('checking');
            const key = secretStorageAvailable && secretId ? await getSecret(app, secretId) : null;
            if (!isCurrent()) return;
            if (!key || key.length < 8) {
                replaceRequested = false;
                revealSecretName = false;
                setProviderState('not_configured');
                return;
            }
            const validation = await validateProviderKeyQuick(options.provider, key);
            if (!isCurrent()) return;
            providerStateDetail = validation.detail;
            if (validation.state === 'ready' && failedSaveRevision !== currentRevision) {
                replaceRequested = false;
                revealSecretName = false;
            }
            setProviderState(validation.state);
        };
        inFlight = check().finally(() => {
            if (isCurrent()) { inFlight = null; checkedAt = Date.now(); }
        });
        return inFlight;
    };
    secretIdSetting.addText(text => {
        const aiSettings = ensureCanonicalAiSettings();
        text.inputEl.addClass('ert-input--full');
        text
            .setPlaceholder(`${options.provider}-main`)
            .setValue(getCredentialSecretId(aiSettings, options.provider));
        scope.registerDomEvent(text.inputEl, 'blur', () => {
            void (async () => {
                const ai = ensureCanonicalAiSettings();
                const nextId = text.getValue().trim();
                invalidate();
                setCredentialSecretId(ai, options.provider, nextId);
                await persistCanonical();
                await refresh();
            })().catch(() => { if (!disposed) new Notice(`Unable to save ${options.providerName} secret name.`); });
        });
    });
    secretIdSetting.settingEl.addClass('ert-setting-full-width-input');
    if (secretStorageAvailable) {
        setSettingRowVisible(secretIdSetting, false);
    }

    if (secretStorageAvailable) {
        secureKeySetting = new Settings(options.section)
            .setName(`${options.providerName} API key`)
            .setDesc(SAVED_KEY_ENTRY_COPY);
        secureKeySetting.addText(text => {
            text.inputEl.addClass('ert-input--full');
            configureSensitiveInput(text.inputEl);
            text.setPlaceholder(options.keyPlaceholder);
            secureKeyInput = text.inputEl;
            options.onInput(text.inputEl);

            scope.registerDomEvent(text.inputEl, 'keydown', (event: KeyboardEvent) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    text.inputEl.blur();
                }
            });

            scope.registerDomEvent(text.inputEl, 'blur', () => {
                const value = text.getValue().trim();
                if (!value) return;
                const secretId = getCredentialSecretId(ensureCanonicalAiSettings(), options.provider);
                if (!secretId) {
                    new Notice(`Set a ${options.providerName} saved key name first.`);
                    return;
                }
                invalidate();
                const saveRevision = revision;
                text.setValue('');
                setProviderState('checking');
                writes = writes.then(async () => {
                    const stored = await setSecret(app, secretId, value);
                    if (!stored) {
                        if (!disposed && saveRevision === revision) {
                            failedSaveRevision = saveRevision;
                            text.setValue(value);
                            replaceRequested = true;
                            new Notice(`Unable to save ${options.providerName} key privately.`);
                        }
                        return;
                    }
                    // Presence belongs to the plugin even if this pane closed during the save.
                    await plugin.refreshCredentialPresence();
                }).catch(() => {
                    if (!disposed) new Notice(`Unable to refresh ${options.providerName} credential status.`);
                });
                void refresh();
            });
        });
        secureKeySetting.settingEl.addClass('ert-setting-full-width-input');
        setSettingRowVisible(secureKeySetting, false);
        setProviderState(providerState);
    }

    void refresh();

    if (!secretStorageAvailable) {
        options.section.createDiv({
            cls: 'ert-field-note',
            text: `${options.providerName} requires Obsidian secret storage. Older plaintext key fields are no longer supported.`
        });
    }
    return { refresh };
}
