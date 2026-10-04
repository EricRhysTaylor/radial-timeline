#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyyaml==6.0.2"]
# ///
"""Build a verified content-only ZIP from a canonical demo vault.

Successor to Demo Vaults/Obsidian Vault Sherlock Holmes Demo/scripts/ingestion/
package_sample_vault.py. Uses an explicit inclusion list and the real portable
Inquiry sessions contract; never creates plugin state or promises an unsupported
first-run import. Existing outputs are refused, never recursively deleted.

uv run scripts/demo-vaults/package_sample_vault.py --source PATH --dist NEW_PATH
    --config scripts/demo-vaults/pride-and-prejudice.json
"""
import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tempfile
import zipfile
from vault_qa import require, validate


def safe_relative(value):
    path = PurePosixPath(value)
    require(bool(path.parts) and not path.is_absolute() and not any(p in ('.', '..') or p.startswith('.') for p in path.parts), f'Unsafe include path: {value}')
    require('\\' not in value and str(path) == value, f'Noncanonical include path: {value}')
    return path


def select_files(source, config):
    source = source.resolve()
    included = config['include_files']
    require(len(set(included)) == len(included), 'Duplicate include path')
    result = {}
    for rel in sorted(included):
        relative = safe_relative(rel)
        path = source.joinpath(*relative.parts)
        require(not any(source.joinpath(*relative.parts[:i]).is_symlink() for i in range(1, len(relative.parts) + 1)), f'Symlink inclusion refused: {rel}')
        require(path.is_file() and path.resolve().is_relative_to(source.resolve()), f'Missing/outside source file: {rel}')
        allowed = {'.md', '.json'}
        if config.get('source_layout') == 'gutenberg-odyssey-html':
            allowed.update(('.html', '.jpg'))
        require(path.suffix in allowed, f'Unsupported public content type: {rel}')
        data = path.read_bytes()
        require(not re.search(rb'(?:sk-ant-api\w*-|sk-proj-|sb_secret_)[A-Za-z0-9_-]{16,}', data), f'Credential-shaped content: {rel}')
        result[rel] = data
    return result


def write_zip(path, name, files):
    with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for rel, data in sorted(files.items()):
            entry = zipfile.ZipInfo(f'{name}/{rel}', date_time=(2026, 1, 1, 0, 0, 0))
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)


def public_inquiry_files(files):
    """Remove links to excluded working logs without changing AI findings."""
    public = dict(files)
    sidecar_path = 'Radial Timeline/Inquiry/Sessions/sessions.json'
    if sidecar_path not in public:
        return public
    artifact = json.loads(public[sidecar_path])
    for session in artifact['sessions']:
        session.pop('logPath', None)
        brief_path = session.get('briefPath')
        if brief_path in public:
            text = public[brief_path].decode('utf-8')
            text = re.sub(r'^\[\[[^\]\n]+\|View full Inquiry Log →\]\]\n?', '', text, flags=re.M)
            public[brief_path] = text.encode('utf-8')
    public[sidecar_path] = (json.dumps(artifact, indent=2, ensure_ascii=False) + '\n').encode('utf-8')
    return public


def build(source, dist, config):
    source = source.resolve(); dist = dist.resolve()
    require(source.is_dir() and not dist.exists(), 'Source must exist and output directory must be new')
    require(not dist.is_relative_to(source) and not source.is_relative_to(dist), 'Source and output must not overlap')
    name = config['display_name']
    require(len(safe_relative(name).parts) == 1, 'Output name must be one path component')
    require(re.fullmatch(r'[a-z0-9]+(?:-[a-z0-9]+)*', config['sample_id']) is not None, 'Sample ID must be a lowercase slug')
    original = select_files(source, config)
    included = public_inquiry_files(original)
    # The helper import is mandatory. Any failed check aborts before publication.
    with tempfile.TemporaryDirectory(prefix='rt-demo-build-') as temp:
        stage = Path(temp) / name
        for rel, data in included.items():
            path = stage / rel; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        qa = validate(stage, config)
        archive_path = Path(temp) / 'candidate.zip'
        write_zip(archive_path, name, included)
        with zipfile.ZipFile(archive_path) as archive:
            require(archive.testzip() is None, 'ZIP CRC failed')
            require(set(archive.namelist()) == {f'{name}/{rel}' for rel in included}, 'ZIP inventory differs')
            require(all(archive.read(f'{name}/{rel}') == data for rel, data in included.items()), 'ZIP bytes differ')
        # No overwrite, and recheck source bytes before emitting the reviewed artifact.
        require(select_files(source, config) == original, 'Source changed during packaging')
        dist.mkdir(parents=True, exist_ok=False)
        zip_path = dist / f"{config['sample_id']}-demo-vault.zip"
        zip_path.write_bytes(archive_path.read_bytes())
        manifest = {'schema_version': 1, 'sample_id': config['sample_id'], 'archive': zip_path.name,
                    'sha256': hashlib.sha256(zip_path.read_bytes()).hexdigest(), 'qa': qa,
                    'files': {rel: hashlib.sha256(data).hexdigest() for rel, data in included.items()},
                    'source_files': {rel: hashlib.sha256(data).hexdigest() for rel, data in original.items()}}
        (dist / 'release-inventory.json').write_text(json.dumps(manifest, indent=2) + '\n')
        print(json.dumps({'archive': str(zip_path), 'sha256': manifest['sha256'], 'files': len(included), 'qa': qa}, indent=2))
        return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--dist', type=Path, required=True)
    parser.add_argument('--config', type=Path, required=True)
    args = parser.parse_args()
    build(args.source, args.dist, json.loads(args.config.read_text()))
