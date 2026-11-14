import { describe, expect, it } from 'vitest';
import type { TextComponent } from 'obsidian';
import { bindHexTextInput } from './hexTextInput';

/** Just enough of a TextComponent: typing fires onChange, committing fires the input's change event. */
function fakeText() {
    let value = '';
    let onInput: ((value: string) => unknown) | null = null;
    const listeners: Array<() => void> = [];
    const text = {
        inputEl: { addEventListener: (type: string, listener: () => void) => { if (type === 'change') listeners.push(listener); } },
        getValue: () => value,
        setValue: (next: string) => { value = next; return text; },
        onChange: (callback: (value: string) => unknown) => { onInput = callback; return text; },
    };
    const type = async (typed: string): Promise<void> => {
        for (let i = 1; i <= typed.length; i++) {
            value = typed.slice(0, i);
            await onInput?.(value);
        }
    };
    const commit = (): void => listeners.forEach(listener => listener());
    return { text: text as unknown as TextComponent, type, commit, value: () => value };
}

describe('bindHexTextInput', () => {
    it('saves a six-digit color once it is complete, never its three-digit start', async () => {
        const field = fakeText();
        const saved: string[] = [];
        bindHexTextInput(field.text, (hex) => { saved.push(hex); });
        await field.type('#F9E784');
        expect(saved).toEqual(['#F9E784']);
        // Leaving the field does not save it again.
        field.commit();
        expect(saved).toEqual(['#F9E784']);
    });

    it('saves a shorthand #rgb only when the field is committed, and shows it expanded', async () => {
        const field = fakeText();
        const saved: string[] = [];
        bindHexTextInput(field.text, (hex) => { saved.push(hex); });
        await field.type('#fff');
        expect(saved).toEqual([]);
        field.commit();
        expect(saved).toEqual(['#ffffff']);
        expect(field.value()).toBe('#ffffff');
    });

    it('saves nothing for a partial color left in the field', async () => {
        const field = fakeText();
        const saved: string[] = [];
        bindHexTextInput(field.text, (hex) => { saved.push(hex); });
        await field.type('#F9E7');
        field.commit();
        expect(saved).toEqual([]);
        expect(field.value()).toBe('#F9E7');
    });
});
