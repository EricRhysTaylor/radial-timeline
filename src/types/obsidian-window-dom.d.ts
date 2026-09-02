// Window-scoped Obsidian DOM helpers.
//
// Obsidian's per-window bootstrap (enhance.js) installs createEl / createDiv /
// createSpan / createSvg / createFragment on every window object — the main
// window and each popout — and each copy creates elements in that window's own
// document. obsidian.d.ts (1.13.x) declares these only as bare globals and on
// Node, so `doc.win.createSvg(...)` (the form obsidianmd/prefer-create-el
// recommends for popout-safe creation from an ownerDocument) does not typecheck
// without this augmentation. Verified against the Obsidian 1.11.4 bundle on
// 2026-09-02. Signatures mirror the global declarations in obsidian.d.ts.
export {};

declare global {
    interface Window {
        createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: DomElementInfo | string, callback?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
        createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
        createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
        createSvg<K extends keyof SVGElementTagNameMap>(tag: K, o?: SvgElementInfo | string, callback?: (el: SVGElementTagNameMap[K]) => void): SVGElementTagNameMap[K];
        createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
    }
}
