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
            self.assertIn('source.html', select_files(root, {**config, 'source_layout': 'gutenberg-holmes-html'}))

    def test_collection_export_keeps_exact_reviewed_runs_without_mutating_results(self):
        path = 'Radial Timeline/Inquiry/Briefing/current.md'
        result = {'runId': 'reviewed', 'summary': 'Original model words'}
        artifact = {'vault': {'displayName': 'Last selected book'}, 'sessions': [
            {'result': {'runId': 'obsolete'}, 'briefPath': 'old.md'},
            {'result': result, 'briefPath': path, 'logPath': 'private.md'}]}
        files = {'Radial Timeline/Inquiry/Sessions/sessions.json': json.dumps(artifact).encode(), path: b'Brief'}
        config = {'inquiry_run_ids': ['reviewed'], 'inquiry_vault': {'displayName': 'Collection', 'bookFolder': 'Book A'}}
        public = public_inquiry_files(files, config)
        saved = json.loads(public['Radial Timeline/Inquiry/Sessions/sessions.json'])
        self.assertEqual(len(saved['sessions']), 1)
        self.assertEqual(saved['sessions'][0]['result'], result)
        self.assertEqual(saved['vault'], config['inquiry_vault'])
        self.assertEqual(len(json.loads(files['Radial Timeline/Inquiry/Sessions/sessions.json'])['sessions']), 2)
        with self.assertRaisesRegex(ValueError, 'missing or duplicated'):
            public_inquiry_files(files, {**config, 'inquiry_run_ids': ['missing']})
        artifact['sessions'].append(artifact['sessions'][1])
        files['Radial Timeline/Inquiry/Sessions/sessions.json'] = json.dumps(artifact).encode()
        with self.assertRaisesRegex(ValueError, 'missing or duplicated'):
            public_inquiry_files(files, config)

    def test_holmes_source_checks_each_chapter_and_epilogue_without_captions(self):
        source = '<div class="chapter"><h2>CHAPTER I.</h2><p>A &amp; B.</p><p class="caption">Illustration caption.</p></div><div class="chapter"><h2>EPILOGUE</h2><p>The end.</p></div>'
        scenes = [(Path('1 Chapter.md'), {'ID': 'one', 'Act': 1}, 'Heading\n## Chapter Body\nA & B.'),
                  (Path('2 Epilogue.md'), {'ID': 'two', 'Act': 3}, 'Heading\n## Chapter Body\nThe end.')]
        config = {'source_layout': 'gutenberg-holmes-html', 'scene_count': 2, 'scene_acts': {'one': 1, 'two': 3}}
        self.assertEqual(validate_source(scenes, source, config), 2)
        with self.assertRaisesRegex(ValueError, 'coverage'): validate_source(scenes[:-1], source, config)
        scenes[1] = (scenes[1][0], scenes[1][1], 'Heading\n## Chapter Body\nChanged prose.')
        with self.assertRaisesRegex(ValueError, 'differs from source'): validate_source(scenes, source, config)
        scenes[1] = (scenes[1][0], {'ID': 'two', 'Act': 2}, 'Heading\n## Chapter Body\nThe end.')
        with self.assertRaisesRegex(ValueError, 'Incorrect Holmes act'): validate_source(scenes, source, config)

    def test_collection_inquiry_rejects_cross_book_citations_and_incomplete_corpora(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp); rows = []; sessions = []
            for book, sid in [('Book A', 'a'), ('Book B', 'b')]:
                scene = root / book / '1 Chapter.md'
                brief = f'Radial Timeline/Inquiry/Briefing/{sid}.md'
                (root / brief).parent.mkdir(parents=True, exist_ok=True); (root / brief).write_text('Saved briefing')
                path = str(scene.relative_to(root)); body = '## Chapter Body\nThe author’s words.'
                rows.append((scene, {'ID': sid}, body))
                result = {'questionId': 'setup-core', 'scope': 'book', 'aiStatus': 'success',
                          'findings': [{'refId': sid, 'evidenceQuote': "The author's words."}],
                          'evidenceDocumentMeta': [{'sceneId': sid, 'path': path, 'title': scene.stem}],
                          'corpusManifestSnapshot': [{'sceneId': sid, 'path': path, 'mode': 'full'}]}
                sessions.append({'activeBookId': book, 'status': 'saved', 'briefPath': brief, 'result': result})
            artifact = {'schemaVersion': 1, 'vault': {'bookFolder': 'Book A'}, 'sessions': sessions}
            config = {'source_layout': 'gutenberg-holmes-html', 'book_folder': 'Book A', 'books': [{'book_folder': 'Book A'}, {'book_folder': 'Book B'}], 'inquiry_session_count': 2, 'inquiry_questions': ['setup-core'], 'require_quoted_inquiry': True}
            sidecar = root / 'Radial Timeline/Inquiry/Sessions/sessions.json'; sidecar.parent.mkdir(parents=True)
            def check():
                sidecar.write_text(json.dumps(artifact))
                return validate_inquiry(root, config, rows)
            self.assertEqual(check(), (2, 2))
            result = sessions[0]['result']; result['findings'][0]['refId'] = 'b'
            with self.assertRaisesRegex(ValueError, 'selected book'): check()
            result['findings'][0]['refId'] = 'a'; result['findings'][0]['evidenceQuote'] = 'Fabricated quote.'
            with self.assertRaisesRegex(ValueError, 'quote differs'): check()
            result['findings'][0]['evidenceQuote'] = "The author's words."
            result['findings'][0]['supportingRefs'] = [{'refId': 'b', 'quote': "The author's words."}]
            with self.assertRaisesRegex(ValueError, 'another book'): check()
            del result['findings'][0]['supportingRefs']; result['corpusManifestSnapshot'] = []
            with self.assertRaisesRegex(ValueError, 'coverage is incomplete'): check()
            result['corpusManifestSnapshot'] = [{'sceneId': 'a', 'path': 'Book A/1 Chapter.md', 'mode': 'summary'}]
            with self.assertRaisesRegex(ValueError, 'not full'): check()
            result['corpusManifestSnapshot'][0]['mode'] = 'full'; sessions[1]['activeBookId'] = 'Book A'
            with self.assertRaisesRegex(ValueError, 'per-book Inquiry questions'): check()

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
