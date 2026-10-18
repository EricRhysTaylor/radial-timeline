import { t } from '../i18n';

/** Obsidian's saveData resolves even when its internal writeJson catches an I/O error. */
export async function saveSettingsVerified(
    data: unknown,
    write: (data: unknown) => Promise<void>,
    read: () => Promise<string>,
): Promise<void> {
    const expected = JSON.stringify(data, null, 2);
    await write(data);
    if (await read() !== expected) throw new Error(t('ui.main.settingsWriteNotConfirmed'));
}
