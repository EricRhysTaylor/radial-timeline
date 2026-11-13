/** Use the chosen character, or the lead when there is no matching choice. */
export function selectedPortrait(people: ReadonlyArray<{ image: string | null }>, selectedIndex: number): string | null {
    return people[selectedIndex < 0 ? 0 : selectedIndex]?.image ?? null;
}
