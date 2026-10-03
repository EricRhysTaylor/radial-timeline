import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from package_sample_vault import build, safe_relative, select_files, write_zip


class PackagingBoundaries(unittest.TestCase):
    def test_unsafe_paths(self):
        for path in ['../secret.md', '/secret.md', '.obsidian/data.json', 'a/../b.md', 'a\\b.md', 'a//b.md']:
            with self.subTest(path=path), self.assertRaises(ValueError):
                safe_relative(path)

    def test_inclusion_and_credentials(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'good.md').write_text('Public book')
            (root / 'private.json').write_text('Private settings')
            config = {'include_files': ['good.md']}
            self.assertEqual(select_files(root, config), {'good.md': b'Public book'})
            for included in [['missing.md'], ['good.md', 'good.md']]:
                with self.assertRaises(ValueError):
                    select_files(root, {'include_files': included})
            (root / 'link.md').symlink_to(root / 'good.md')
            with self.assertRaises(ValueError):
                select_files(root, {'include_files': ['link.md']})
            (root / 'good.md').write_text('sk-ant-api03-' + 'x' * 32)
            with self.assertRaises(ValueError):
                select_files(root, config)

    def test_reproducible_zip(self):
        with tempfile.TemporaryDirectory() as temp:
            a, b = Path(temp) / 'a.zip', Path(temp) / 'b.zip'
            write_zip(a, 'Book', {'b.md': b'b', 'a.md': b'a'})
            write_zip(b, 'Book', {'a.md': b'a', 'b.md': b'b'})
            self.assertEqual(a.read_bytes(), b.read_bytes())

    def test_failed_qa_emits_nothing_and_never_overwrites(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); source = root / 'source'; source.mkdir()
            (source / 'a.md').write_text('Chapter')
            config = {'display_name': 'Book', 'sample_id': 'book', 'include_files': ['a.md']}
            output = root / 'output'
            with patch('package_sample_vault.validate', side_effect=ValueError('Incomplete Inquiry')):
                with self.assertRaises(ValueError): build(source, output, config)
            self.assertFalse(output.exists())
            with self.assertRaises(ValueError): build(source, output, {**config, 'sample_id': '../escape'})
            output.mkdir(); (output / 'keep').write_text('Keep')
            with self.assertRaises(ValueError): build(source, output, config)
            self.assertEqual((output / 'keep').read_text(), 'Keep')


if __name__ == '__main__':
    unittest.main()
