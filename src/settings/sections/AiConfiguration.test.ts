import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Component } from 'obsidian';
import { renderAiConfiguration } from './AiConfiguration';
import type RadialTimelinePlugin from '../../main';

interface TextStub { value: string; inputEl: ElementStub; setValue(value: string): TextStub; getValue(): string; }
interface ToggleStub { value: boolean; disabled: boolean; toggleEl: ElementStub;
    setValue(value: boolean): ToggleStub; setDisabled(value: boolean): ToggleStub;
    onChange(callback: (value: boolean) => void): ToggleStub; change(value: boolean): void; }
interface RowStub { name: string; desc: string; text?: TextStub; toggle?: ToggleStub; }
const ui = vi.hoisted(() => ({ rows: [] as RowStub[], notices: [] as string[] }));
class ElementStub extends EventTarget {
    children: ElementStub[] = [];
    type = ''; min = ''; max = ''; step = '';
    addClass() {} setAttr() {}
    createDiv() { const child = new ElementStub(); this.children.push(child); return child; }
    createSpan() { return this.createDiv(); }
    createEl() { return this.createDiv(); }
    blur() { this.dispatchEvent(new Event('blur')); }
}
vi.mock('../../i18n', () => ({ t: (key: string) => key }));
vi.mock('../../../tests/mocks/obsidian.ts', async importOriginal => {
    const actual = await importOriginal<typeof import('obsidian')>();
    return {
        ...actual, setIcon: vi.fn(), setTooltip: vi.fn(),
        Notice: class { constructor(message: string) { ui.notices.push(message); } },
        Setting: class {
            settingEl = { addClass() {} }; name = ''; desc = ''; text?: TextStub; toggle?: ToggleStub;
            constructor() { ui.rows.push(this); }
            setName(value: string) { this.name = value; return this; }
            setDesc(value: string) { this.desc = value; return this; }
            addText(build: (text: TextStub) => void) {
                this.text = { value: '', inputEl: new ElementStub(),
                    setValue(value: string) { this.value = value; return this; },
                    getValue() { return this.value; } };
                build(this.text); return this;
            }
            addToggle(build: (toggle: ToggleStub) => void) {
                this.toggle = { value: false, disabled: false, toggleEl: new ElementStub(), change: (_value: boolean) => {},
                    setValue(value: boolean) { this.value = value; return this; },
                    setDisabled(value: boolean) { this.disabled = value; return this; },
                    onChange(callback: (value: boolean) => void) { this.change = callback; return this; } };
                build(this.toggle); return this;
            }
        }
    };
});
function render() {
    const plugin = { settings: {}, saveSettings: vi.fn(async () => {}) };
    const scope = new Component(); scope.load();
    renderAiConfiguration(new ElementStub() as unknown as HTMLElement, plugin as unknown as RadialTimelinePlugin, scope);
    return { plugin, scope };
}
beforeEach(() => { ui.rows = []; ui.notices = []; });
describe('AI configuration behavior', () => {
    it('renders display and summary controls with citations locked off', () => {
        const { scope } = render();
        expect(ui.rows.map(row => row.name)).toEqual([
            'settings.ai.config.citationsName', 'settings.ai.config.pulseContextName',
            'settings.ai.config.synopsisMaxWordsName', 'settings.ai.config.targetSummaryName',
            'settings.ai.config.weakThresholdName', 'settings.ai.config.alsoUpdateSynopsisName'
        ]);
        expect(ui.rows[0].toggle).toMatchObject({ value: false, disabled: true });
        expect(ui.rows[1].desc).toBe('settings.ai.config.pulseContextDesc');
        scope.unload();
    });
    it('saves a numeric edit, restores the last saved value on invalid input, and disposes listeners', async () => {
        const { plugin, scope } = render();
        const input = ui.rows.find(row => row.name.endsWith('targetSummaryName'))!.text!;
        input.setValue('250'); input.inputEl.blur();
        await vi.waitFor(() => expect(plugin.settings).toHaveProperty('synopsisTargetWords', 250));
        await plugin.saveSettings.mock.results[0].value;
        input.setValue('999'); input.inputEl.blur();
        expect(input.getValue()).toBe('250');
        expect(ui.notices).toEqual(['settings.ai.config.targetSummaryInvalid']);
        scope.unload();
        input.setValue('300'); input.inputEl.blur();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(1);
        expect(plugin.settings).toHaveProperty('synopsisTargetWords', 250);
    });
    it('persists the display toggle', async () => {
        const { plugin, scope } = render();
        await ui.rows[1].toggle!.change(false);
        expect(plugin.settings).toHaveProperty('showFullTripletAnalysis', false);
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
        scope.unload();
    });
});
