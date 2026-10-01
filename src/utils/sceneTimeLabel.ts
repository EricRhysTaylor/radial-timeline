import { formatLocalDateKey, parseDuration, parseWhenField } from './date';
import { t } from '../i18n';

/** Display author timing without inventing a clock time for partial dates. */
export function sceneTimeLabel(when: unknown, duration: unknown): { text: string; description: string } {
    const rawWhen = typeof when === 'string' ? when.trim() : '';
    const rawDuration = typeof duration === 'string' || typeof duration === 'number'
        ? String(duration).trim() : '';
    const start = parseWhenField(rawWhen);
    const hasClock = /\d{1,2}:\d{2}|\d\s*(?:am|pm)\b/i.test(rawWhen);
    const clock = (date: Date): string => date.toLocaleTimeString([], {
        hour: 'numeric', minute: '2-digit',
        ...(date.getSeconds() ? { second: '2-digit' as const } : {})
    });
    const parts: string[] = [];
    let description = t('sceneTime.label.description', { when: rawWhen || t('sceneTime.label.notSet'), duration: rawDuration || t('sceneTime.label.notSet') });
    if (start && hasClock) {
        const isDay = start.getHours() >= 6 && start.getHours() < 18;
        parts.push(`${isDay ? '☀' : '☾'} ${clock(start)} ${start.toLocaleDateString([], { weekday: 'short' })}`);
        description += ` · ${t('sceneTime.label.sunMoon')}`;
    } else {
        parts.push(rawWhen || t('sceneTime.label.whenNotSet'));
    }
    parts.push(rawDuration || t('sceneTime.label.durationNotSet'));
    const durationMs = parseDuration(rawDuration);
    if (start && hasClock && durationMs !== null && Number.isFinite(durationMs)) {
        const end = new Date(start.getTime() + durationMs);
        if (Number.isFinite(end.getTime())) {
            const endDate = formatLocalDateKey(end) !== formatLocalDateKey(start)
                ? ` (${formatLocalDateKey(end)})` : '';
            parts[parts.length - 1] += ` → ${clock(end)}${endDate}`;
        }
    }
    return { text: parts.join(' · '), description };
}
