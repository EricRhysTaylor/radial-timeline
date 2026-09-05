// Tests run in a Node environment; production code uses `window` (timers,
// crypto) per Obsidian's popout-compatibility guidance. Alias it to
// globalThis so those call sites work under vitest.
if (typeof (globalThis as { window?: unknown }).window === 'undefined') {
    (globalThis as { window?: unknown }).window = globalThis;
}
