#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["beautifulsoup4==4.13.4"]
# ///
"""Preprocess Smith's two Gutenberg volumes into loss-checked canto sources.

This creates SOURCE notes, never Class: Scene, analysis, or plugin settings.
The shipped onboarding workflow owns import, enrichment and materialization.
The untouched HTML retains the introduction, critical apparatus and appendices.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from bs4 import BeautifulSoup, Tag

ROMANS = ["", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"]
ORDINALS = {"FIRST": 1, "SECOND": 2, "THIRD": 3, "FOVRTH": 4, "FOURTH": 4, "FIFTH": 5, "SIXTE": 6}
# Verified Gutenberg #70717 prints lxiv a second time between lxxiii/lxxv.
# Preserve the printed label, identify citations by ordinal, and disclose it.
NUMBERING_VARIANTS = {(2, 10, 74): "lxiv"}


def roman_value(value: str) -> int:
    values = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100, "D": 500, "M": 1000}
    numbers = [values[letter] for letter in value.upper()]
    return sum(-n if i + 1 < len(numbers) and n < numbers[i + 1] else n for i, n in enumerate(numbers))


def clean_text(tag: Tag) -> str:
    tag = copy.deepcopy(tag)
    for item in tag.select(".linenum, .pagenum, a.fnanchor"):
        item.decompose()
    for line_break in tag.find_all("br"):
        line_break.replace_with("\n")
    # Inline tags do not introduce spaces: a note anchor can bisect a word.
    return " ".join(tag.get_text().split())


@dataclass
class Unit:
    book: int
    canto: int  # 0 is the book's proem; VII has VI, VII and the VIII fragment.
    stanzas: list[tuple[str, list[str]]] = field(default_factory=list)
    argument: list[str] = field(default_factory=list)

    @property
    def reference(self) -> str:
        return f"{ROMANS[self.book]}.{'proem' if self.canto == 0 else ROMANS[self.canto].lower()}"

    @property
    def title(self) -> str:
        return f"Book {ROMANS[self.book]} — " + ("Proem" if self.canto == 0 else f"Canto {ROMANS[self.canto]}") + (" (fragment)" if (self.book, self.canto) == (7, 8) else "")

    @property
    def folder(self) -> str:
        return f"{self.book:02d} Book {ROMANS[self.book]}" + (" — Mutabilitie fragment" if self.book == 7 else "")

    def markdown(self) -> str:
        # These are author-facing source references carried by the MD adapter.
        metadata = {
            "Source Reference": self.reference,
            "Book": ROMANS[self.book],
            "Canto": "Proem" if self.canto == 0 else ROMANS[self.canto],
            "Text Form": "Narrative verse" if self.canto else "Proem",
            "Textual Status": "Unfinished fragment" if self.book == 7 else "Complete internal book",
        }
        header = "---\n" + "\n".join(f"{key}: {json.dumps(value, ensure_ascii=False)}" for key, value in metadata.items()) + "\n---\n\n"
        blocks = [f"# {self.title}"]
        if self.argument:
            blocks.append("##### Source argument\n\n" + "  \n".join(self.argument))
        for ordinal, (label, lines) in enumerate(self.stanzas, 1):
            blocks.append(f"##### Stanza {ordinal:03d} (source {label})\n\n" + "  \n".join(lines))
        return header + "\n\n".join(blocks) + "\n"


def read_units(html: str) -> list[Unit]:
    soup = BeautifulSoup(html, "html.parser")
    units: list[Unit] = []
    current: Unit | None = None
    book = 0
    for tag in soup.find_all(["p", "div"]):
        if tag.name == "p" and clean_text(tag).startswith("Stanzas xliii-xlv were first inserted in the 1596 quarto"):
            # The following 1590 alternative ending is a textual witness, not
            # additional events after the retained 1596 ending. Keep it in HTML.
            if current is None or (current.book, current.canto, len(current.stanzas)) != (3, 12, 45):
                raise ValueError("Unexpected location of the 1590 alternative ending")
            current = None
        if tag.name == "p" and "ph2" in tag.get("class", []):
            title = clean_text(tag)
            heading = re.match(r"THE (\w+) BOOKE OF THE FAERIE QVEENE", title, re.I)
            if heading and heading[1].upper() in ORDINALS:
                book = ORDINALS[heading[1].upper()]
                current = Unit(book, 0)
                units.append(current)
            elif re.match(r"TWO CANTOS OF MUTABILITIE", title, re.I):
                book, current = 7, None
            elif book and (canto := re.fullmatch(r"Cant(?:o|\.)\s+([IVXLCDM]+)\.", title, re.I)):
                current = Unit(book, roman_value(canto[1]))
                units.append(current)
            elif book == 7 and re.fullmatch(r"The VIII\. Canto, vnperfite\.", title, re.I):
                current = Unit(7, 8)
                units.append(current)
            elif re.match(r"FINIS\b", title, re.I):
                current = None
        if tag.name != "div" or "stanza" not in tag.get("class", []) or current is None:
            continue
        # Critical notes can quote verse. They are retained in HTML, not promoted
        # into the poem. Figure captions, however, hold the authentic arguments.
        if any("footnotes" in parent.get("class", []) or "transnote" in parent.get("class", []) for parent in tag.parents if isinstance(parent, Tag)):
            continue
        verses = tag.select("div.verse")
        lines = [clean_text(verse) for verse in verses]
        if not lines:
            continue
        number = tag.select_one(".linenum")
        # A few original HTML labels are bare, right-aligned text rather than
        # span.linenum. Require nine lines and the exact expected sequence.
        first_verse = copy.deepcopy(verses[0])
        for anchor in first_verse.select("a.fnanchor, .pagenum"):
            anchor.decompose()
        bare_number = re.search(r"\s+([ivxlcdm]+)\s*$", first_verse.get_text()) if len(lines) == 9 else None
        if number is None and bare_number is None:
            if current.canto == 0 or current.stanzas or current.argument:
                raise ValueError(f"Unexpected unnumbered verse at {current.reference} after {len(current.stanzas)} stanzas: {verses[0].get_text()!r}")
            current.argument = lines
            continue
        if number is not None:
            label = "".join(number.get_text().split()).lower()
        else:
            assert bare_number is not None
            label = bare_number[1].lower()
            lines[0] = re.sub(r"\s+" + label + r"$", "", lines[0])
        if not re.fullmatch(r"[ivxlcdm]+", label):
            raise ValueError(f"Unexpected stanza label {label!r} at {current.reference}")
        expected = len(current.stanzas) + 1
        if roman_value(label) != expected and NUMBERING_VARIANTS.get((current.book, current.canto, expected)) != label:
            raise ValueError(f"Stanza sequence at {current.reference}: expected {expected}, found {label}")
        if len(lines) != 9:
            raise ValueError(f"{current.reference}.{label}: expected 9 verse lines, found {len(lines)}")
        current.stanzas.append((label, lines))
    return units


def validate_scope(units: list[Unit]) -> None:
    expected = [(book, canto) for book in range(1, 7) for canto in range(13)] + [(7, 6), (7, 7), (7, 8)]
    actual = [(unit.book, unit.canto) for unit in units]
    if actual != expected:
        raise ValueError(f"Unexpected book/canto sequence: {actual}")
    if any(not unit.stanzas for unit in units) or len(units[-1].stanzas) != 2:
        raise ValueError("Missing stanza bodies or incomplete VIII fragment")
    if any(len(unit.argument) != 4 for unit in units if unit.canto and (unit.book, unit.canto) != (7, 8)):
        raise ValueError("Expected one four-line source argument for every complete canto")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--volume-one", required=True, type=Path)
    parser.add_argument("--volume-two", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    if args.output.exists():
        raise ValueError("Output already exists; preserve it and select a new directory")
    sources = [args.volume_one, args.volume_two]
    units = [unit for path in sources for unit in read_units(path.read_text(encoding="utf-8"))]
    validate_scope(units)
    # Validate every unit before creating any output.
    inventory = []
    for unit in units:
        folder = Path(unit.folder) if unit.canto else Path("Source Context") / "Proems"
        path = args.output / folder / f"{unit.canto if unit.canto else unit.book:02d} {unit.title}.md"
        path.parent.mkdir(parents=True, exist_ok=True)
        content = unit.markdown()
        path.write_text(content, encoding="utf-8")
        inventory.append({"path": str(path.relative_to(args.output)), "reference": unit.reference,
                          "stanzas": len(unit.stanzas), "verseLines": len(unit.stanzas) * 9,
                          "argumentLines": len(unit.argument),
                          "numberingVariants": [{"ordinal": ordinal, "printedLabel": label} for ordinal, (label, _) in enumerate(unit.stanzas, 1) if roman_value(label) != ordinal],
                          "sha256": hashlib.sha256(content.encode()).hexdigest()})
    manifest = {"schemaVersion": 1, "stage": "prepared-source", "units": len(units),
                "narrativeUnits": sum(bool(unit.canto) for unit in units), "proems": sum(unit.canto == 0 for unit in units),
                "stanzas": sum(len(unit.stanzas) for unit in units),
                "excludedFromNarrative": ["Editorial introductions, footnotes, appendices and transcriber notes", "Book III's alternative 1590 ending (retained in original HTML)", "Letter to Raleigh and dedicatory/commendatory poems (retained in original HTML)"],
                "sources": [{"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest()} for path in sources],
                "files": inventory}
    (args.output / "source-inventory.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({key: manifest[key] for key in ["stage", "units", "stanzas"]}))


if __name__ == "__main__":
    main()
