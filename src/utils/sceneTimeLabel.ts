import { formatLocalDateKey, parseDuration, parseWhenField } from './date';

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
    let description = `When: ${rawWhen || 'Not set'} · Duration: ${rawDuration || 'Not set'}`;
    if (start && hasClock) {
        const isDay = start.getHours() >= 6 && start.getHours() < 18;
        parts.push(`${isDay ? '☀' : '☾'} ${clock(start)}`);
        description += ' · Sun/moon indicates clock hours (day: 06:00–18:00), not local sunrise or sunset.';
    } else {
        parts.push(rawWhen || 'When not set');
    }
    parts.push(rawDuration || 'Duration not set');
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
