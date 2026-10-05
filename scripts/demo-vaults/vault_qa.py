"""Release checks for explicitly configured demo vault source layouts.

Replaces the legacy ingestion helper's inferred book/source and abbreviated YAML
parser. Unsupported source layouts must be prepared explicitly before packaging.
Literary/editorial review is separate; these checks do not judge AI opinions.
"""
import json
import hashlib
import re
import unicodedata
from datetime import datetime
from html.parser import HTMLParser
from pathlib import Path
import yaml


def require(condition, message):
    if not condition:
        raise ValueError(message)


def read_note(path):
    text = path.read_text(encoding='utf-8')
    match = re.match(r'\A---\n(.*?)\n---(?:\n|$)', text, re.S)
    require(match is not None, f'Missing frontmatter: {path.name}')
    return yaml.safe_load(match[1]), text[match.end():]


def normalized(text):
    return re.sub(r'\s+', ' ', text).strip().casefold()


class SourceText(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts = []

    def handle_data(self, data):
        self.parts.append(data)

    def handle_endtag(self, tag):
        if tag in ('p', 'div', 'br'):
            self.parts.append('\n')


def validate_source(scenes, source, config):
    layout = config.get('source_layout', 'chapter-markdown')
    if layout == 'gutenberg-holmes-html':
        from bs4 import BeautifulSoup
        soup = BeautifulSoup(source, 'html.parser')
        chapters = []
        for div in soup.select('div.chapter'):
            heading = div.find(re.compile(r'^h[1-6]$'))
            if heading and re.match(r'^(CHAPTER|EPILOGUE)\b', heading.get_text(' ', strip=True), re.I):
                heading.decompose()
                for caption in div.select('.caption'):
                    caption.decompose()
                chapters.append(div.get_text())
        require(len(chapters) == len(scenes) == config['scene_count'], 'Holmes source chapter coverage is incomplete')
        for (path, fm, body), original in zip(scenes, chapters):
            require('## Chapter Body\n' in body, f'Missing chapter body: {path.name}')
            manuscript = body.split('## Chapter Body\n', 1)[1]
            # Retain source spelling, punctuation and case; inline HTML spacing can differ.
            require(re.sub(r'\s', '', manuscript) == re.sub(r'\s', '', original), f'Chapter text differs from source: {path.name}')
            require(fm.get('Act') == config['scene_acts'][fm['ID']], f'Incorrect Holmes act: {path.name}')
        return len(chapters)
    if layout == 'gutenberg-odyssey-html':
        chapters = re.findall(r'<h2><a id="chap(\d{2})"></a>\s*BOOK [IVXLCDM]+</h2>(.*?)</div><!--end chapter-->', source, re.S)
        require([int(n) for n, _ in chapters] == list(range(1, 25)), 'Odyssey source must contain all 24 books')
        require({fm.get('Book') for _, fm, _ in scenes} == set(range(1, 25)), 'Odyssey scene book coverage is incomplete')
        require([fm['Book'] for _, fm, _ in scenes] == sorted(fm['Book'] for _, fm, _ in scenes), 'Odyssey books are out of narrative order')
        for number, html in chapters:
            parser = SourceText(); parser.feed(html)
            rows = [row for row in scenes if row[1]['Book'] == int(number)]
            require(normalized('\n'.join(body for _, _, body in rows)) == normalized(''.join(parser.parts)), f'Odyssey Book {number} differs from source')
            act = 1 if int(number) <= 9 else 2 if int(number) <= 16 else 3
            require(all(fm.get('Act') == act for _, fm, _ in rows), f'Incorrect Odyssey act: Book {number}')
        return 24
    require(layout == 'chapter-markdown', f'Unsupported source layout: {layout}')
    headings = list(re.finditer(r'^(?:CHAPTER|Chapter)\s+([IVXLCDM]+)\.?\s*$', source, re.M))
    count = config['scene_count']
    require(len(headings) == count, 'Source chapter coverage unavailable or incomplete')
    for i, (path, _, body) in enumerate(scenes):
        chapter = source[headings[i].start():headings[i + 1].start() if i + 1 < count else len(source)]
        original = normalized(chapter)
        if i == count - 1:
            trailer = normalized(config['source_trailer'])
            require(original.endswith(trailer), 'Source printer colophon changed')
            original = original[:-len(trailer)].rstrip() + ' ' + normalized(config['scene_trailer'])
        require(normalized(body) == original, f'Chapter text differs from source: {path.name}')
    return count


def validate_inquiry(vault, config, scenes):
    sidecar = json.loads((vault / 'Radial Timeline/Inquiry/Sessions/sessions.json').read_text())
    require(sidecar.get('schemaVersion') == 1, 'Unknown Inquiry sidecar schema')
    require(len(sidecar['sessions']) == config['inquiry_session_count'], 'Inquiry sessions missing')
    require(sidecar.get('vault', {}).get('bookFolder') == config['book_folder'], 'Inquiry book identity mismatch')
    collection = config.get('source_layout') == 'gutenberg-holmes-html'
    if collection:
        expected = sorted((b['book_folder'], q) for b in config['books'] for q in config['inquiry_questions'])
        require(sorted((s.get('activeBookId'), s['result'].get('questionId', '')) for s in sidecar['sessions']) == expected, 'Required per-book Inquiry questions are missing or duplicated')
    elif 'inquiry_questions' in config:
        require(sorted(session['result'].get('questionId', '') for session in sidecar['sessions']) == sorted(config['inquiry_questions']), 'Required Inquiry questions are missing or duplicated')
    scene_by_id = {fm['ID']: path for path, fm, _ in scenes}
    refs = 0
    for session in sidecar['sessions']:
        result = session['result']
        book_folder = session.get('activeBookId') if collection else config['book_folder']
        book_scenes = {sid: p for sid, p in scene_by_id.items() if p.parent == vault / book_folder}
        brief = session.get('briefPath', '')
        relative = Path(brief)
        require(bool(brief) and not relative.is_absolute() and '..' not in relative.parts
                and brief.startswith('Radial Timeline/Inquiry/Briefing/')
                and (vault / relative).is_file(), 'Saved Inquiry briefing is missing from the public files')
        require(result.get('scope') == 'book' and session.get('activeBookId') == book_folder and book_scenes, 'Inquiry scope differs from the released book')
        require(result.get('aiStatus') == 'success' and result.get('findings'), 'Inquiry answer is not complete')
        require(not result.get('unverifiedFindings') and not result.get('citationIntegrityWarnings'), 'Inquiry citations need review')
        for ref in result['evidenceDocumentMeta']:
            require(ref['sceneId'] in book_scenes, 'Unknown Inquiry scene ID for selected book')
            path = book_scenes[ref['sceneId']]
            require(path == vault / ref['path'] and path.stem == ref['title'], 'Stale Inquiry scene reference')
            refs += 1
        for finding in result['findings']:
            require(finding.get('refId') in book_scenes, 'Unknown Inquiry finding scene ID for selected book')
        if config.get('require_quoted_inquiry'):
            require(any(f.get('evidenceQuote', '').strip() for f in result['findings']), 'Inquiry quoted evidence is missing; replacement run required')
        if collection:
            require(session.get('status') == 'saved', 'Inquiry session did not finish saving')
            require(len(result['evidenceDocumentMeta']) == len(book_scenes) and {x['sceneId'] for x in result['evidenceDocumentMeta']} == set(book_scenes), 'Inquiry evidence coverage is incomplete')
            corpus = result['corpusManifestSnapshot']
            require(len(corpus) == len(book_scenes) and {x['sceneId'] for x in corpus} == set(book_scenes), 'Inquiry manuscript coverage is incomplete')
            require(all(x['mode'] == 'full' and x['path'] == str(book_scenes[x['sceneId']].relative_to(vault)) for x in corpus), 'Inquiry manuscript evidence is not full or belongs to another book')
            bodies = {fm['ID']: body.split('## Chapter Body\n', 1)[1] for _, fm, body in scenes if fm['ID'] in book_scenes}
            for finding in result['findings']:
                quotes = [{'refId': finding['refId'], 'quote': finding.get('evidenceQuote', '')}, *finding.get('supportingRefs', [])]
                for ref in quotes:
                    require(ref['refId'] in book_scenes, 'Inquiry supporting reference belongs to another book')
                    if 'refPath' in ref:
                        require(ref['refPath'] == str(book_scenes[ref['refId']].relative_to(vault)), 'Stale Inquiry supporting path')
                    require(ref['quote'].strip() and quoted_text(ref['quote']) in quoted_text(bodies[ref['refId']]), 'Inquiry quote differs from source')
                require(all(ref in book_scenes for ref in finding.get('related', [])), 'Inquiry related reference belongs to another book')
    return len(sidecar['sessions']), refs


def quoted_text(text):
    return re.sub(r'\s+', ' ', unicodedata.normalize('NFKC', text).translate(str.maketrans({'’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-'}))).strip()


def validate_book(vault, config):
    book = vault / config['book_folder']
    notes = [(p, *read_note(p)) for p in book.glob('*.md')]
    scenes = sorted((row for row in notes if row[1].get('Class') == 'Scene'),
                    key=lambda row: int(row[0].name.split(' ', 1)[0]))
    beats = [row for row in notes if row[1].get('Class') == 'Beat']
    count = config['scene_count']
    require(len(scenes) == count, 'Scene count differs from release contract')
    require([int(p.name.split(' ', 1)[0]) for p, _, _ in scenes] == list(range(1, count + 1)), 'Chapter numbering is incomplete')
    require(len(beats) == config['beat_count'], 'Beat count differs from release contract')
    ids = [fm.get('ID') for _, fm, _ in scenes + beats]
    require(all(ids) and len(set(ids)) == len(ids), 'Missing or duplicate scene/beat IDs')

    source_path = vault / config['source_file']
    for relative, digest in config.get('source_hashes', {}).items():
        require(hashlib.sha256((vault / relative).read_bytes()).hexdigest() == digest, f'Original source changed: {relative}')
    source_books = validate_source(scenes, source_path.read_text(encoding='utf-8'), config)
    dates = []
    for i, (path, fm, body) in enumerate(scenes):
        require(fm.get('Summary') and fm.get('Synopsis'), f'Missing summary/synopsis: {path.name}')
        if not config.get('allow_undated') or fm.get('When'):
            dates.append(datetime.fromisoformat(str(fm['When'])))
        if 'scene_dates' in config:
            require(str(fm.get('When') or '') == config['scene_dates'][fm['ID']], f'Reviewed date changed: {path.name}')
        require(str(fm.get('Pulse Update', '')).lower() not in ('yes', 'true'), f'Pending Pulse update: {path.name}')
        for key, expected in [('previousSceneAnalysis', i > 0), ('currentSceneAnalysis', True), ('nextSceneAnalysis', i < count - 1)]:
            rows = fm.get(key)
            require(bool(rows) == expected, f'Pulse boundary/coverage mismatch: {path.name}/{key}')
            if expected:
                ref = i + (0 if key.startswith('previous') else 2 if key.startswith('next') else 1)
                require(isinstance(rows, list) and rows[0].startswith(f'{ref} '), f'Pulse reference mismatch: {path.name}/{key}')
    if config.get('source_layout', 'chapter-markdown') == 'chapter-markdown':
        require(dates == sorted(dates), 'Illustrative chapter dates are not ordered')
    if 'beat_positions' in config:
        require({fm['ID']: path.name.split(' ', 1)[0] for path, fm, _ in beats} == config['beat_positions'], 'Reviewed beat positions changed')

    runs = {}
    for path, fm, _ in beats:
        for signal in ['momentum', 'tension', 'activity', 'interiority']:
            slots = [int(m[1]) for key in fm if (m := re.fullmatch(r'GossamerSignal(\d+)', key)) and fm[key] == signal]
            require(bool(slots), f'Missing {signal}: {path.name}')
            slot = max(slots, key=lambda n: datetime.fromisoformat(str(fm[f'GossamerCreatedAt{n}']).replace('Z', '+00:00')))
            require(0 <= fm[f'Gossamer{slot}'] <= 100 and fm.get(f'Gossamer{slot} Justification'), f'Invalid score: {path.name}')
            run = fm[f'GossamerRunId{slot}']
            require(signal not in runs or runs[signal] == run, f'Mixed latest {signal} run')
            runs[signal] = run
            require(fm[f'GossamerModel{slot}'] and fm[f'GossamerProvider{slot}'], f'Missing provenance: {path.name}')
    if 'gossamer_runs' in config:
        require(runs == config['gossamer_runs'], 'Reviewed Gossamer runs changed')

    return scenes, beats, {'scenes': count, 'beats': len(beats), 'source_full_chapters_matched': source_books, 'latest_gossamer_runs': runs}


def validate(vault, config):
    collection = config.get('source_layout') == 'gutenberg-holmes-html'
    contracts = config['books'] if collection else [config]
    require(contracts and len({b['book_folder'] for b in contracts}) == len(contracts), 'Missing or duplicate released books')
    scenes = []; beats = []; books = {}
    for contract in contracts:
        book_scenes, book_beats, summary = validate_book(vault, contract)
        scenes.extend(book_scenes); beats.extend(book_beats); books[contract['book_folder']] = summary
    ids = [fm['ID'] for _, fm, _ in scenes + beats]
    require(len(set(ids)) == len(ids), 'Duplicate IDs across released books')
    if collection:
        manifest, _ = read_note(vault / 'Sample Vault Config.md')
        require(manifest.get('rt_sample_vault') is True and manifest.get('schema_version') == 1, 'Sample detection manifest is invalid')
        require(manifest.get('book_folder') == config['book_folder'] and manifest.get('books') == [{'title': b['title'], 'source_folder': b['book_folder']} for b in contracts], 'Sample book profiles differ from release contract')
    session_count, refs = validate_inquiry(vault, config, scenes)
    links = 0
    md_paths = list(vault.rglob('*.md'))
    for path in md_paths:
        for target in re.findall(r'\[\[([^\]|]+)(?:\|[^\]]*)?\]\]', path.read_text().replace('\\|', '|')):
            target = target.split('#', 1)[0]
            if not target:
                continue
            relative = Path(target if target.endswith('.md') else target + '.md')
            require(not relative.is_absolute() and '..' not in relative.parts, 'Unsafe wiki target')
            matches = [p for p in md_paths if p == vault / relative or ('/' not in target and p.name == relative.name)]
            require(len(matches) == 1, f'Broken/ambiguous link in {path.relative_to(vault)}: {target}')
            links += 1
    qa = {'scenes': len(scenes), 'beats': len(beats), 'source_full_chapters_matched': sum(b['source_full_chapters_matched'] for b in books.values()),
          'inquiry_sessions': session_count, 'evidence_references': refs, 'wiki_links': links}
    if collection:
        qa['books'] = books
    else:
        qa['latest_gossamer_runs'] = books[config['book_folder']]['latest_gossamer_runs']
    return qa
