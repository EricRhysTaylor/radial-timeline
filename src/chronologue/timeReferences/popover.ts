import { t } from '../../i18n';
import { referenceDateIdentity } from './layout';
import type { ReferenceDate, TimeReference } from './model';

/**
 * A date marker's popover (Eric, 2026-11-10: the one-line tooltip was unreadable). A heading, then one block per
 * reference: its label, kind and date, the scene it comes from, and its passage. Over a group of references the same
 * popover, opened by a click, lets you choose one.
 */
export interface ReferencePopoverRow { reference: TimeReference; source: string }
export interface ReferencePopoverContent { heading: string; rows: ReferencePopoverRow[]; notes: string[] }

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A date as a reader writes it: 1807, Jul 1811, Nov 27, 1811, Nov 27, 1811, 14:30. BCE dates keep their own text. */
export function readableReferenceDate(date: ReferenceDate): string {
    const at = new Date(date.start);
    const year = at.getFullYear();
    if (year < 1 || /bce/i.test(date.text)) return date.text;
    const month = MONTHS[at.getMonth()];
    if (date.precision === 'year') return String(year);
    if (date.precision === 'month') return `${month} ${year}`;
    const day = `${month} ${at.getDate()}, ${year}`;
    if (date.precision === 'day') return day;
    return `${day}, ${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** A reference's date, or its span: Jul – Aug 1811 within a year, Dec 1811 – Mar 1812 across years. */
export function readableReferenceSpan(reference: TimeReference): string {
    const from = readableReferenceDate(reference.when);
    if (!reference.end) return from;
    const to = readableReferenceDate(reference.end);
    const sameYear = reference.when.precision === 'month' && reference.end.precision === 'month'
        && new Date(reference.when.start).getFullYear() === new Date(reference.end.start).getFullYear() && from !== reference.when.text;
    return sameYear ? `${from.split(' ')[0]} – ${to}` : `${from} – ${to}`;
}

export function referencePopoverContent(extent: string | undefined, rows: ReferencePopoverRow[], options: { clipped: boolean; planetCalendar: boolean }): ReferencePopoverContent {
    const dates = new Set(rows.map(row => referenceDateIdentity(row.reference)));
    const extentLabel = extent === 'earlier' || extent === 'later' ? t(`timeReferences.${extent}`) : '';
    const dateText = dates.size > 1 ? t('timeReferences.dateCount', { count: dates.size }) : rows[0] ? readableReferenceSpan(rows[0].reference) : '';
    const count = dates.size === 1 && rows.length > 1 ? t('timeReferences.referenceCount', { count: rows.length }) : '';
    return {
        heading: [extentLabel, dateText, count].filter(Boolean).join(' · '),
        rows,
        notes: [options.clipped ? t('timeReferences.overlapsRange') : '', options.planetCalendar ? t('timeReferences.earthCalendar') : ''].filter(Boolean),
    };
}

/**
 * A source circle's popover: the scene as its heading, with how many references it has when there are several, then
 * each reference in the order the author declared them. The rows leave out the source, which the heading names.
 */
export function sourcePopoverContent(source: string, references: TimeReference[], options: { planetCalendar: boolean }): ReferencePopoverContent {
    const count = references.length > 1 ? t('timeReferences.referenceCount', { count: references.length }) : '';
    return {
        heading: [source, count].filter(Boolean).join(' · '),
        rows: references.map(reference => ({ reference, source: '' })),
        notes: options.planetCalendar ? [t('timeReferences.earthCalendar')] : [],
    };
}

/**
 * Level with its marker, just outside the timeline on the marker's side (the timeline's `radius` from its center), so
 * it covers no scenes and leaves the route in view; kept inside the window.
 */
export function popoverPosition(anchor: { left: number; top: number; right: number; bottom: number }, center: { x: number; y: number }, radius: number,
    size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
    const gap = 12, margin = 8;
    const middle = (anchor.left + anchor.right) / 2;
    const outward = middle >= center.x ? center.x + radius + gap : center.x - radius - gap - size.width;
    const left = Math.min(Math.max(margin, outward), viewport.width - size.width - margin);
    const top = Math.min(Math.max(margin, (anchor.top + anchor.bottom) / 2 - size.height / 2), viewport.height - size.height - margin);
    return { left, top };
}

export class ReferencePopover {
    private el: HTMLElement | null = null;
    /** Opened by a click to choose among references; hover leaves it alone until it closes. */
    pinned = false;
    /** The marker a pinned popover was opened from, so Escape can hand keyboard focus back to it. */
    private anchor: SVGElement | HTMLElement | null = null;

    constructor(private readonly doc: Document) {}

    contains(target: EventTarget | null): boolean {
        const view = this.doc.defaultView;
        return !!this.el && !!view && target instanceof view.Node && this.el.contains(target);
    }

    show(content: ReferencePopoverContent, anchor: Element, center: { x: number; y: number }, radius: number, choose?: (reference: TimeReference) => void): void {
        this.hide();
        const el = this.doc.body.createDiv({ cls: 'ert-time-reference-popover' });
        el.toggleClass('is-choosing', !!choose);
        el.createDiv({ cls: 'ert-time-reference-popover__heading', text: content.heading });
        for (const { reference, source } of content.rows) {
            const row = choose
                ? el.createEl('button', { cls: 'ert-time-reference-popover__row', attr: { type: 'button' } })
                : el.createDiv({ cls: 'ert-time-reference-popover__row' });
            row.createDiv({ cls: 'ert-time-reference-popover__label', text: reference.label });
            row.createDiv({ cls: 'ert-time-reference-popover__meta', text: `${t(`timeReferences.kinds.${reference.kind}`)} · ${readableReferenceSpan(reference)}` });
            if (source) row.createDiv({ cls: 'ert-time-reference-popover__source', text: source });
            if (reference.passage) row.createDiv({ cls: 'ert-time-reference-popover__passage', text: `“${reference.passage}”` });
            if (choose) row.onclick = () => { this.hide(); choose(reference); };
        }
        for (const note of content.notes) el.createDiv({ cls: 'ert-time-reference-popover__note', text: note });
        const win = this.doc.defaultView;
        const box = anchor.getBoundingClientRect();
        const at = popoverPosition(box, center, radius, { width: el.offsetWidth, height: el.offsetHeight }, { width: win?.innerWidth ?? 0, height: win?.innerHeight ?? 0 }); // SAFE: a document without a window has no viewport to fit; the popover stays at its anchor
        el.setCssProps({ '--ert-popover-left': `${at.left}px`, '--ert-popover-top': `${at.top}px` });
        this.el = el;
        this.pinned = !!choose;
        this.anchor = choose && win && (anchor instanceof win.SVGElement || anchor instanceof win.HTMLElement) ? anchor : null;
        if (choose) el.querySelector<HTMLButtonElement>('button')?.focus();
    }

    hide(): void {
        this.el?.remove();
        this.el = null;
        this.pinned = false;
        this.anchor = null;
    }

    /** Close on Escape: when focus was in the popover, return it to the marker instead of dropping it on the page. */
    dismiss(): void {
        const anchor = this.el?.contains(this.doc.activeElement) ? this.anchor : null;
        this.hide();
        if (anchor?.isConnected) anchor.focus();
    }
}
