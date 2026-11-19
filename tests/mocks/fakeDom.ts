/**
 * A small element tree and the Obsidian controls built on it, for dialog and
 * settings-block tests that run in Node. It records what the code under test
 * created, in order, and lets a test read the text and press the buttons.
 *
 * Use it from a `vi.mock` of the Obsidian mock:
 *
 *   vi.mock('../../tests/mocks/obsidian', async (original) => {
 *       const dom = await import('../../tests/mocks/fakeDom');
 *       return { ...await original(), Modal: dom.FakeModal, ButtonComponent: dom.FakeButton,
 *           Setting: dom.FakeSetting, Notice: dom.FakeNotice };
 *   });
 */

interface CreateOptions {
    cls?: string;
    text?: string;
    href?: string;
    type?: string;
    attr?: Record<string, string>;
}

/** The window every fake element belongs to: records listeners so a test can fire one (focus, say). */
export class FakeWindow {
    private listeners = new Map<string, Set<() => void>>();
    addEventListener(type: string, listener: () => void): void {
        const set = this.listeners.get(type) ?? new Set();
        set.add(listener);
        this.listeners.set(type, set);
    }
    removeEventListener(type: string, listener: () => void): void { this.listeners.get(type)?.delete(listener); }
    dispatch(type: string): void { for (const listener of [...(this.listeners.get(type) ?? [])]) listener(); }
    listening(type: string): number { return this.listeners.get(type)?.size ?? 0; }
    reset(): void { this.listeners.clear(); }
}

export const fakeWindow = new FakeWindow();

export class FakeElement {
    /** Obsidian's `el.ownerDocument.win`. */
    ownerDocument = { win: fakeWindow };
    children: FakeElement[] = [];
    text = '';
    cls = '';
    href = '';
    button: FakeButton | null = null;
    setting: FakeSetting | null = null;
    style: Record<string, string> = {};
    attributes: Record<string, string> = {};
    id = '';
    /** An `input`'s type, and a checkbox's state. */
    type = '';
    checked = false;
    disabled = false;
    /** The DOM's `hidden`: out of view, still in the tree. */
    hidden = false;
    private listeners = new Map<string, Array<() => void>>();
    classList = {
        add: (...names: string[]): void => { this.cls = [this.cls, ...names].filter(Boolean).join(' '); },
        remove: (...names: string[]): void => { this.cls = this.cls.split(' ').filter(name => name && !names.includes(name)).join(' '); },
        toggle: (name: string, force?: boolean): boolean => {
            const on = force ?? !this.classList.contains(name);
            if (on && !this.classList.contains(name)) this.classList.add(name);
            if (!on) this.classList.remove(name);
            return on;
        },
        contains: (name: string): boolean => this.cls.split(' ').includes(name),
    };

    constructor(public tag = 'div') {}

    private add(tag: string, options: CreateOptions | string = {}): FakeElement {
        const el = new FakeElement(tag);
        const o = typeof options === 'string' ? { cls: options } : options;
        if (o.cls) el.cls = o.cls;
        if (o.text) el.text = o.text;
        if (o.href) el.href = o.href;
        if (o.type) el.type = o.type;
        if (o.attr) el.attributes = { ...o.attr };
        this.children.push(el);
        return el;
    }

    createDiv(options?: CreateOptions | string): FakeElement { return this.add('div', options); }
    createSpan(options?: CreateOptions | string): FakeElement { return this.add('span', options); }
    createEl(tag: string, options?: CreateOptions | string): FakeElement { return this.add(tag, options); }
    appendText(text: string): void { this.add('#text', { text }); }
    setText(text: string): void { this.text = text; this.children = []; }
    empty(): void { this.children = []; this.text = ''; }
    addClass(...names: string[]): void { this.classList.add(...names); }
    toggleClass(name: string, on: boolean): void { this.classList.toggle(name, on); }
    setAttribute(name: string, value: string): void { this.attributes[name] = value; }
    getAttribute(name: string): string | null { return this.attributes[name] ?? null; }
    /** Move a child to the front, as the DOM's prepend does. */
    prepend(child: FakeElement): void {
        this.children = [child, ...this.children.filter(el => el !== child)];
    }
    addEventListener(type: string, listener: () => void): void {
        this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
    }

    /** Click a checkbox, as the author would: a disabled one can't be clicked. */
    toggle(): void {
        if (this.disabled) throw new Error('The checkbox is disabled.');
        this.checked = !this.checked;
        for (const listener of this.listeners.get('change') ?? []) listener();
    }

    /** Every checkbox under this element, in document order. */
    get checkboxes(): FakeElement[] {
        return this.all().filter(el => el.tag === 'input' && el.type === 'checkbox');
    }

    /** Every element under this one, in document order. */
    all(): FakeElement[] {
        return this.children.flatMap(child => [child, ...child.all()]);
    }

    /** The words on screen under this element, in document order, one space between elements. For "is this said". */
    get content(): string {
        return [this.text, ...this.children.map(child => child.content)].filter(Boolean).join(' ');
    }

    /** This element's text exactly as the DOM would join it. For "is this the text". */
    get textContent(): string {
        return this.text + this.children.map(child => child.textContent).join('');
    }

    find(cls: string): FakeElement[] {
        return this.all().filter(el => el.classList.contains(cls));
    }

    get buttons(): FakeButton[] {
        return this.all().flatMap(el => (el.button ? [el.button] : []));
    }

    get settings(): FakeSetting[] {
        return this.all().flatMap(el => (el.setting ? [el.setting] : []));
    }

    /** The button with this label; throws when it is not on screen. */
    buttonNamed(label: string): FakeButton {
        const hit = this.buttons.find(button => button.text === label);
        if (!hit) throw new Error(`No "${label}" button. On screen: ${this.buttons.map(button => button.text).join(', ') || 'none'}`);
        return hit;
    }
}

export class FakeButton {
    text = '';
    disabled = false;
    cta = false;
    buttonEl: FakeElement;
    private handler: () => unknown = () => undefined;

    constructor(parent: FakeElement) {
        this.buttonEl = parent.createEl('button');
        this.buttonEl.button = this;
    }

    setButtonText(text: string): this { this.text = text; this.buttonEl.text = text; return this; }
    setCta(): this { this.cta = true; return this; }
    setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
    onClick(handler: () => unknown): this { this.handler = handler; return this; }

    /** Press it, as the author would: a disabled button can't be pressed. */
    async click(): Promise<void> {
        if (this.disabled) throw new Error(`The "${this.text}" button is disabled.`);
        await this.handler();
    }
}

export class FakeDropdown {
    options: Array<{ value: string; label: string }> = [];
    value = '';
    selectEl = new FakeElement('select');
    private handler: (value: string) => unknown = () => undefined;

    addOption(value: string, label: string): this { this.options.push({ value, label }); return this; }
    setValue(value: string): this { this.value = value; return this; }
    getValue(): string { return this.value; }
    onChange(handler: (value: string) => unknown): this { this.handler = handler; return this; }

    async choose(value: string): Promise<void> {
        if (!this.options.some(option => option.value === value)) throw new Error(`No "${value}" option.`);
        this.value = value;
        await this.handler(value);
    }
}

export class FakeToggle {
    value = false;
    disabled = false;
    private handler: (value: boolean) => unknown = () => undefined;

    setValue(value: boolean): this { this.value = value; return this; }
    setDisabled(disabled: boolean): this { this.disabled = disabled; return this; }
    onChange(handler: (value: boolean) => unknown): this { this.handler = handler; return this; }

    async flip(next: boolean): Promise<void> {
        if (this.disabled) throw new Error('The toggle is disabled.');
        this.value = next;
        await this.handler(next);
    }
}

export class FakeSetting {
    name = '';
    heading = false;
    settingEl: FakeElement;
    nameEl: FakeElement;
    descEl: FakeElement;
    controlEl: FakeElement;
    dropdown: FakeDropdown | null = null;
    toggle: FakeToggle | null = null;

    constructor(parent: FakeElement) {
        this.settingEl = parent.createDiv('setting-item');
        this.settingEl.setting = this;
        this.nameEl = this.settingEl.createDiv();
        this.descEl = this.settingEl.createDiv();
        this.controlEl = this.settingEl.createDiv();
    }

    setName(name: string): this { this.name = name; this.nameEl.text = name; return this; }
    setDesc(desc: string): this { this.descEl.text = desc; return this; }
    setHeading(): this { this.heading = true; return this; }
    addButton(build: (button: FakeButton) => unknown): this { build(new FakeButton(this.controlEl)); return this; }
    addDropdown(build: (dropdown: FakeDropdown) => unknown): this { this.dropdown = new FakeDropdown(); build(this.dropdown); return this; }
    addToggle(build: (toggle: FakeToggle) => unknown): this { this.toggle = new FakeToggle(); build(this.toggle); return this; }

    /** The description and every note under it. */
    get desc(): string { return this.descEl.content; }
    get buttons(): FakeButton[] { return this.controlEl.buttons; }
}

export class FakeModal {
    /** Every dialog opened since the last `resetFakeDom()`, oldest first. */
    static opened: FakeModal[] = [];
    contentEl = new FakeElement();
    modalEl = new FakeElement();
    titleEl = new FakeElement();
    scope = { register: (): void => undefined };
    isOpen = false;

    constructor(public app: unknown) {}

    open(): void {
        this.isOpen = true;
        FakeModal.opened.push(this);
        this.onOpen();
    }

    close(): void {
        if (!this.isOpen) return;
        this.isOpen = false;
        this.onClose();
    }

    onOpen(): void {}
    onClose(): void {}
}

/** Every Notice shown since the last `resetFakeDom()`. */
export const notices: string[] = [];

export class FakeNotice {
    constructor(message: string) {
        notices.push(message);
    }
}

export function resetFakeDom(): void {
    notices.length = 0;
    FakeModal.opened = [];
    fakeWindow.reset();
}
