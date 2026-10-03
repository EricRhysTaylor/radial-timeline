"""Release checks for explicitly configured chapter-based Markdown demo vaults.

Replaces the legacy ingestion helper's inferred book/source and abbreviated YAML
parser. Unsupported source layouts must be prepared explicitly before packaging.
Literary/editorial review is separate; these checks do not judge AI opinions.
"""
import json
import re
from datetime import date, datetime
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

    source = (vault / config['source_file']).read_text(encoding='utf-8')
    headings = list(re.finditer(r'^(?:CHAPTER|Chapter)\s+([IVXLCDM]+)\.?\s*$', source, re.M))
    require(len(headings) == count, 'Source chapter coverage unavailable or incomplete')
    dates = []
    for i, (path, fm, body) in enumerate(scenes):
        chapter = source[headings[i].start():headings[i + 1].start() if i + 1 < count else len(source)]
        original = normalized(chapter); actual = normalized(body)
        if i == count - 1:
            trailer = normalized(config['source_trailer'])
            require(original.endswith(trailer), 'Source printer colophon changed')
            original = original[:-len(trailer)].rstrip() + ' ' + normalized(config['scene_trailer'])
        require(actual == original, f'Chapter text differs from source: {path.name}')
        require(fm.get('Summary') and fm.get('Synopsis'), f'Missing summary/synopsis: {path.name}')
        dates.append(date.fromisoformat(str(fm['When'])))
        require(str(fm.get('Pulse Update', '')).lower() not in ('yes', 'true'), f'Pending Pulse update: {path.name}')
        for key, expected in [('previousSceneAnalysis', i > 0), ('currentSceneAnalysis', True), ('nextSceneAnalysis', i < count - 1)]:
            rows = fm.get(key)
            require(bool(rows) == expected, f'Pulse boundary/coverage mismatch: {path.name}/{key}')
            if expected:
                ref = i + (0 if key.startswith('previous') else 2 if key.startswith('next') else 1)
                require(isinstance(rows, list) and rows[0].startswith(f'{ref} '), f'Pulse reference mismatch: {path.name}/{key}')
    require(dates == sorted(dates), 'Illustrative chapter dates are not ordered')

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

    sidecar = json.loads((vault / 'Radial Timeline/Inquiry/Sessions/sessions.json').read_text())
    require(len(sidecar['sessions']) == config['inquiry_session_count'], 'Inquiry sessions missing')
    scene_by_id = {fm['ID']: path for path, fm, _ in scenes}
    refs = 0
    for session in sidecar['sessions']:
        for ref in session['result']['evidenceDocumentMeta']:
            require(ref['sceneId'] in scene_by_id, 'Unknown Inquiry scene ID')
            path = scene_by_id[ref['sceneId']]
            require(path == vault / ref['path'] and path.stem == ref['title'], 'Stale Inquiry scene reference')
            refs += 1
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
    return {'scenes': count, 'beats': len(beats), 'source_full_chapters_matched': count,
            'inquiry_sessions': len(sidecar['sessions']), 'evidence_references': refs,
            'wiki_links': links, 'latest_gossamer_runs': runs}
