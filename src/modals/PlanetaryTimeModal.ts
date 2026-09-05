import { App, Modal, Setting as Settings, DropdownComponent, TextComponent, ButtonComponent, ExtraButtonComponent, setIcon } from 'obsidian';
import type RadialTimelinePlugin from '../main';
import type { PlanetaryProfile, PlanetaryTimeConversionDirection } from '../types';
import { convertFromEarth, convertToEarth, getPlanetaryMonthCount, getPlanetaryMonthDayCount, getPlanetaryMonthStartDay } from '../utils/planetaryTime';
import { t } from '../i18n';
import { IMPACT_FULL } from '../settings/SettingImpact';

export class PlanetaryTimeModal extends Modal {
    private plugin: RadialTimelinePlugin;
    private profiles: PlanetaryProfile[];
    private activeId: string | undefined;
    private direction: PlanetaryTimeConversionDirection = 'earth-to-planet';
    private earthDateValue: string;
    private earthTimeValue: string;
    private planetYearValue = '1';
    private planetMonthIndex = 0;
    private planetDayValue = '1';
    private planetTimeValue = '00:00';
    private inputEl: HTMLElement | null = null;
    private resultEl: HTMLElement | null = null;
    private resultTextEl: HTMLElement | null = null;
    private badgeEl: HTMLElement | null = null;
    private profileDropdown: DropdownComponent | null = null;
    private directionButtons: Record<PlanetaryTimeConversionDirection, HTMLButtonElement | null> = {
        'earth-to-planet': null,
        'planet-to-earth': null,
    };
    private lastProfile: PlanetaryProfile | null = null;
    private lastYaml: string | null = null;

    constructor(app: App, plugin: RadialTimelinePlugin) {
        super(app);
        this.plugin = plugin;
        this.profiles = plugin.settings.planetaryProfiles || [];
        this.activeId = plugin.settings.activePlanetaryProfileId || '';
        if (
            plugin.settings.planetaryTimeLastDirection === 'earth-to-planet'
            || plugin.settings.planetaryTimeLastDirection === 'planet-to-earth'
        ) {
            this.direction = plugin.settings.planetaryTimeLastDirection;
        }
        const now = new Date();
        this.earthDateValue = this.formatDateInput(now);
        this.earthTimeValue = this.formatTimeInput(now);
    }

    onOpen(): void {
        const { contentEl, modalEl } = this;
        contentEl.empty();

        // Apply generic modal shell + modal-specific class
        if (modalEl) {
            modalEl.classList.add('ert-ui', 'ert-scope--modal', 'ert-modal-shell');
            modalEl.setCssStyles({ width: '720px', maxWidth: '92vw' }); // SAFE: Modal sizing via inline styles (Obsidian pattern)
        }
        contentEl.addClass('ert-modal-container', 'ert-stack', 'ert-planetary-modal');

        // Header
        const header = contentEl.createDiv({ cls: 'ert-modal-header' });
        this.badgeEl = header.createSpan({ cls: 'ert-modal-badge' });
        this.syncHeaderBadge();
        header.createDiv({ cls: 'ert-modal-title', text: t('planetary.modal.title') });
        header.createDiv({ cls: 'ert-modal-subtitle', text: t('planetary.modal.converterDesc') });

        if (!this.profiles.length) {
            contentEl.createDiv({ text: t('planetary.modal.noProfile') });
            return;
        }

        const profileSetting = new Settings(contentEl)
            .setName(t('planetary.modal.activeProfile'))
            .setDesc(t('planetary.active.desc'));
        profileSetting.addDropdown(drop => {
            this.profileDropdown = drop;
            drop.addOption('', t('planetary.active.disabled'));
            this.profiles.forEach(p => { drop.addOption(p.id, p.label || 'Unnamed'); });
            drop.setValue(this.activeId || '');
            drop.onChange((value) => { void (async () => {
                this.activeId = value;
                this.plugin.settings.activePlanetaryProfileId = value;
                await this.plugin.saveSettings();
                this.plugin.onSettingChanged(IMPACT_FULL);
                this.syncHeaderBadge();
                this.renderInputs();
                this.renderResult();
            })(); });
        });

        const directionSetting = new Settings(contentEl)
            .setName(t('planetary.modal.directionLabel'))
            .setDesc(t('planetary.modal.directionDesc'));
        const directionControl = directionSetting.controlEl.createDiv({ cls: 'ert-planetary-direction' });
        this.directionButtons['earth-to-planet'] = this.createDirectionButton(directionControl, 'earth-to-planet');
        this.directionButtons['planet-to-earth'] = this.createDirectionButton(directionControl, 'planet-to-earth');
        this.syncDirectionButtons();

        this.inputEl = contentEl.createDiv({ cls: 'ert-planetary-modal-inputs' });
        this.renderInputs();

        const actions = contentEl.createDiv({ cls: 'ert-modal-actions' });
        new ButtonComponent(actions)
            .setButtonText(t('planetary.modal.convert'))
            .setCta()
            .onClick(() => this.renderResult());
        const resultRow = contentEl.createDiv({ cls: 'ert-planetary-modal-result-row' });
        this.resultEl = resultRow.createDiv({ cls: 'ert-planetary-modal-result' });
        const iconEl = this.resultEl.createDiv({ cls: 'ert-planetary-result-icon' });
        setIcon(iconEl, 'orbit');
        this.resultTextEl = this.resultEl.createDiv({ cls: 'ert-planetary-result-text' });
        const copyButton = new ExtraButtonComponent(resultRow)
            .setIcon('copy')
            .setTooltip('Copy YAML')
            .onClick(() => this.copyYaml());
        copyButton.extraSettingsEl.addClass('ert-iconBtn', 'ert-planetary-copy-button');
        this.renderResult();
    }

    private createDirectionButton(parent: HTMLElement, direction: PlanetaryTimeConversionDirection): HTMLButtonElement {
        const button = parent.createEl('button', {
            text: this.getDirectionLabel(direction),
            cls: 'ert-planetary-direction-button',
            attr: { type: 'button' },
        });
        button.addEventListener('click', () => {
            this.setDirection(direction);
        });
        return button;
    }

    private syncDirectionButtons(): void {
        this.syncHeaderBadge();
        (Object.keys(this.directionButtons) as PlanetaryTimeConversionDirection[]).forEach(direction => {
            const button = this.directionButtons[direction];
            if (!button) return;
            button.setText(this.getDirectionLabel(direction));
            button.classList.toggle('is-active', direction === this.direction);
            button.setAttribute('aria-pressed', direction === this.direction ? 'true' : 'false');
        });
    }

    private setDirection(direction: PlanetaryTimeConversionDirection): void {
        if (this.direction === direction) return;
        this.direction = direction;
        this.plugin.settings.planetaryTimeLastDirection = direction;
        void this.plugin.saveSettings();
        this.syncDirectionButtons();
        this.renderInputs();
        this.renderResult();
    }

    private syncHeaderBadge(): void {
        if (!this.badgeEl) return;
        this.badgeEl.setText(`${t('planetary.heading')} · ${this.getDirectionLabel(this.direction)}`);
    }

    private getDirectionLabel(direction: PlanetaryTimeConversionDirection): string {
        const profileName = this.getActiveProfile()?.label?.trim() || t('planetary.modal.planetFallback');
        return direction === 'earth-to-planet'
            ? t('planetary.modal.earthToPlanet', { planet: profileName })
            : t('planetary.modal.planetToEarth', { planet: profileName });
    }

    private renderInputs(): void {
        if (!this.inputEl) return;
        this.inputEl.empty();
        this.syncDirectionButtons();
        if (this.direction === 'earth-to-planet') {
            this.renderEarthInput();
        } else {
            this.renderPlanetInput();
        }
    }

    private renderEarthInput(): void {
        if (!this.inputEl) return;
        const inputSetting = new Settings(this.inputEl)
            .setName(t('planetary.modal.earthDatetimeLabel'))
            .setDesc(t('planetary.modal.earthDatetimeDesc'));
        inputSetting.settingEl.addClass('ert-planetary-earth-input-setting');
        inputSetting.addText((text: TextComponent) => {
            text.inputEl.type = 'date';
            text.inputEl.addClass('ert-input', 'ert-input--md');
            text.setValue(this.earthDateValue);
            text.onChange((value) => {
                this.earthDateValue = value;
            });
        });

        inputSetting.addText((text: TextComponent) => {
            text.inputEl.type = 'time';
            text.inputEl.step = '60';
            text.inputEl.addClass('ert-input', 'ert-input--md');
            text.setValue(this.earthTimeValue);
            text.onChange((value) => {
                this.earthTimeValue = value;
            });
        });

        inputSetting.addExtraButton((button: ExtraButtonComponent) => {
            button.setIcon('clock');
            button.setTooltip(t('planetary.modal.now'));
            button.extraSettingsEl.addClass('ert-iconBtn', 'ert-planetary-earth-now-button');
            button.onClick(() => {
                const now = new Date();
                this.earthDateValue = this.formatDateInput(now);
                this.earthTimeValue = this.formatTimeInput(now);
                this.renderInputs();
                this.renderResult();
            });
        });
    }

    private renderPlanetInput(): void {
        if (!this.inputEl) return;
        const profile = this.getActiveProfile();
        const profileName = profile?.label?.trim() || t('planetary.modal.planetFallback');
        const monthCount = profile ? getPlanetaryMonthCount(profile) : 12;
        this.planetMonthIndex = Math.max(0, Math.min(monthCount - 1, this.planetMonthIndex));
        this.clampPlanetDay();

        const dateSetting = new Settings(this.inputEl)
            .setName(t('planetary.modal.planetDateLabel', { planet: profileName }))
            .setDesc(t('planetary.modal.planetDateDesc'));
        dateSetting.settingEl.addClass('ert-planetary-input-setting', 'ert-planetary-date-input-setting');
        const dateControls = dateSetting.controlEl.createDiv({ cls: 'ert-planetary-field-row' });
        this.addPlanetarySelectField(dateControls, 'calendar-clock', t('planetary.modal.yearField'), this.buildYearOptions(), this.planetYearValue, value => {
            this.planetYearValue = value;
            this.renderInputs();
            this.renderResult();
        }, 'ert-planetary-field--year');
        this.addPlanetarySelectField(dateControls, 'calendar-days', t('planetary.modal.monthField'), this.buildMonthOptions(profile, monthCount), String(this.planetMonthIndex), value => {
            this.planetMonthIndex = Number(value);
            this.clampPlanetDay();
            this.renderInputs();
            this.renderResult();
        }, 'ert-planetary-field--month');
        this.addPlanetarySelectField(dateControls, 'hash', t('planetary.modal.dayField'), this.buildDayOptions(profile), this.planetDayValue, value => {
            this.planetDayValue = value;
            this.renderResult();
        }, 'ert-planetary-field--day');
        const nowButton = new ExtraButtonComponent(dateControls)
            .setIcon('clock')
            .setTooltip(t('planetary.modal.todayTooltip'))
            .onClick(() => this.setPlanetaryFieldsFromEarthNow());
        nowButton.extraSettingsEl.addClass('ert-iconBtn', 'ert-planetary-now-button');

        const timeSetting = new Settings(this.inputEl)
            .setName(t('planetary.modal.planetTimeLabel'))
            .setDesc(t('planetary.modal.planetTimeDesc'));
        timeSetting.settingEl.addClass('ert-planetary-time-input-setting');
        const timeControls = timeSetting.controlEl.createDiv({ cls: 'ert-planetary-field-row' });
        const time = this.parsePlanetTime(this.planetTimeValue) ?? { hours: 0, minutes: 0 };
        this.addPlanetarySelectField(timeControls, 'clock-3', t('planetary.modal.hourField'), this.buildHourOptions(profile), String(time.hours), value => {
            this.planetTimeValue = `${String(Number(value)).padStart(2, '0')}:${String(time.minutes).padStart(2, '0')}`;
            this.renderResult();
        }, 'ert-planetary-field--hour');
        this.addPlanetarySelectField(timeControls, 'timer', t('planetary.modal.minuteField'), this.buildMinuteOptions(), String(time.minutes), value => {
            this.planetTimeValue = `${String(time.hours).padStart(2, '0')}:${String(Number(value)).padStart(2, '0')}`;
            this.renderResult();
        }, 'ert-planetary-field--minute');
    }

    private addPlanetarySelectField(
        parent: HTMLElement,
        icon: string,
        label: string,
        options: Array<{ value: string; label: string }>,
        value: string,
        onChange: (value: string) => void,
        extraClass = ''
    ): HTMLSelectElement {
        const field = parent.createDiv({ cls: `ert-planetary-field ${extraClass}`.trim() });
        const iconEl = field.createSpan({ cls: 'ert-planetary-field__icon' });
        setIcon(iconEl, icon);
        const labelEl = field.createSpan({ cls: 'ert-planetary-field__label', text: label });
        const selectEl = field.createEl('select', {
            cls: 'ert-input ert-planetary-field__select',
            attr: { 'aria-label': label },
        });
        options.forEach(option => {
            selectEl.createEl('option', { text: option.label, value: option.value });
        });
        if (!options.some(option => option.value === value)) {
            selectEl.createEl('option', { text: value, value });
        }
        selectEl.value = value;
        selectEl.addEventListener('change', () => onChange(selectEl.value));
        labelEl.addEventListener('click', () => selectEl.focus());
        return selectEl;
    }

    private buildYearOptions(): Array<{ value: string; label: string }> {
        const currentYear = Math.max(1, Math.round(Number(this.planetYearValue) || 1));
        const years = new Set<number>();
        for (let year = 1; year <= 120; year++) years.add(year);
        years.add(currentYear);
        return [...years]
            .sort((a, b) => a - b)
            .map(year => ({ value: String(year), label: String(year) }));
    }

    private buildMonthOptions(profile: PlanetaryProfile | null, monthCount: number): Array<{ value: string; label: string }> {
        const options: Array<{ value: string; label: string }> = [];
        for (let index = 0; index < monthCount; index++) {
            const monthName = profile?.monthNames?.[index]?.trim();
            options.push({ value: String(index), label: this.formatIndexedLabel(index, monthName, String(index + 1)) });
        }
        return options;
    }

    private buildDayOptions(profile: PlanetaryProfile | null): Array<{ value: string; label: string }> {
        const maxDay = profile ? getPlanetaryMonthDayCount(profile, this.planetMonthIndex) : 31;
        return Array.from({ length: maxDay }, (_, index) => {
            const day = index + 1;
            const weekdayName = this.getWeekdayNameForLocalDay(profile, day);
            return { value: String(day), label: this.formatIndexedLabel(index, weekdayName, String(day)) };
        });
    }

    private getWeekdayNameForLocalDay(profile: PlanetaryProfile | null, localDayOfMonth: number): string | undefined {
        if (!profile?.weekdayNames?.length) return undefined;
        const daysPerWeek = Math.max(1, Math.floor(profile.daysPerWeek || profile.weekdayNames.length));
        const localYear = Math.max(1, Math.round(Number(this.planetYearValue) || 1));
        const localDaysPerYear = Math.max(1, Math.floor(profile.daysPerYear));
        const localDayOfYear = getPlanetaryMonthStartDay(profile, this.planetMonthIndex) + localDayOfMonth - 1;
        const fullLocalDays = ((localYear - 1) * localDaysPerYear) + localDayOfYear;
        const weekdayIndex = this.mod(fullLocalDays, daysPerWeek);
        return profile.weekdayNames[weekdayIndex]?.trim();
    }

    private formatIndexedLabel(index: number, name: string | undefined, fallback: string): string {
        const ordinal = index + 1;
        const label = name?.trim();
        if (!label || label === String(ordinal)) return fallback;
        return `${ordinal} · ${label}`;
    }

    private mod(value: number, divisor: number): number {
        const result = value % divisor;
        return result < 0 ? result + divisor : result;
    }

    private buildHourOptions(profile: PlanetaryProfile | null): Array<{ value: string; label: string }> {
        const hourCount = Math.max(1, Math.ceil(profile?.hoursPerDay || 24));
        return Array.from({ length: hourCount }, (_, hour) => ({
            value: String(hour),
            label: String(hour).padStart(2, '0'),
        }));
    }

    private buildMinuteOptions(): Array<{ value: string; label: string }> {
        return Array.from({ length: 60 }, (_, minute) => ({
            value: String(minute),
            label: String(minute).padStart(2, '0'),
        }));
    }

    private setPlanetaryFieldsFromEarthNow(): void {
        const profile = this.getActiveProfile();
        if (!profile) return;
        const conversion = convertFromEarth(new Date(), profile);
        if (!conversion) return;
        this.planetYearValue = String(conversion.localYear);
        this.planetMonthIndex = conversion.localMonthIndex;
        this.planetDayValue = String(conversion.localDayOfMonth);
        this.planetTimeValue = `${String(conversion.localHours).padStart(2, '0')}:${String(conversion.localMinutes).padStart(2, '0')}`;
        this.renderInputs();
        this.renderResult();
    }

    private renderResult(): void {
        if (!this.resultEl || !this.resultTextEl) return;
        this.lastProfile = null;
        this.lastYaml = null;
        const profile = this.getActiveProfile();
        if (!profile) {
            this.resultTextEl.setText(t('planetary.modal.noProfile'));
            return;
        }
        if (this.direction === 'planet-to-earth') {
            this.renderPlanetToEarthResult(profile);
            return;
        }
        this.renderEarthToPlanetResult(profile);
    }

    private renderEarthToPlanetResult(profile: PlanetaryProfile): void {
        const resultTextEl = this.resultTextEl;
        if (!resultTextEl) return;
        let parsed: Date | null = null;
        try {
            if (!this.earthDateValue) {
                parsed = null;
            } else {
                const time = this.earthTimeValue || '00:00';
                const maybe = new Date(`${this.earthDateValue}T${time}`);
                parsed = Number.isNaN(maybe.getTime()) ? null : maybe;
            }
        } catch {
            parsed = null;
        }
        if (!parsed) {
            resultTextEl.setText(t('planetary.modal.invalid'));
            return;
        }
        const conversion = convertFromEarth(parsed, profile);
        if (!conversion) {
            resultTextEl.setText(t('planetary.preview.invalid'));
            return;
        }
        this.lastProfile = profile;
        this.lastYaml = [
            'Planetary:',
            `  profile: ${profile.label || 'Unknown'}`,
            `  earth: "${this.formatDateTimeInput(parsed)}"`,
            `  local: "${conversion.formatted}"`,
        ].join('\n');
        resultTextEl.setText(conversion.formatted);
    }

    private renderPlanetToEarthResult(profile: PlanetaryProfile): void {
        const resultTextEl = this.resultTextEl;
        if (!resultTextEl) return;
        const time = this.parsePlanetTime(this.planetTimeValue);
        const localYear = Number(this.planetYearValue);
        const localDayOfMonth = Number(this.planetDayValue);
        if (!time || !Number.isFinite(localYear) || !Number.isFinite(localDayOfMonth)) {
            resultTextEl.setText(t('planetary.modal.invalidPlanet'));
            return;
        }
        const conversion = convertToEarth({
            localYear,
            localMonthIndex: this.planetMonthIndex,
            localDayOfMonth,
            localHours: time.hours,
            localMinutes: time.minutes,
        }, profile);
        if (!conversion) {
            resultTextEl.setText(t('planetary.modal.invalidPlanet'));
            return;
        }
        const earthFormatted = this.formatDateTimeInput(conversion.earthDate);
        this.lastProfile = profile;
        this.lastYaml = [
            'Planetary:',
            `  profile: ${profile.label || 'Unknown'}`,
            `  local: "${conversion.formatted}"`,
            `  earth: "${earthFormatted}"`,
        ].join('\n');
        resultTextEl.setText(`Earth ${earthFormatted}`);
    }

    private getActiveProfile(): PlanetaryProfile | null {
        if (!this.profiles.length) return null;
        if (!this.activeId) return null;
        const match = this.profiles.find(p => p.id === this.activeId);
        return match || null;
    }

    private formatDateInput(d: Date): string {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    private formatTimeInput(d: Date): string {
        const hours = String(d.getHours()).padStart(2, '0');
        const minutes = String(d.getMinutes()).padStart(2, '0');
        return `${hours}:${minutes}`;
    }

    private formatDateTimeInput(d: Date): string {
        return `${this.formatDateInput(d)} ${this.formatTimeInput(d)}`;
    }

    private parsePlanetTime(value: string): { hours: number; minutes: number } | null {
        const match = value.trim().match(/^(\d{1,3}):([0-5]\d)$/);
        if (!match) return null;
        return {
            hours: Number(match[1]),
            minutes: Number(match[2]),
        };
    }

    private clampPlanetDay(): void {
        const profile = this.getActiveProfile();
        if (!profile) return;
        const maxDay = getPlanetaryMonthDayCount(profile, this.planetMonthIndex);
        const current = Number(this.planetDayValue);
        if (!Number.isFinite(current) || current < 1) {
            this.planetDayValue = '1';
        } else if (current > maxDay) {
            this.planetDayValue = String(maxDay);
        }
    }

    private copyYaml(): void {
        if (!this.lastProfile || !this.lastYaml) return;
        navigator.clipboard?.writeText(this.lastYaml).catch(() => {
            // Obsidian desktop supports clipboard; ignore failures silently
        });
    }
}
