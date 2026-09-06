import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { renderYamlAuditPanel } from './YamlAuditPanel';
import { dirtyState } from './dirtyState';
import { collectFilesForAudit, collectFilesForAuditWithScope, runYamlAudit } from '../../../utils/yamlAudit';
import type RadialTimelinePlugin from '../../../main';
import type { BeatAuditWorkspace } from './YamlAuditPanel';

class ElementStub {
    textContent = '';
    classList = { add: vi.fn(), remove: vi.fn() };
    addClass() {} setAttribute() {}
    empty = vi.fn();
    createDiv() { return new ElementStub(); }
    createSpan() { return new ElementStub(); }
    createEl() { return new ElementStub(); }
}
vi.mock('../../../../tests/mocks/obsidian.ts', async original => {
    const actual = await original<typeof import('obsidian')>();
    class Button {
        buttonEl = new ElementStub();
        setButtonText() { return this; } setTooltip() { return this; }
        setDisabled() { return this; } setIcon() { return this; } onClick() { return this; }
    }
    return { ...actual, Setting: class {
        settingEl = new ElementStub(); infoEl = new ElementStub();
        setName() { return this; } setDesc() { return this; }
        addButton(cb: (button: Button) => void) { cb(new Button()); return this; }
    } };
});
vi.mock('../../../utils/yamlAudit', async original => ({
    ...await original<typeof import('../../../utils/yamlAudit')>(),
    collectFilesForAuditWithScope: vi.fn(() => ({ files: [], scopeSummary: 'Book' })),
    collectFilesForAudit: vi.fn(() => []), runYamlAudit: vi.fn()
}));
vi.mock('../../../utils/yamlBackfill', async original => ({
    ...await original<typeof import('../../../utils/yamlBackfill')>(),
    planFillEmptyValues: vi.fn(() => null), planDeprecatedFieldMigration: vi.fn(() => null)
}));
vi.mock('../../../utils/yamlTemplateNormalize', async original => ({
    ...await original<typeof import('../../../utils/yamlTemplateNormalize')>(),
    getCustomKeys: vi.fn(() => []), getCustomDefaults: vi.fn(() => ({}))
}));
beforeEach(() => {
    vi.mocked(collectFilesForAuditWithScope).mockReturnValue({ files: [{}] as never[], scopeSummary: 'Book' } as never);
    vi.mocked(runYamlAudit).mockResolvedValue({ notes: [], unreadFiles: [], summary: {
        totalNotes: 0, unreadNotes: 0, notesWithMissing: 0, notesMissingIds: 0, notesDuplicateIds: 0,
        notesWithExtra: 0, notesWithDrift: 0, notesWithWarnings: 0, clean: 0, notesUnsafe: 0, notesSuspicious: 0
    } });
});
const scopes: Component[] = [];
afterEach(() => { scopes.forEach(scope => scope.unload()); scopes.length = 0; vi.clearAllMocks(); });
function mount() {
    const scope = new Component(); scope.load(); scopes.push(scope);
    const common = { app: {} as never, plugin: { settings: {} } as RadialTimelinePlugin, scope };
    const workspace: BeatAuditWorkspace = { getActiveTab: () => undefined, isEditable: () => false,
        isDirty: () => false, save: async () => {}, getStructuralStatus: () => null as never };
    const beat = renderYamlAuditPanel(new ElementStub() as unknown as HTMLElement, { ...common, noteType: 'Beat', workspace });
    const backdrop = renderYamlAuditPanel(new ElementStub() as unknown as HTMLElement, { ...common, noteType: 'Backdrop' });
    return { beat, backdrop, scope };
}
describe('YAML audit panel ownership', () => {
    it('keeps primary actions independent after mounting a second panel', () => {
        const { beat, backdrop } = mount();
        vi.mocked(collectFilesForAuditWithScope).mockClear();
        beat.refreshPrimaryAction();
        expect(collectFilesForAuditWithScope).toHaveBeenLastCalledWith({}, 'Beat', {}, undefined);
        backdrop.refreshPrimaryAction();
        expect(collectFilesForAuditWithScope).toHaveBeenLastCalledWith({}, 'Backdrop', {}, undefined);
    });
    it('unsubscribes the Beat dirty listener with the owning scope', () => {
        const { scope } = mount();
        vi.mocked(collectFilesForAuditWithScope).mockClear();
        dirtyState.notify();
        expect(collectFilesForAuditWithScope).toHaveBeenCalledOnce();
        scope.unload(); dirtyState.notify();
        expect(collectFilesForAuditWithScope).toHaveBeenCalledOnce();
    });
    it('refreshes Beat defaults independently after Backdrop has mounted and run', async () => {
        const { beat, backdrop } = mount();
        await beat.run();
        await backdrop.run();
        beat.refreshDefaults();
        expect(collectFilesForAudit).toHaveBeenLastCalledWith({}, 'Beat', {}, undefined);
        backdrop.refreshDefaults();
        expect(collectFilesForAudit).toHaveBeenLastCalledWith({}, 'Backdrop', {}, undefined);
    });
    it.each(['reset', 'dispose'])('discards an audit that finishes after %s', async action => {
        const { beat, scope } = mount();
        vi.mocked(collectFilesForAuditWithScope).mockReturnValue({ files: [{}] as never[], scopeSummary: 'Book' } as never);
        let finish!: (value: never) => void;
        vi.mocked(runYamlAudit).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
        const pending = beat.run();
        if (action === 'reset') beat.reset();
        else scope.unload();
        finish({} as never);
        await pending;
        beat.refreshDefaults();
        expect(collectFilesForAudit).not.toHaveBeenCalled();
    });
});
