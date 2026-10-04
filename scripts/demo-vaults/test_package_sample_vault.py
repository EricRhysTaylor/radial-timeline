import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from package_sample_vault import build, public_inquiry_files, safe_relative, select_files, write_zip
from vault_qa import validate_inquiry, validate_source


class PackagingBoundaries(unittest.TestCase):
    def test_public_inquiry_removes_only_excluded_log_links(self):
        path = 'Radial Timeline/Inquiry/Briefing/IB-260101-1000.md'
        result = {'summary': 'Original model words', 'findings': [{'evidenceQuote': 'Exact source words'}]}
        artifact = {'schemaVersion': 1, 'sessions': [{'logPath': 'Radial Timeline/Logs/Inquiry/private.md', 'briefPath': path, 'result': result}]}
        files = {'Radial Timeline/Inquiry/Sessions/sessions.json': json.dumps(artifact).encode(), path: b'Original model words\n[[private|View full Inquiry Log \xe2\x86\x92]]\n', 'Book/1.md': b'Manuscript'}
        public = public_inquiry_files(files)
        saved = json.loads(public['Radial Timeline/Inquiry/Sessions/sessions.json'])
        self.assertNotIn('logPath', saved['sessions'][0])
        self.assertEqual(saved['sessions'][0]['result'], result)
        self.assertEqual(public[path], b'Original model words\n')
        self.assertEqual(public['Book/1.md'], files['Book/1.md'])
        self.assertIn('logPath', json.loads(files['Radial Timeline/Inquiry/Sessions/sessions.json'])['sessions'][0])

    def test_html_source_is_allowed_only_by_the_reviewed_layout(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); (root / 'source.html').write_text('<p>Source</p>')
            config = {'include_files': ['source.html']}
            with self.assertRaises(ValueError): select_files(root, config)
            self.assertIn('source.html', select_files(root, {**config, 'source_layout': 'gutenberg-odyssey-html'}))

    def test_odyssey_source_checks_all_books_and_acts(self):
        source = ''.join(f'<h2><a id="chap{n:02}"></a>BOOK I</h2><p>Book {n}: A &amp; B.</p></div><!--end chapter-->' for n in range(1, 25))
        scenes = [(Path(f'{n} Scene.md'), {'Book': n, 'Act': 1 if n <= 9 else 2 if n <= 16 else 3}, f'Book {n}: A & B.') for n in range(1, 25)]
        config = {'source_layout': 'gutenberg-odyssey-html'}
        self.assertEqual(validate_source(scenes, source, config), 24)
        with self.assertRaises(ValueError): validate_source(scenes[:-1], source, config)
        changed = [*scenes]; changed[10] = (changed[10][0], changed[10][1], 'Changed prose')
        with self.assertRaises(ValueError): validate_source(changed, source, config)
        scenes[10][1]['Act'] = 1
        with self.assertRaises(ValueError): validate_source(scenes, source, config)

    def test_inquiry_blocks_unverified_unknown_and_recovered_without_quotes(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); scene = root / 'Odyssey/1 Scene.md'
            sidecar = root / 'Radial Timeline/Inquiry/Sessions/sessions.json'
            sidecar.parent.mkdir(parents=True)
            brief_path = 'Radial Timeline/Inquiry/Briefing/IB-260101-1000.md'
            brief = root / brief_path; brief.parent.mkdir(parents=True); brief.write_text('Saved briefing')
            result = {'aiStatus': 'success', 'scope': 'book', 'findings': [{'refId': 'ody_scn_001'}], 'evidenceDocumentMeta': [{'sceneId': 'ody_scn_001', 'path': 'Odyssey/1 Scene.md', 'title': '1 Scene'}]}
            artifact = {'schemaVersion': 1, 'vault': {'bookFolder': 'Odyssey'}, 'sessions': [{'activeBookId': 'Odyssey', 'briefPath': brief_path, 'result': result}]}
            config = {'book_folder': 'Odyssey', 'inquiry_session_count': 1, 'require_quoted_inquiry': True}
            rows = [(scene, {'ID': 'ody_scn_001'}, 'Original prose')]
            def check():
                sidecar.write_text(json.dumps(artifact))
                return validate_inquiry(root, config, rows)
            with self.assertRaisesRegex(ValueError, 'quoted evidence'): check()
            result['findings'][0]['evidenceQuote'] = 'Original prose'
            self.assertEqual(check(), (1, 1))
            result['unverifiedFindings'] = [{'rawRefId': 'missing'}]
            with self.assertRaisesRegex(ValueError, 'need review'): check()
            del result['unverifiedFindings']; result['findings'][0]['refId'] = 'missing'
            with self.assertRaisesRegex(ValueError, 'Unknown Inquiry finding'): check()
            result['findings'][0]['refId'] = 'ody_scn_001'
            config['inquiry_questions'] = ['setup-core']
            with self.assertRaisesRegex(ValueError, 'questions'): check()
            result['questionId'] = 'setup-core'
            self.assertEqual(check(), (1, 1))
            artifact['sessions'][0]['briefPath'] = '../missing.md'
            with self.assertRaisesRegex(ValueError, 'briefing is missing'): check()

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
