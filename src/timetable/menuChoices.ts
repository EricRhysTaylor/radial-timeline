import type { Menu } from 'obsidian';

export interface MenuChoice { label: string; checked: boolean; run: () => void }

/**
 * One group of a display menu: a gray heading when given, its checkable
 * choices, then a separator. The Timetable Panels image menu and the Canvas
 * card menu are both built from these groups, so they read the same.
 */
export function addMenuChoices(menu: Menu, heading: string | undefined, choices: readonly MenuChoice[]): void {
    if (heading) menu.addItem(item => item.setTitle(heading).setIsLabel(true));
    for (const choice of choices) menu.addItem(item => item.setTitle(choice.label).setChecked(choice.checked).onClick(choice.run));
    menu.addSeparator();
}
