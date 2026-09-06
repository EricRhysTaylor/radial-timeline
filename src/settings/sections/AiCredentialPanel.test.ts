import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { buildDefaultAiSettings } from '../../ai/settings/aiSettings';
import { setCredentialSecretId } from '../../ai/credentials/credentials';
import { validateProviderKeyQuick } from '../../ai/credentials/keyValidation';
import type { ProviderKeyValidationResult } from '../../ai/credentials/keyValidation';
import { renderAiCredentialPanel } from './AiCredentialPanel';

interface TextStub { inputEl: ElementStub; setValue(value: string): TextStub; getValue(): string; setPlaceholder(value: string): TextStub; }
interface RowStub { name: string; descEl: ElementStub; settingEl: ElementStub; text?: TextStub; }
const ui = vi.hoisted(() => ({ rows: [] as RowStub[], notices: [] as string[] }));
class ElementStub extends EventTarget {
    children: ElementStub[] = [];
    attributes = new Map<string, string>();
    textContent = ''; className = ''; type = ''; autocomplete = ''; spellcheck = true; value = '';
    ownerDocument = { win: { createEl: () => new ElementStub() } };
    addClass() {} toggleClass() {} focus() {} scrollIntoView() {}
    setAttribute(key: string, value: string) { this.attributes.set(key, value); }
    removeAttribute(key: string) { this.attributes.delete(key); }
    createDiv(options?: { text?: string; cls?: string }) {
        const child = new ElementStub(); child.textContent = options?.text ?? ''; child.className = options?.cls ?? '';
        this.children.push(child); return child;
    }
    createSpan(options?: { text?: string; cls?: string }) { return this.createDiv(options); }
    createEl(_tag: string, options?: { text?: string; cls?: string }) { return this.createDiv(options); }
    appendText(text: string) { this.textContent += text; }
    appendChild(child: ElementStub) { this.children.push(child); }
    empty() { this.children = []; this.textContent = ''; }
    blur() { this.dispatchEvent(new Event('blur')); }
    allText(): string { return this.textContent + this.children.map(child => child.allText()).join(' '); }
    find(text: string): ElementStub | undefined { return this.textContent === text ? this : this.children.map(child => child.find(text)).find(Boolean); }
}
vi.mock('../../ai/credentials/keyValidation', () => ({ validateProviderKeyQuick: vi.fn() }));
vi.mock('../../../tests/mocks/obsidian.ts', async importOriginal => ({
    ...await importOriginal<typeof import('obsidian')>(), setIcon: vi.fn(),
    Notice: class { constructor(message: string) { ui.notices.push(message); } },
    Setting: class {
        name = ''; descEl = new ElementStub(); settingEl = new ElementStub(); text?: TextStub;
        constructor() { ui.rows.push(this); }
        setName(name: string) { this.name = name; return this; }
        setDesc(text: string) { this.descEl.textContent = text; return this; }
        addText(build: (text: TextStub) => void) {
            this.text = { inputEl: new ElementStub(), setValue(value) { this.inputEl.value = value; return this; },
                getValue() { return this.inputEl.value; }, setPlaceholder() { return this; } };
            build(this.text); return this;
        }
    }
}));
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function render(available = true, secretName = 'openai-main') {
    const ai = buildDefaultAiSettings(); setCredentialSecretId(ai, 'openai', secretName);
    const secrets = new Map<string, string>([['openai-main', 'test-old-key'], ['other-key', 'test-other-key']]);
    const storage = { getSecret: vi.fn(async (id: string) => secrets.get(id)),
        setSecret: vi.fn(async (id: string, value: string) => { secrets.set(id, value); }) };
    const app = { secretStorage: storage } as unknown as App;
    const plugin = { refreshCredentialPresence: vi.fn(async () => {}) };
    const scope = new Component(); scope.load();
    const changed = vi.fn(); const persist = vi.fn(async () => {});
    const panel = renderAiCredentialPanel({ section: new ElementStub() as unknown as HTMLElement,
        provider: 'openai', providerName: 'OpenAI', keyPlaceholder: 'key', docsUrl: 'https://platform.openai.com',
        app, plugin: plugin as unknown as RadialTimelinePlugin, parentScope: scope, secretStorageAvailable: available,
        ensureCanonicalAiSettings: () => ai, persistCanonical: persist, onStateChange: changed, onInput: vi.fn() });
    const rows = ui.rows.slice(- (available ? 3 : 2));
    return { panel, scope, changed, persist, storage, secrets, plugin, ai, name: rows[0], status: rows[1], key: rows[2] };
}
beforeEach(() => { ui.rows = []; ui.notices = []; vi.mocked(validateProviderKeyQuick).mockReset().mockResolvedValue({ state: 'ready', detail: '' }); });
describe('AI credential panel', () => {
    it.each(['ready', 'rejected', 'network_blocked'] as const)('renders %s with storage wording and resolved placeholders', async state => {
        vi.mocked(validateProviderKeyQuick).mockResolvedValue({ state, detail: '' });
        const p = render(); await p.panel.refresh();
        expect(p.changed).toHaveBeenLastCalledWith(state);
        expect(p.status.descEl.allText()).toContain('Obsidian secret storage');
        expect(p.status.descEl.allText()).not.toMatch(/\{secret\}|\{provider\}|DocumentFragment/);
        expect(p.name.descEl.allText()).toContain('Get key');
        expect(p.key.text!.inputEl).toMatchObject({ type: 'password', autocomplete: 'new-password', spellcheck: false });
        expect(p.key.settingEl.attributes.has('hidden')).toBe(state !== 'rejected');
        p.scope.unload();
    });
    it.each([false, true])('explains missing storage or secret name (storage=%s)', async available => {
        const p = render(available, ''); await p.panel.refresh();
        expect(p.changed).toHaveBeenLastCalledWith('not_configured');
        expect(p.status.descEl.allText()).toContain('Obsidian secret storage');
        expect(validateProviderKeyQuick).not.toHaveBeenCalled(); p.scope.unload();
    });
    it('shows a missing key and copies only the secret name', async () => {
        const p = render(true, 'missing'); await p.panel.refresh();
        expect(p.changed).toHaveBeenLastCalledWith('not_configured');
        expect(p.key.settingEl.attributes.has('hidden')).toBe(false);
        p.name.text!.setValue('openai-main'); p.name.text!.inputEl.blur();
        await vi.waitFor(() => expect(p.changed).toHaveBeenLastCalledWith('ready'));
        const writeText = vi.fn(async () => {});
        vi.stubGlobal('navigator', { clipboard: { writeText } });
        p.status.descEl.find('Copy key name')!.dispatchEvent(new Event('click'));
        expect(writeText).toHaveBeenCalledWith('openai-main');
        expect(p.name.settingEl.attributes.has('hidden')).toBe(false);
        p.scope.unload(); vi.unstubAllGlobals();
    });
    it('reuses a fresh verdict and refreshes after ten seconds', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(100_000);
        const p = render(); await p.panel.refresh(); await p.panel.refresh();
        expect(validateProviderKeyQuick).toHaveBeenCalledTimes(1);
        now.mockReturnValue(110_001); await p.panel.refresh();
        expect(validateProviderKeyQuick).toHaveBeenCalledTimes(2); now.mockRestore(); p.scope.unload();
    });
    it('ignores a late verdict for the previous secret name', async () => {
        const old = deferred<ProviderKeyValidationResult>();
        vi.mocked(validateProviderKeyQuick).mockImplementationOnce(() => old.promise);
        const p = render(); await vi.waitFor(() => expect(validateProviderKeyQuick).toHaveBeenCalledOnce());
        p.name.text!.setValue('other-key'); p.name.text!.inputEl.blur();
        await vi.waitFor(() => expect(p.changed).toHaveBeenLastCalledWith('ready'));
        old.resolve({ state: 'rejected', detail: '' }); await Promise.resolve(); await Promise.resolve(); await p.panel.refresh();
        expect(p.changed).toHaveBeenLastCalledWith('ready');
        expect(p.persist).toHaveBeenCalledOnce(); p.scope.unload();
    });
    it('saves only to secret storage and refreshes plugin presence even when closed during the write', async () => {
        const write = deferred<void>(); const p = render(); await p.panel.refresh();
        p.storage.setSecret.mockImplementationOnce(async (id, value) => { await write.promise; p.secrets.set(id, value); });
        p.key.text!.setValue('test-new-key'); p.key.text!.inputEl.blur();
        await vi.waitFor(() => expect(p.storage.setSecret).toHaveBeenCalledWith('openai-main', 'test-new-key'));
        p.scope.unload(); const count = p.changed.mock.calls.length;
        write.resolve(); await vi.waitFor(() => expect(p.plugin.refreshCredentialPresence).toHaveBeenCalledOnce());
        expect(p.changed).toHaveBeenCalledTimes(count);
        expect(JSON.stringify(p.ai)).not.toContain('test-new-key');
        expect(p.key.text!.getValue()).toBe('');
        p.key.text!.setValue('ignored-key'); p.key.text!.inputEl.blur(); expect(p.storage.setSecret).toHaveBeenCalledOnce();
    });
    it('serializes overlapping saves and validates only the latest stored key', async () => {
        const first = deferred<void>(); const p = render(); await p.panel.refresh();
        p.storage.setSecret.mockImplementationOnce(async (id, value) => { await first.promise; p.secrets.set(id, value); });
        p.key.text!.setValue('test-first-key'); p.key.text!.inputEl.blur();
        p.key.text!.setValue('test-second-key'); p.key.text!.inputEl.blur();
        await vi.waitFor(() => expect(p.storage.setSecret).toHaveBeenCalledTimes(1)); first.resolve();
        await p.panel.refresh();
        expect(p.secrets.get('openai-main')).toBe('test-second-key');
        expect(validateProviderKeyQuick).toHaveBeenLastCalledWith('openai', 'test-second-key');
        expect(p.plugin.refreshCredentialPresence).toHaveBeenCalledTimes(2); p.scope.unload();
    });
    it('keeps a failed replacement available to retry', async () => {
        const p = render(); await p.panel.refresh(); p.storage.setSecret.mockRejectedValue(new Error('unavailable'));
        p.key.text!.setValue('test-retry-key'); p.key.text!.inputEl.blur(); await p.panel.refresh();
        expect(p.key.text!.getValue()).toBe('test-retry-key');
        expect(p.key.settingEl.attributes.has('hidden')).toBe(false);
        expect(ui.notices).toContain('Unable to save OpenAI key privately.'); p.scope.unload();
    });
    it('removes status action listeners and ignores validation after disposal', async () => {
        const p = render(); await p.panel.refresh();
        const replace = p.status.descEl.find('Replace key...'); expect(replace).toBeDefined();
        replace!.dispatchEvent(new Event('click')); expect(p.key.settingEl.attributes.has('hidden')).toBe(false);
        const count = p.changed.mock.calls.length; replace!.dispatchEvent(new Event('click'));
        expect(p.changed).toHaveBeenCalledTimes(count);
        p.scope.unload();
        const late = deferred<ProviderKeyValidationResult>(); vi.mocked(validateProviderKeyQuick).mockReturnValueOnce(late.promise);
        const q = render(); await vi.waitFor(() => expect(validateProviderKeyQuick).toHaveBeenCalledTimes(2));
        const pending = q.panel.refresh();
        q.scope.unload(); const before = q.changed.mock.calls.length; late.resolve({ state: 'ready', detail: '' });
        await pending; expect(q.changed).toHaveBeenCalledTimes(before);
    });
});
