import { getFrontMatterInfo, Notice, parseYaml, Setting, TFile } from 'obsidian';
import type RadialTimelinePlugin from '../../main';
import { ErtModal } from '../../ui/ErtModal';
import { t } from '../../i18n';
import { reconcileReferenceSelection } from './selection';
import { getCustomKeys, getTemplateParts } from '../../utils/yamlTemplateNormalize';
import { getActiveFrontmatterMappings, normalizeFrontmatterKeys } from '../../utils/frontmatter';
import { extractBodyAfterFrontmatter } from '../../utils/frontmatterDocument';
import { openFromWheel } from '../../timetable/readingPane';
import { refreshTimetableViews } from '../../timetable/timetableRegistry';
import { locateReferencePassage, readTimeReferences, referenceDateLabel, REFERENCE_KINDS, TIME_REFERENCES_KEY, type TimeReference } from './model';

function frontmatter(source: string): Record<string, unknown> {
    const info = getFrontMatterInfo(source);
    const parsed: unknown = info.exists ? parseYaml(info.frontmatter) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error(t('timeReferences.notScene'));
    return parsed as Record<string, unknown>; // SAFE: YAML object validated above.
}

export function isReferenceScene(plugin: RadialTimelinePlugin, file: TFile): boolean {
    const raw = plugin.app.metadataCache.getFileCache(file)?.frontmatter;
    return !!raw && normalizeFrontmatterKeys(raw, getActiveFrontmatterMappings(plugin.settings)).Class === 'Scene';
}

export async function openTimeReference(plugin: RadialTimelinePlugin, reference: TimeReference, from: Element): Promise<void> {
    try {
        const file = plugin.app.vault.getAbstractFileByPath(reference.path);
        if (!(file instanceof TFile)) throw new Error(t('timeReferences.stale'));
        const source = await plugin.app.vault.cachedRead(file);
        const latest = readTimeReferences(frontmatter(source)[TIME_REFERENCES_KEY], file.path).references.find(ref => ref.key === reference.key);
        if (!latest) throw new Error(t('timeReferences.stale'));
        let highlight;
        if (latest.passage) {
            const body = extractBodyAfterFrontmatter(source, getFrontMatterInfo(source));
            const match = locateReferencePassage(body, latest.passage);
            if (!match) { new Notice(t('timeReferences.detached')); return; }
            const offset = source.length - body.length;
            highlight = { content: source, matches: [[offset + match.from, offset + match.to] as [number, number]] };
        }
        await openFromWheel(plugin.app, file, from, highlight);
    } catch (error) { new Notice(String(error)); }
}

class TimeReferencesModal extends ErtModal {
    private raw: unknown;
    private undo: { value: unknown } | null = null;
    constructor(private plugin: RadialTimelinePlugin, private file: TFile, private passage: string) { super(plugin.app); }
    onOpen(): void { this.applyShell({ size: 'md' }); void this.load().catch(error => new Notice(String(error))); }
    private async load(): Promise<void> {
        const raw = frontmatter(await this.plugin.app.vault.cachedRead(this.file));
        if (normalizeFrontmatterKeys(raw, getActiveFrontmatterMappings(this.plugin.settings)).Class !== 'Scene') throw new Error(t('timeReferences.notScene'));
        this.raw = raw[TIME_REFERENCES_KEY]; this.render();
    }
    private async write(value: unknown): Promise<void> {
        const expected = JSON.stringify(this.raw);
        await this.plugin.app.fileManager.processFrontMatter(this.file, (fm: Record<string, unknown>) => {
            if (!getCustomKeys('Scene', this.plugin.settings).includes(TIME_REFERENCES_KEY)) throw new Error(t('timeReferences.enrollDescription'));
            if (normalizeFrontmatterKeys(fm, getActiveFrontmatterMappings(this.plugin.settings)).Class !== 'Scene'
                || JSON.stringify(fm[TIME_REFERENCES_KEY]) !== expected) throw new Error(t('timeReferences.stale'));
            if (value === undefined) delete fm[TIME_REFERENCES_KEY];
            else fm[TIME_REFERENCES_KEY] = value;
        });
        this.plugin.refreshTimelineIfNeeded(this.file);
        refreshTimetableViews(); await this.load();
    }
    private async change(value: unknown): Promise<void> {
        const before = this.raw;
        try { await this.write(value); this.undo = { value: before }; this.render(); }
        catch (error) { new Notice(String(error)); }
    }
    private render(index: number | null = null): void {
        this.contentEl.empty();
        this.mountHeader({ title: t('timeReferences.title'), subtitle: this.file.basename });
        const enrolled = getCustomKeys('Scene', this.plugin.settings).includes(TIME_REFERENCES_KEY);
        if (!enrolled) {
            new Setting(this.contentEl).setName(t('timeReferences.enroll')).setDesc(t('timeReferences.enrollDescription')).addButton(button => button
                .setButtonText(t('timeReferences.enroll')).onClick(async () => {
                    button.setDisabled(true);
                    const previous = this.plugin.settings.sceneYamlTemplates;
                    try {
                        const parts = getTemplateParts('Scene', this.plugin.settings);
                        if (!getCustomKeys('Scene', this.plugin.settings).includes(TIME_REFERENCES_KEY)) {
                            this.plugin.settings.sceneYamlTemplates = { base: parts.base, advanced: `${parts.advanced.trimEnd()}\n${TIME_REFERENCES_KEY}: []` };
                            await this.plugin.saveSettings();
                        }
                        this.render();
                    } catch (error) {
                        this.plugin.settings.sceneYamlTemplates = previous;
                        button.setDisabled(false); new Notice(String(error));
                    }
                }));
            return;
        }
        if (this.raw !== undefined && !Array.isArray(this.raw)) {
            this.contentEl.createEl('p', { text: t('timeReferences.invalidArray') }); return;
        }
        const entries: unknown[] = Array.isArray(this.raw) ? this.raw : [];
        const snapshot = readTimeReferences(this.raw, this.file.path);
        entries.forEach((entry, i) => {
            const reference = snapshot.references.find(ref => ref.index === i);
            const title = reference ? `${reference.label} · ${referenceDateLabel(reference)}` : t('timeReferences.invalidEntry', { number: i + 1 });
            new Setting(this.contentEl).setName(title).addButton(button => button.setButtonText(t('timeReferences.edit')).onClick(() => this.render(i)))
                .addButton(button => button.setButtonText(t('timeReferences.remove')).onClick(() => { void this.change(entries.filter((_, n) => n !== i)); }));
        });
        const original = index !== null ? entries[index] : undefined;
        const value: Record<string, unknown> = original && typeof original === 'object' && !Array.isArray(original)
            ? { ...original } : {};
        let label = typeof value.Label === 'string' ? value.Label : '';
        let when = typeof value.When === 'string' ? value.When : '';
        let end = typeof value.End === 'string' ? value.End : '';
        let kind = REFERENCE_KINDS.some(k => k === value.Kind) ? String(value.Kind) : 'mention';
        let passage = typeof value.Passage === 'string' ? value.Passage : index === null ? this.passage : '';
        new Setting(this.contentEl).setHeading().setName(t(index === null ? 'timeReferences.add' : 'timeReferences.edit'));
        new Setting(this.contentEl).setName(t('timeReferences.label')).addText(input => input.setValue(label).onChange(text => { label = text; }));
        new Setting(this.contentEl).setName(t('timeReferences.when')).setDesc(t('timeReferences.dateHelp')).addText(input => input.setValue(when).onChange(text => { when = text; }));
        new Setting(this.contentEl).setName(t('timeReferences.end')).addText(input => input.setValue(end).onChange(text => { end = text; }));
        new Setting(this.contentEl).setName(t('timeReferences.kind')).addDropdown(input => {
            REFERENCE_KINDS.forEach(key => input.addOption(key, t(`timeReferences.kinds.${key}`)));
            input.setValue(kind).onChange(text => { kind = text; });
        });
        new Setting(this.contentEl).setName(t('timeReferences.passage')).setDesc(t('timeReferences.passageHelp'))
            .addTextArea(input => input.setValue(passage).onChange(text => { passage = text; }));
        new Setting(this.contentEl).addButton(button => button.setButtonText(t('timeReferences.save')).setCta().onClick(() => {
            const next: Record<string, unknown> = { ...value, Label: label.trim(), When: when.trim(), Kind: kind };
            if (end.trim()) next.End = end.trim(); else delete next.End;
            if (passage.trim()) next.Passage = passage; else delete next.Passage;
            const checked = readTimeReferences([next], this.file.path);
            if (checked.problems.length) { new Notice(t('timeReferences.invalid', { reason: t(`timeReferences.problems.${checked.problems[0].reason}`) })); return; }
            const updated = [...entries];
            if (index === null) updated.push(next); else updated[index] = next;
            void this.change(updated);
        })).addButton(button => button.setButtonText(t('timeReferences.new')).onClick(() => this.render()));
        if (this.undo) new Setting(this.contentEl).addButton(button => button.setButtonText(t('timeReferences.undo')).onClick(async () => {
            try { const undo = this.undo!; await this.write(undo.value); this.undo = null; this.render(); }
            catch (error) { new Notice(String(error)); }
        }));
    }
}

export function manageTimeReferences(plugin: RadialTimelinePlugin, file: TFile, passage = ''): void {
    new TimeReferencesModal(plugin, file, passage).open();
}

/** Visible file/editor menu actions; no global shortcut or automatic prose scan. */
export function registerTimeReferences(plugin: RadialTimelinePlugin): void {
    plugin.registerEvent(plugin.app.metadataCache.on('changed', (file, _data, cache) => {
        const keys = readTimeReferences(cache.frontmatter?.[TIME_REFERENCES_KEY], file.path).references.map(reference => reference.key);
        reconcileReferenceSelection(file.path, new Set(keys));
    }));
    plugin.registerEvent(plugin.app.vault.on('delete', file => reconcileReferenceSelection(file.path, new Set())));
    plugin.registerEvent(plugin.app.vault.on('rename', (_file, oldPath) => reconcileReferenceSelection(oldPath, new Set())));
    plugin.registerEvent(plugin.app.workspace.on('file-menu', (menu, file) => {
        if (file instanceof TFile && isReferenceScene(plugin, file)) menu.addItem(item => item.setTitle(t('timeReferences.title')).setIcon('history')
            .onClick(() => manageTimeReferences(plugin, file)));
    }));
    plugin.registerEvent(plugin.app.workspace.on('editor-menu', (menu, editor, context) => {
        if (context.file && isReferenceScene(plugin, context.file)) menu.addItem(item => item.setTitle(t('timeReferences.add')).setIcon('history')
            .onClick(() => { if (context.file) manageTimeReferences(plugin, context.file, editor.getSelection()); }));
    }));
}
