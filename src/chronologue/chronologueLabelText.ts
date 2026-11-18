import { getFormattingLocale, t } from '../i18n';
import { datesSpanEras, formatStoryYear } from '../utils/date';
import { escapeXml } from '../utils/svg';
import type { ChronologueLabel } from '../renderer/utils/Chronologue';

/** Use the last visible label as context; never imply precision the author did not supply. */
export function contextualChronologueLabels(labels: ChronologueLabel[]): ChronologueLabel[] {
    const locale = getFormattingLocale();
    // English uses day-month order to keep the day and year visually distinct.
    const dateLocale = /^en(?:-|$)/i.test(locale) ? 'en-GB' : locale;
    const dated = labels.filter(label => label.isMajor && label.earthDate && label.precision)
        .map(label => ({ label, date: new Date(label.earthDate!) }))
        .filter(item => Number.isFinite(item.date.getTime()))
        .sort((a, b) => a.date.getTime() - b.date.getTime());
    const markCe = datesSpanEras(dated.map(item => item.date));
    const replacements = new Map<ChronologueLabel, ChronologueLabel>();
    let previous: { date: Date; precision: NonNullable<ChronologueLabel['precision']> } | undefined;
    let reportedMonth: number | undefined;
    let reportedWeekday: number | undefined;
    for (const { label, date } of dated) {
        const precision = label.precision!;
        const boundary = !!(label.isFirst || label.isLast);
        const yearChanged = !previous || date.getFullYear() !== previous.date.getFullYear();
        const sameDay = !!previous && date.toDateString() === previous.date.toDateString();
        const sameInstant = sameDay && precision === 'time' && previous?.precision === 'time' && date.getTime() === previous.date.getTime();
        const sameKnownDate = sameDay && precision === 'day' && (previous?.precision === 'day' || previous?.precision === 'time');
        const sameKnownMonth = precision === 'month' && !!previous && !yearChanged && date.getMonth() === previous.date.getMonth() && previous.precision !== 'year';
        const sameKnownYear = precision === 'year' && !!previous && !yearChanged;
        if (!boundary && (sameInstant || sameKnownDate || sameKnownMonth || sameKnownYear)) {
            replacements.set(label, { ...label, name: '', shortName: '', isMajor: false, earthDate: undefined });
            continue;
        }
        const year = formatStoryYear(date, locale, markCe);
        const month = new Intl.DateTimeFormat(dateLocale, { month: 'short', calendar: 'gregory' }).format(date);
        const day = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', month: 'short', calendar: 'gregory' }).format(date);
        const weekday = new Intl.DateTimeFormat(locale, { weekday: 'short', calendar: 'gregory' }).format(date);
        const time = date.getHours() === 12 && date.getMinutes() === 0 ? t('ui.date.noon')
            : date.getHours() === 0 && date.getMinutes() === 0 ? t('ui.date.midnight')
            : new Intl.DateTimeFormat(locale, { hour: 'numeric', ...(date.getMinutes() ? { minute: '2-digit' as const } : {}) }).format(date);
        let text: string;
        let kind: NonNullable<ChronologueLabel['labelKind']>;
        if (boundary) {
            const detail = precision === 'year' ? '' : precision === 'month' ? month : day;
            text = detail ? `${year}\n${detail}` : year;
            kind = precision === 'time' ? 'day' : precision;
            if (precision !== 'year') reportedMonth = date.getMonth();
        } else if (precision === 'year') {
            text = year; kind = 'year'; reportedMonth = undefined;
        } else if (precision === 'month') {
            text = `${month}${yearChanged ? ` ${year}` : ''}`; kind = 'month';
            reportedMonth = date.getMonth();
        } else {
            // A less precise preceding label cannot establish a particular day.
            const showDay = !sameDay || previous?.precision === 'year' || previous?.precision === 'month';
            const showDate = showDay || precision === 'day';
            const showMonth = reportedMonth !== date.getMonth() || yearChanged;
            const showWeekday = reportedWeekday !== date.getDay();
            const dayOnly = new Intl.DateTimeFormat(dateLocale, { day: 'numeric', calendar: 'gregory' }).format(date);
            const dateText = showDate ? [showWeekday ? weekday : '', showMonth ? day : dayOnly, yearChanged ? year : ''].filter(Boolean).join(' ') : '';
            text = [dateText, precision === 'time' ? time : ''].filter(Boolean).join(' · ');
            kind = precision === 'time' ? (dateText ? 'datetime' : 'time') : 'day';
            if (showDate) {
                if (showWeekday) reportedWeekday = date.getDay();
                if (showMonth) reportedMonth = date.getMonth();
            }
        }
        text = escapeXml(text);
        replacements.set(label, { ...label, name: text, shortName: text, labelKind: kind });
        previous = { date, precision };
    }
    return labels.map(label => replacements.get(label) ?? label);
}
