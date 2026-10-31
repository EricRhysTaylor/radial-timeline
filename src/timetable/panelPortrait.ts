/** The first listed character is the scene's POV; never substitute another portrait. */
export function leadPortrait(people: ReadonlyArray<{ image: string | null }>): string | null {
    return people[0]?.image ?? null;
}
