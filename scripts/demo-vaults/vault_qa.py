"""Release checks for explicitly configured demo vault source layouts.

Replaces the legacy ingestion helper's inferred book/source and abbreviated YAML
parser. Unsupported source layouts must be prepared explicitly before packaging.
Literary/editorial review is separate; these checks do not judge AI opinions.
"""
import json
import hashlib
import re
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
    if 'inquiry_questions' in config:
        require(sorted(session['result'].get('questionId', '') for session in sidecar['sessions']) == sorted(config['inquiry_questions']), 'Required Inquiry questions are missing or duplicated')
    scene_by_id = {fm['ID']: path for path, fm, _ in scenes}
    refs = 0
    for session in sidecar['sessions']:
        result = session['result']
        require(result.get('scope') == 'book' and session.get('activeBookId') == config['book_folder'], 'Inquiry scope differs from the released book')
        require(result.get('aiStatus') == 'success' and result.get('findings'), 'Inquiry answer is not complete')
        require(not result.get('unverifiedFindings') and not result.get('citationIntegrityWarnings'), 'Inquiry citations need review')
        for ref in result['evidenceDocumentMeta']:
            require(ref['sceneId'] in scene_by_id, 'Unknown Inquiry scene ID')
            path = scene_by_id[ref['sceneId']]
            require(path == vault / ref['path'] and path.stem == ref['title'], 'Stale Inquiry scene reference')
            refs += 1
        for finding in result['findings']:
            require(finding.get('refId') in scene_by_id, 'Unknown Inquiry finding scene ID')
        if config.get('require_quoted_inquiry'):
            require(any(f.get('evidenceQuote', '').strip() for f in result['findings']), 'Inquiry quoted evidence is missing; replacement run required')
    return len(sidecar['sessions']), refs


def validate(vault, config):
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
        dates.append(datetime.fromisoformat(str(fm['When'])))
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
    return {'scenes': count, 'beats': len(beats), 'source_full_chapters_matched': source_books,
            'inquiry_sessions': session_count, 'evidence_references': refs,
            'wiki_links': links, 'latest_gossamer_runs': runs}
