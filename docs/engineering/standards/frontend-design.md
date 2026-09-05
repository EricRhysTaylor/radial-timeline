# Frontend Design Guide

**Scope:** All UI/UX design, component layout, visual styling, and aesthetic direction for Radial Timeline interfaces.

This guide applies to any AI agent or human building frontend interfaces in this codebase. It complements [css-guidelines.md](css-guidelines.md) (which covers CSS architecture rules) by focusing on **design intent and aesthetic quality**.

---

## Design Thinking

Before coding, understand the context and commit to a clear aesthetic direction:

- **Purpose**: What problem does this interface solve? Who uses it?
- **Tone**: Choose an intentional direction — brutally minimal, maximalist, retro-futuristic, organic/natural, luxury/refined, playful, editorial/magazine, brutalist/raw, art deco/geometric, soft/pastel, industrial/utilitarian, etc. Use these for inspiration but design one that is true to the aesthetic direction.
- **Constraints**: Technical requirements (Obsidian plugin environment, framework, performance, accessibility).
- **Differentiation**: What makes this memorable? What's the one detail someone will remember?

**CRITICAL**: Choose a clear conceptual direction and execute it with precision. Bold maximalism and refined minimalism both work — the key is intentionality, not intensity.

Implemented code must be:
- Production-grade and functional
- Visually striking and memorable
- Cohesive with a clear aesthetic point-of-view
- Meticulously refined in every detail

---

## Aesthetic Guidelines

### Typography
Choose fonts that are beautiful, unique, and interesting. Avoid generic defaults (Arial, Inter, Roboto, system fonts). Opt for distinctive, characterful choices. Pair a distinctive display font with a refined body font.

> Within the Obsidian plugin context, respect the user's theme typography but layer ERT-specific typographic decisions on top where appropriate.

### Color & Theme
Commit to a cohesive palette. Use CSS variables for consistency. Dominant colors with sharp accents outperform timid, evenly-distributed palettes.

> Within this codebase, follow the [css-guidelines.md](css-guidelines.md) color rules — no raw hex/rgb in component rules, use tokens and theme variables.

### Motion & Animation
Use animations for high-impact moments. Focus on orchestrated reveals (staggered `animation-delay`) over scattered micro-interactions. Prioritize CSS-only solutions. Use scroll-triggering and hover states that surprise.

### Spatial Composition
Unexpected layouts. Asymmetry. Overlap. Diagonal flow. Grid-breaking elements. Generous negative space OR controlled density. Avoid predictable, cookie-cutter component patterns.

### Backgrounds & Visual Details
Default to flat, theme-native surfaces. Reserve atmospheric treatments (accent gradients, layered transparencies, subtle shadows) for intentional hero surfaces only. Workflow panels, settings rows, and modal internals must stay flat — use borders, spacing, contrast, and typography to create hierarchy. See [css-guidelines.md § Surface Treatment Doctrine](css-guidelines.md#surface-treatment-doctrine) for the full rule.

---

## Anti-Patterns

Avoid generic AI-generated aesthetics:
- Overused font families (Inter, Roboto, Arial, system fonts as the only choice)
- Cliched color schemes (particularly purple gradients on white backgrounds)
- Predictable layouts and component patterns
- Cookie-cutter design that lacks context-specific character
- Converging on the same "safe" choices across different interfaces

Every interface should feel genuinely designed for its specific context. Vary between light and dark themes, different fonts, different aesthetics.

---

## Implementation Complexity

Match implementation complexity to the aesthetic vision:
- **Maximalist designs** need elaborate code with extensive animations and effects.
- **Minimalist/refined designs** need restraint, precision, and careful attention to spacing, typography, and subtle details.

Elegance comes from executing the vision well, not from piling on effects.

---

## Obsidian Plugin Context

When designing within this Obsidian plugin:
- Follow the ERT design system (`ert-` prefix classes)
- Respect the theme-first principle from [css-guidelines.md](css-guidelines.md)
- Use ERT tokens for spacing and rhythm
- Scope all styles under `.ert-ui`
- Layer aesthetic choices additively on top of theme surfaces

## UI Copy Casing

Obsidian-facing UI copy should use sentence case nearly everywhere.

Apply sentence case to:
- settings row titles and section labels
- command palette command names
- modal titles
- button labels and short helper labels when they name an action or surface
- ribbon labels, tooltips, and other shell-facing UI text

Do not use title case for routine product UI such as `Scene note maintenance` or `Open inquiry`.

Preserve acronyms and proper nouns in their canonical form:
- `AI`, `API`, `LLM`, `URL`, `YAML`, `PDF`, `RT`, `LaTeX`
- `Obsidian`, `Inquiry`, `Gossamer`, `Chronologue`

Use title case only when reproducing an external name, a file/template title, or authored content that intentionally requires it.

---

## Applicability

This guide is framework-agnostic. The principles apply whether building:
- Obsidian plugin UI (this codebase)
- Standalone HTML/CSS/JS pages
- React, Vue, or other framework components
- Any web interface

The aesthetic principles are universal; the CSS architecture rules in [css-guidelines.md](css-guidelines.md) are specific to this codebase.
