import unittest

from prepare_faerie_queene_source import Unit, read_units, validate_scope


def stanza(label="i", count=9):
    return '<div class="stanza">' + ''.join(
        f'<div class="verse indent0">Line <i>{i}</i>.' + (f'<span class="linenum">{label}</span>' if i == 1 else '') + '</div>'
        for i in range(1, count + 1)
    ) + '</div>'


BOOK = '<p class="ph2">THE FIRST<br>BOOKE OF THE<br>FAERIE QVEENE.</p>'


def roman(number):
    out = ''
    for n, label in [(50, 'l'), (40, 'xl'), (10, 'x'), (9, 'ix'), (5, 'v'), (4, 'iv'), (1, 'i')]:
        out += label * (number // n)
        number %= n
    return out


class PrepareVerseSourceTests(unittest.TestCase):
    def test_preserves_words_lines_stanzas_and_source_argument(self):
        argument = '<div class="stanza">' + ''.join(f'<div class="verse">Argument {i}.</div>' for i in range(4)) + '</div>'
        units = read_units(BOOK + stanza() + '<p class="ph2">Cant. I.</p>' + argument + stanza() + stanza('ii'))
        self.assertEqual([(u.book, u.canto, len(u.stanzas)) for u in units], [(1, 0, 1), (1, 1, 2)])
        self.assertEqual(units[1].argument, [f'Argument {i}.' for i in range(4)])
        self.assertEqual(units[1].stanzas[0][1], [f'Line {i}.' for i in range(1, 10)])
        source = units[1].markdown()
        self.assertIn('Line 1.  \nLine 2.', source)
        self.assertIn('##### Stanza 002 (source ii)', source)
        self.assertNotIn('Class: Scene', source)

    def test_critical_verse_quotes_and_note_markers_do_not_enter_the_poem(self):
        verse = stanza().replace('Line <i>2</i>.', 'Li<a class="fnanchor">[6]</a>ne <i>2</i>.')
        html = BOOK + verse + '<div class="footnotes">' + stanza() + '</div>'
        units = read_units(html)
        self.assertEqual(len(units[0].stanzas), 1)
        self.assertEqual(units[0].stanzas[0][1][1], 'Line 2.')

    def test_rejects_missing_lines_and_stanzas(self):
        with self.assertRaisesRegex(ValueError, 'expected 9 verse lines'):
            read_units(BOOK + stanza(count=8))
        with self.assertRaisesRegex(ValueError, 'expected 2, found iii'):
            read_units(BOOK + stanza() + stanza('iii'))

    def test_reads_bare_stanza_labels_without_leaving_them_in_the_verse(self):
        html = stanza().replace('<span class="linenum">i</span>', ' i<a class="fnanchor">[8]</a>')
        units = read_units(BOOK + html)
        self.assertEqual(units[0].stanzas[0], ('i', [f'Line {i}.' for i in range(1, 10)]))

    def test_numbered_speech_is_not_split_into_new_cantos(self):
        units = read_units(BOOK + stanza() + '<p class="ph2">Cant. IIII.</p>' + stanza())
        self.assertEqual(units[-1].reference, 'I.iv')

    def test_fragment_keeps_its_actual_canto_numbers(self):
        html = '<p class="ph2">TWO CANTOS OF MUTABILITIE:</p><p class="ph2">Canto VI.</p>' + stanza()
        html += '<p class="ph2">Canto VII.</p>' + stanza()
        html += '<p class="ph2">The VIII. Canto, vnperfite.</p>' + stanza() + stanza('ii')
        units = read_units(html)
        self.assertEqual([u.canto for u in units], [6, 7, 8])
        self.assertIn('(fragment)', units[-1].title)

    def test_scope_rejects_missing_books(self):
        with self.assertRaisesRegex(ValueError, 'Unexpected book/canto sequence'):
            validate_scope([Unit(1, 1, [('i', ['line'] * 9)])])

    def test_alternative_ending_is_not_appended_as_subsequent_events(self):
        html = BOOK.replace('FIRST', 'THIRD') + '<p class="ph2">Cant. XII.</p>'
        html += ''.join(stanza(roman(i)) for i in range(1, 46))
        html += '<p>Stanzas xliii-xlv were first inserted in the 1596 quarto, displacing the following stanzas.</p>'
        html += stanza().replace('<span class="linenum">i</span>', '')
        unit = read_units(html)[-1]
        self.assertEqual(len(unit.stanzas), 45)

    def test_known_printed_number_is_retained_only_at_its_verified_ordinal(self):
        html = BOOK.replace('FIRST', 'SECOND') + '<p class="ph2">Cant. X.</p>'
        html += ''.join(stanza(roman(i)) for i in range(1, 74)) + stanza('lxiv')
        unit = read_units(html)[-1]
        self.assertEqual(unit.stanzas[-1][0], 'lxiv')
        self.assertIn('Stanza 074 (source lxiv)', unit.markdown())
        with self.assertRaisesRegex(ValueError, 'expected 1, found lxiv'):
            read_units(BOOK + stanza('lxiv'))


if __name__ == '__main__':
    unittest.main()
