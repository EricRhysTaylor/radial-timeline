import { FuzzySuggestModal, type App } from 'obsidian';

/** Pick one subplot name for a scene-menu membership action. */
export class SubplotPickerModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private readonly names: string[],
        placeholder: string,
        private readonly onChoose: (name: string) => void
    ) {
        super(app);
        this.setPlaceholder(placeholder);
    }

    getItems(): string[] {
        return this.names;
    }

    getItemText(name: string): string {
        return name;
    }

    onChooseItem(name: string): void {
        this.onChoose(name);
    }
}
