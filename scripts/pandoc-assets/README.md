# Bundled Pandoc assets

## `reference-manuscript.docx`

Standard-manuscript-format Word reference document used by DOCX export
(`--reference-doc`). Times New Roman 12pt, double-spaced, 0.5" first-line
indent, centered chapter headings on new pages.

It is a derived artifact — regenerate it, never hand-edit:

```sh
pandoc -o /tmp/ref-default.docx --print-default-data-file reference.docx
python3 scripts/pandoc-assets/build-reference-docx.py /tmp/ref-default.docx \
  src/assets/pandoc/reference-manuscript.docx
```

The builder retargets every font reference — named styles, document
defaults, the theme, AND the font table manifest — to fonts present on a
stock macOS/Windows install (Times New Roman, Courier New). Pandoc's default
reference doc ships Aptos/Calibri/Cambria (Microsoft fonts absent from
macOS), which Pages/Word flag as "missing fonts" if left in the font table
even when unused — hence the font-table pruning.
