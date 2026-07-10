#!/usr/bin/env python3
"""Restyle pandoc's default reference.docx into standard manuscript format.

Shunn-style submission format: Times New Roman 12pt, double-spaced body with
0.5" first-line indent and no inter-paragraph spacing; centered headings.

Critically also retargets EVERY font reference to fonts present on a stock
macOS/Windows machine (Times New Roman for prose, Courier New for code) so
Pages/Word never report a missing font. Pandoc's current default doc ships
Aptos as its theme font (Microsoft 2024 default) and points the document
defaults at the theme, so the named styles alone are not enough — the theme
and docDefaults must be retargeted too.
"""
import sys, zipfile, re
import xml.etree.ElementTree as ET

SRC, DST = sys.argv[1], sys.argv[2]
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
ET.register_namespace("w", W)
for p, u in [("mc","http://schemas.openxmlformats.org/markup-compatibility/2006"),
             ("r","http://schemas.openxmlformats.org/officeDocument/2006/relationships"),
             ("w14","http://schemas.microsoft.com/office/word/2010/wordml")]:
    ET.register_namespace(p, u)

BODY_FONT = "Times New Roman"
MONO_FONT = "Courier New"

def q(tag): return f"{{{W}}}{tag}"

def ensure(parent, tag, first=False):
    el = parent.find(q(tag))
    if el is None:
        el = ET.Element(q(tag))
        if first: parent.insert(0, el)
        else: parent.append(el)
    return el

def set_font(rpr, name=BODY_FONT, half_points="24"):
    fonts = ensure(rpr, "rFonts", first=True)
    # Drop theme-based font references so nothing resolves via the theme.
    # OOXML attribute names: asciiTheme/hAnsiTheme/eastAsiaTheme, but the
    # complex-script one is all-lowercase 'cstheme'.
    for attr in ("asciiTheme", "hAnsiTheme", "cstheme", "eastAsiaTheme"):
        if q(attr) in fonts.attrib:
            del fonts.attrib[q(attr)]
    for attr in ("ascii", "hAnsi", "cs", "eastAsia"):
        fonts.set(q(attr), name)
    if half_points:
        sz = ensure(rpr, "sz"); sz.set(q("val"), half_points)
        szcs = ensure(rpr, "szCs"); szcs.set(q("val"), half_points)

def style_by_id(root, sid):
    for s in root.findall(q("style")):
        if s.get(q("styleId")) == sid: return s
    return None

def ppr_of(style):
    ppr = style.find(q("pPr"))
    if ppr is None:
        ppr = ET.Element(q("pPr"))
        name_el = style.find(q("name"))
        idx = (list(style).index(name_el) + 1) if name_el is not None else 0
        style.insert(idx, ppr)
    return ppr

def rpr_of(style):
    rpr = style.find(q("rPr"))
    if rpr is None:
        rpr = ET.Element(q("rPr")); style.append(rpr)
    return rpr

def set_spacing(ppr, line="480", before="0", after="0"):
    sp = ensure(ppr, "spacing")
    sp.set(q("line"), line); sp.set(q("lineRule"), "auto")
    sp.set(q("before"), before); sp.set(q("after"), after)

def set_first_line_indent(ppr, twips="720"):
    ind = ensure(ppr, "ind"); ind.set(q("firstLine"), twips)

def set_centered(ppr):
    jc = ensure(ppr, "jc"); jc.set(q("val"), "center")

# ── styles.xml ──────────────────────────────────────────────────────────────
root = ET.fromstring(zipfile.ZipFile(SRC).read("word/styles.xml"))

# Document defaults — the fallback for any run without an explicit font. Force
# explicit Times New Roman here so nothing inherits the Aptos theme font.
docDefaults = root.find(q("docDefaults"))
if docDefaults is not None:
    rprDefault = docDefaults.find(q("rPrDefault"))
    if rprDefault is not None:
        rpr = ensure(rprDefault, "rPr")
        set_font(rpr)

# Normal + prose styles: TNR 12, double-spaced; body gets first-line indent.
normal = style_by_id(root, "Normal")
if normal is not None:
    set_font(rpr_of(normal)); set_spacing(ppr_of(normal))
for sid in ("BodyText", "FirstParagraph"):
    s = style_by_id(root, sid)
    if s is not None:
        set_spacing(ppr_of(s)); set_first_line_indent(ppr_of(s))

# Headings: centered TNR 12, Heading1 starts a new page.
for sid, page_break in (("Heading1", True), ("Heading2", False), ("Heading3", False)):
    s = style_by_id(root, sid)
    if s is None: continue
    ppr = ppr_of(s); set_centered(ppr); set_spacing(ppr, before="480", after="240")
    if page_break: ensure(ppr, "pageBreakBefore")
    rpr = rpr_of(s); set_font(rpr)
    for c in rpr.findall(q("color")): rpr.remove(c)

# Metadata styles: centered TNR.
for sid in ("Title", "Subtitle", "Author", "Date"):
    s = style_by_id(root, sid)
    if s is None: continue
    set_centered(ppr_of(s)); set_font(rpr_of(s))

# Any remaining explicit font attrs across all styles: prose fonts -> TNR,
# monospace/code fonts (Consolas) -> Courier New (both present on macOS).
styles_body = ET.tostring(root, encoding="unicode")
styles_body = styles_body.replace('Consolas', MONO_FONT)
for stray in ("Aptos Display", "Aptos", "Calibri Light", "Calibri", "Cambria"):
    styles_body = styles_body.replace(stray, BODY_FONT)
styles_xml_out = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + styles_body).encode("utf-8")

# ── fontTable.xml ───────────────────────────────────────────────────────────
# The font table is the manifest Pages/Word reads to report "missing fonts".
# Drop the Microsoft fonts that are not on a stock macOS install and are no
# longer referenced after the restyle (Aptos, Calibri, Cambria family). What
# remains — Times New Roman, Courier New, Symbol, Wingdings, Arial — ships with
# macOS, so no missing-font prompt.
DROP_FONTS = {"Aptos", "Aptos Display", "Calibri", "Calibri Light", "Cambria", "Cambria Math", "Consolas"}
ft_name = "word/fontTable.xml"
ft_root = ET.fromstring(zipfile.ZipFile(SRC).read(ft_name))
for font_el in list(ft_root.findall(q("font"))):
    if font_el.get(q("name")) in DROP_FONTS:
        ft_root.remove(font_el)
ft_body = ET.tostring(ft_root, encoding="unicode")
fonttable_xml_out = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + ft_body).encode("utf-8")

# ── theme1.xml ──────────────────────────────────────────────────────────────
# Retarget the theme's major/minor Latin typefaces so anything still resolving
# through the theme lands on Times New Roman rather than Aptos.
theme_name = "word/theme/theme1.xml"
theme_raw = zipfile.ZipFile(SRC).read(theme_name).decode("utf-8")
theme_raw = re.sub(r'(<a:latin typeface=")[^"]*(")', r'\g<1>' + BODY_FONT + r'\g<2>', theme_raw)
theme_xml_out = theme_raw.encode("utf-8")

# ── repackage ───────────────────────────────────────────────────────────────
with zipfile.ZipFile(SRC) as zin, zipfile.ZipFile(DST, "w", zipfile.ZIP_DEFLATED) as zout:
    for item in zin.infolist():
        if item.filename == "word/styles.xml":
            data = styles_xml_out
        elif item.filename == theme_name:
            data = theme_xml_out
        elif item.filename == ft_name:
            data = fonttable_xml_out
        else:
            data = zin.read(item.filename)
        zout.writestr(item, data)
print(f"wrote {DST}")
