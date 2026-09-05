type PerfRecord = { label: string; duration: number; timestamp: number };

/**
 * Any stable object the measurement ring buffer can live on (in practice the
 * plugin instance). The buffer needs a host, not the renderer facade — keeping
 * this minimal lets interaction code and commands record/read without
 * depending on renderer types.
 */
export type PerfHost = object;

export type PerfStopHandler = () => void;

const PERF_BUFFER_CAP = 600;

function pushPerfRecord(plugin: PerfHost, record: PerfRecord): void {
    const host = plugin as unknown as { _perfMeasurements?: PerfRecord[] }; // SAFE: perf measurements ride on the plugin instance as an undeclared dev-only slot
    if (!host._perfMeasurements) {
        host._perfMeasurements = [];
    }
    host._perfMeasurements.push(record);
    if (host._perfMeasurements.length > PERF_BUFFER_CAP) {
        host._perfMeasurements.shift();
    }
}

export function startPerfSegment(plugin: PerfHost, label: string): PerfStopHandler {
    const canMeasure = typeof performance !== 'undefined' && typeof performance.now === 'function';
    const start = canMeasure ? performance.now() : Date.now();
    return () => {
        const end = canMeasure ? performance.now() : Date.now();
        const duration = end - start;
        const record: PerfRecord = { label, duration, timestamp: Date.now() };
        pushPerfRecord(plugin, record);
    };
}

/**
 * Measure an interaction handler two ways: `<label>.js` is the synchronous
 * handler cost; `<label>.frame` is handler start → the frame after the next
 * paint, which includes the style-recalc/layout/paint the mutations caused.
 * The split is the diagnostic: high frame with low js = the browser is paying
 * for our invalidation, not our JavaScript.
 */
export function measureInteraction(
    plugin: PerfHost,
    label: string,
    win: Window,
    fn: () => void
): void {
    const canMeasure = typeof performance !== 'undefined' && typeof performance.now === 'function';
    if (!canMeasure) {
        fn();
        return;
    }
    const start = performance.now();
    fn();
    pushPerfRecord(plugin, { label: `${label}.js`, duration: performance.now() - start, timestamp: Date.now() });
    win.requestAnimationFrame(() => {
        win.requestAnimationFrame(() => {
            pushPerfRecord(plugin, { label: `${label}.frame`, duration: performance.now() - start, timestamp: Date.now() });
        });
    });
}

export interface PerfSummaryRow {
    label: string;
    count: number;
    median: number;
    p95: number;
    max: number;
}

/** Aggregate the ring buffer by label (median/p95/max), sorted by label. */
export function summarizePerfMeasurements(plugin: PerfHost): PerfSummaryRow[] {
    const host = plugin as unknown as { _perfMeasurements?: PerfRecord[] }; // SAFE: perf measurements ride on the plugin instance as an undeclared dev-only slot
    const records = host._perfMeasurements;
    if (!records || records.length === 0) return [];
    const byLabel = new Map<string, number[]>();
    records.forEach(r => {
        const list = byLabel.get(r.label);
        if (list) list.push(r.duration); else byLabel.set(r.label, [r.duration]);
    });
    const quantile = (sorted: number[], q: number): number =>
        sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return Array.from(byLabel.entries())
        .map(([label, durations]) => {
            const sorted = [...durations].sort((a, b) => a - b);
            return {
                label,
                count: sorted.length,
                median: quantile(sorted, 0.5),
                p95: quantile(sorted, 0.95),
                max: sorted[sorted.length - 1],
            };
        })
        .sort((a, b) => a.label.localeCompare(b.label));
}

/** Clear the measurement buffer (fresh sampling window). */
export function resetPerfMeasurements(plugin: PerfHost): void {
    const host = plugin as unknown as { _perfMeasurements?: PerfRecord[] }; // SAFE: perf measurements ride on the plugin instance as an undeclared dev-only slot
    host._perfMeasurements = [];
}
