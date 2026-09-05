import { describe, expect, it, vi } from 'vitest';
import { confirmAudit } from './confirmAudit';
const ui = vi.hoisted(() => ({ modal: null as { close(): void } | null, actions: new Map<string, () => void>() }));
vi.mock('../../../../tests/mocks/obsidian.ts', () => {
    const element = () => ({ setText() {}, empty() {}, addClass() {}, classList: { add() {} },
        createDiv: element, createSpan: element });
    return {
        App: class {},
        Modal: class {
            titleEl = element(); contentEl = element(); modalEl = element();
            onClose = () => {}; constructor() { ui.modal = this; ui.actions.clear(); }
            open() {} close() { this.onClose(); }
        },
        ButtonComponent: class {
            label = ''; setButtonText(label: string) { this.label = label; return this; }
            setCta() { return this; } onClick(action: () => void) { ui.actions.set(this.label, action); return this; }
        }
    };
});
function open() {
    return confirmAudit({} as never, { badge: 'BEAT AUDIT', title: 'Insert IDs', subtitle: 'Two notes',
        scope: 'Book', action: 'Insert', renderBody: body => body.createDiv({ text: 'Existing IDs are preserved.' }) });
}
describe('audit confirmation lifecycle', () => {
    it('accepts only the explicit action', async () => {
        const result = open(); ui.actions.get('Insert')!();
        expect(await result).toBe(true);
    });
    it('cancels from the Cancel button', async () => {
        const result = open(); ui.actions.get('Cancel')!();
        expect(await result).toBe(false);
    });
    it('cancels on dismissal without a button press', async () => {
        const result = open(); ui.modal!.close();
        expect(await result).toBe(false);
    });
});
