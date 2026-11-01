/** Use the first listed character; never substitute another portrait. */
export function leadPortrait(people: ReadonlyArray<{ image: string | null }>): string | null {
    return people[0]?.image ?? null;
}
