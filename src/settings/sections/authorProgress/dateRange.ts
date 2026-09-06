export const formatDateRange = (start?: string, target?: string): string => {
    if (!start || !target) return '';
    return `${start} to ${target}`;
};

const parseIsoDate = (value: string): number | null => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const parsed = new Date(`${value}T00:00:00`);
    const time = parsed.getTime();
    if (!Number.isFinite(time)) return null;
    const [year, month, day] = value.split('-').map(Number);
    return parsed.getFullYear() === year && parsed.getMonth() + 1 === month && parsed.getDate() === day ? time : null;
};

export const parseDateRange = (value: string): { start?: string; target?: string; error?: string } => {
    const matches = value.match(/\d{4}-\d{2}-\d{2}/g);
    if (!matches || matches.length < 2) {
        return { error: 'Enter both start and target dates (YYYY-MM-DD).' };
    }
    const [start, target] = matches;
    const startTime = parseIsoDate(start);
    const targetTime = parseIsoDate(target);
    if (startTime === null || targetTime === null) {
        return { error: 'Use YYYY-MM-DD for both dates.' };
    }
    if (startTime > targetTime) {
        return { error: 'Start date must be before target date.' };
    }
    return { start, target };
};

