import { App, ButtonComponent, Setting } from 'obsidian';
import { ErtModal } from '../ui/ErtModal';
import { setAccessibleLabel } from '../utils/domTooltip';
import { t } from '../i18n';
import { coloringDateLabel, hasColoringDates, readDateGrouping } from './coloringDates';
import { MAX_COLOR_VALUES, planConfiguredColoring, type ColoringMatch, type SavedColoring } from './timetableModel';

/** Draft the categories/date groups for one view; only Apply writes the view. */
export class TimetableColoringModal extends ErtModal {
    constructor(app: App, private readonly propertyName: string, private readonly rows: Array<{ path: string; value: unknown; complete?: boolean }>,
        private readonly slots: number[], private readonly saved: SavedColoring, private readonly apply: (config: SavedColoring) => void) {
        super(app);
    }

    onOpen(): void {
        this.contentEl.empty();
        this.applyShell({ size: 'md', containerClasses: ['ert-color-key-editor'] });
        this.mountHeader({ title: t('ui.timetable.colorKey.editTitle', { property: this.propertyName }), subtitle: t('ui.timetable.colorKey.chooseHint', { max: MAX_COLOR_VALUES }) });
        const today = new Date();
        let grouping: string = this.saved.grouping?.kind ?? 'categories';
        let start = this.saved.grouping?.kind === 'range' ? this.saved.grouping.start : '';
        let end = this.saved.grouping?.kind === 'range' ? this.saved.grouping.end : '';
        const initial = planConfiguredColoring(this.rows, this.saved, this.slots, today);
        let match: ColoringMatch = this.saved.match ?? (this.saved.grouping || (initial.kind === 'ok' && !initial.multiValue) ? 'any' : 'all');
        let palette = this.saved.palette ? [...this.saved.palette] : undefined;
        let search = '';
        let selected = new Set<string>();

        const form = this.contentEl.createDiv({ cls: 'ert-stack ert-color-key-editor__form' });
        const ranges = form.createDiv({ cls: 'ert-color-key-editor__range' });
        const message = form.createDiv({ cls: 'ert-color-key-editor__message', attr: { role: 'status' } });
        const list = form.createDiv({ cls: 'ert-color-key-editor__list' });
        const actions = this.mountActions();
        const save = new ButtonComponent(actions).setButtonText(t('ui.timetable.colorKey.apply')).setCta();
        new ButtonComponent(actions).setButtonText(t('common.cancel')).onClick(() => this.close());
        const configuration = (): SavedColoring | null => {
            const dateGrouping = grouping === 'categories' ? undefined : readDateGrouping({ kind: grouping, start, end });
            if (dateGrouping === null) return null;
            const config: SavedColoring = { schemaVersion: 1, property: this.saved.property, picks: [], match, palette };
            if (dateGrouping) config.grouping = dateGrouping;
            return config;
        };
        const refresh = (reset = false) => {
            const config = configuration();
            ranges.toggle(grouping === 'range');
            list.empty();
            if (!config) {
                message.setText(t('ui.timetable.colorKey.invalidRange'));
                save.setDisabled(true);
                return;
            }
            const plan = planConfiguredColoring(this.rows, config, this.slots, today);
            if (plan.kind === 'none') {
                message.setText(t('ui.timetable.coloringNone', { property: this.propertyName }));
                save.setDisabled(true);
                return;
            }
            if (reset) selected = new Set(plan.legend.map(entry => entry.value));
            message.setText(t('ui.timetable.colorKey.chosen', { count: selected.size, max: MAX_COLOR_VALUES, total: plan.categories.length }));
            save.setDisabled(selected.size === 0);
            const visible = plan.categories.filter(entry => coloringDateLabel(entry.value, config.grouping).toLocaleLowerCase().includes(search.toLocaleLowerCase()));
            if (visible.length === 0) list.createDiv({ text: t('ui.timetable.colorKey.noMatches'), cls: 'ert-section-desc' });
            for (const category of visible) {
                const label = list.createEl('label', { cls: 'ert-color-key-editor__category' });
                const checkbox = label.createEl('input', { type: 'checkbox' });
                checkbox.checked = selected.has(category.value);
                checkbox.disabled = !checkbox.checked && selected.size >= MAX_COLOR_VALUES;
                label.createSpan({ text: coloringDateLabel(category.value, config.grouping) });
                label.createSpan({ cls: 'ert-color-key-editor__count', text: String(category.count) });
                checkbox.addEventListener('change', () => {
                    if (checkbox.checked) selected.add(category.value); else selected.delete(category.value);
                    refresh();
                    const inputs = list.querySelectorAll<HTMLInputElement>('input');
                    inputs[visible.indexOf(category)]?.focus();
                });
            }
        };
        const groupingSetting = new Setting(form).setName(t('ui.timetable.colorKey.groupBy')).addDropdown(dropdown => {
            for (const kind of ['categories', 'day', 'month', 'year', 'range', 'due']) dropdown.addOption(kind, t(`ui.timetable.colorKey.group.${kind}`));
            dropdown.setValue(grouping).onChange(value => {
                grouping = value;
                match = value === 'categories' ? 'all' : 'any';
                matchSelect.setValue(match);
                matchSetting.settingEl.toggle(value === 'categories');
                palette = undefined;
                refresh(true);
            });
        });
        form.prepend(groupingSetting.settingEl);
        groupingSetting.settingEl.toggle(this.saved.grouping !== undefined || hasColoringDates(this.rows));
        let matchSelect!: import('obsidian').DropdownComponent;
        const matchSetting = new Setting(form).setName(t('ui.timetable.colorKey.match')).addDropdown(dropdown => {
            matchSelect = dropdown;
            dropdown.addOption('all', t('ui.timetable.colorKey.matchAll')).addOption('any', t('ui.timetable.colorKey.matchAny'))
                .setValue(match).onChange(value => { match = value === 'any' ? 'any' : 'all'; });
        });
        matchSetting.settingEl.toggle(grouping === 'categories');
        groupingSetting.settingEl.after(matchSetting.settingEl);
        for (const boundary of ['start', 'end'] as const) {
            const label = ranges.createEl('label', { cls: 'ert-stack' });
            const text = t(boundary === 'start' ? 'ui.timetable.colorKey.from' : 'ui.timetable.colorKey.to');
            label.createSpan({ text });
            const input = label.createEl('input', { type: 'date', value: boundary === 'start' ? start : end });
            setAccessibleLabel(input, text);
            input.addEventListener('change', () => {
                if (boundary === 'start') start = input.value; else end = input.value;
                palette = undefined;
                refresh(true);
            });
        }
        const searchSetting = new Setting(form).setName(t('ui.timetable.colorKey.search')).addSearch(input => {
            input.setPlaceholder(t('ui.timetable.colorKey.search')).onChange(value => { search = value; refresh(); });
        });
        ranges.after(searchSetting.settingEl);
        save.onClick(() => {
            const config = configuration();
            if (!config || selected.size === 0 || selected.size > MAX_COLOR_VALUES) return;
            config.palette = [...selected];
            const unchangedGroups = JSON.stringify(config.grouping) === JSON.stringify(this.saved.grouping);
            config.picks = unchangedGroups ? this.saved.picks.filter(pick => selected.has(pick)) : [];
            this.apply(config);
            this.close();
        });
        refresh(true);
    }
}
