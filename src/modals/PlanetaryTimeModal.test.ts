import { TooltipElement } from '../../tests/mocks/tooltipDom';
import { describe, expect, it, vi } from 'vitest';
import type { App } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PlanetaryProfile } from '../types';
import { PlanetaryTimeModal } from './PlanetaryTimeModal';

// Only the host DOM is stubbed; exercise the modal's real field callbacks,
// conversion and YAML output without rebuilding its controls between edits.
vi.mock('../../tests/mocks/obsidian', async importOriginal => {
    const actual = await importOriginal<typeof import('obsidian')>();
    const element = () => Object.assign(new TooltipElement(), { addClass() {}, createDiv: () => element() });
    return {
        ...actual,
        Setting: class extends actual.Setting {
            constructor(parent: HTMLElement) {
                super(parent);
                this.settingEl = element() as unknown as HTMLElement;
                this.controlEl = element() as unknown as HTMLElement;
            }
        },
        ExtraButtonComponent: class {
            extraSettingsEl = element();
            setIcon() { return this; }
            setTooltip() { return this; }
            onClick() { return this; }
        },
    };
});

function converter() {
    const profile: PlanetaryProfile = {
        id: 'qa', label: 'QA Planet', hoursPerDay: 25, daysPerWeek: 5, daysPerYear: 13,
    };
    const plugin = {
        settings: {
            planetaryProfiles: [profile], activePlanetaryProfileId: profile.id,
            planetaryTimeLastDirection: 'planet-to-earth',
        },
    } as unknown as RadialTimelinePlugin;
    const modal = new PlanetaryTimeModal({} as App, plugin);
    const changes = new Map<string, (value: string) => void>();
    modal['inputEl'] = {} as HTMLElement;
    modal['resultEl'] = {} as HTMLElement;
    modal['resultTextEl'] = { setText() {} } as unknown as HTMLElement;
    modal['addPlanetarySelectField'] = (_parent, _icon, _label, _options, _value, onChange, cls) => {
        if (cls) changes.set(cls, onChange);
        return {} as HTMLSelectElement;
    };
    modal['renderPlanetInput']();
    return {
        modal,
        hour: changes.get('ert-planetary-field--hour')!,
        minute: changes.get('ert-planetary-field--minute')!,
    };
}

describe('planetary converter consecutive time edits', () => {
    it('preserves the selected hour when minutes change, including hours above 23', () => {
        const { modal, hour, minute } = converter();
        hour('24');
        minute('5');
        expect(modal['planetTimeValue']).toBe('24:05');
        expect(modal['lastYaml']).toContain('@ 24:05');
        minute('30');
        expect(modal['lastYaml']).toContain('@ 24:30');
    });

    it('preserves the selected minutes when hours change repeatedly', () => {
        const { modal, hour, minute } = converter();
        minute('45');
        hour('1');
        expect(modal['planetTimeValue']).toBe('01:45');
        expect(modal['lastYaml']).toContain('@ 01:45');
        hour('0');
        expect(modal['lastYaml']).toContain('@ 00:45');
    });
});
