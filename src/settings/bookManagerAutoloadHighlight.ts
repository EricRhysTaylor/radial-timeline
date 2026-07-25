const AUTOLOAD_HIGHLIGHT_TTL_MS = 2 * 60 * 1000;

interface AutoloadHighlightPayload {
    bookId: string;
    createdAt: number;
}

// In-memory handoff for the one-shot Book Manager highlight. The autoload
// itself is already persisted in settings; this visual hint is optional and
// intentionally does not survive a plugin reload, so module state suffices
// (and keeps the plugin off the storefront's Local Storage disclosure).
let pendingHighlight: AutoloadHighlightPayload | null = null;

export function markBookManagerAutoloadHighlight(bookId: string): void {
    if (!bookId) return;
    pendingHighlight = { bookId, createdAt: Date.now() };
}

export function consumeBookManagerAutoloadHighlight(): string | null {
    const payload = pendingHighlight;
    pendingHighlight = null;
    if (!payload) return null;
    const bookId = payload.bookId.trim();
    if (!bookId || Date.now() - payload.createdAt > AUTOLOAD_HIGHLIGHT_TTL_MS) return null;
    return bookId;
}
