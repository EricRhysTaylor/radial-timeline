# Sorts Mill Goudy (bundled)

Designer: Barry Schwartz
License: SIL Open Font License 1.1
Source: https://fonts.google.com/specimen/Sorts+Mill+Goudy

## Required files

Drop the following `.ttf` files in this directory. The filenames must match exactly — the LaTeX generator references them by name.

- `SortsMillGoudy-Regular.ttf`
- `SortsMillGoudy-Italic.ttf`

Google Fonts ships Sorts Mill Goudy as TrueType (`.ttf`). XeLaTeX's `fontspec` package reads TTF and OTF identically through the `Path=` mechanism, so no conversion is needed.

The Sorts Mill Goudy distribution does not currently ship dedicated bold or bold-italic faces. The generator falls back to fontspec's automatic bold synthesis (`AutoFakeBold`) for those weights, which is acceptable for manuscript body text.

## License

The `OFL.txt` file in this directory is the canonical SIL Open Font License 1.1 text and must remain unmodified. It governs redistribution of the bundled font files.

When the plugin is distributed, the entire `assets/fonts/sorts-mill-goudy/` directory — fonts plus `OFL.txt` plus this README — must travel together to satisfy the OFL's redistribution clauses.
