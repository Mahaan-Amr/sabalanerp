"""Archive the successful approved material without building an image or running it."""
import gzip
import hashlib
import io
import json
import pathlib
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
EVIDENCE = ROOT/'reports/qa/issue-413-build-repair-20261025'
OUTPUT = pathlib.Path(json.loads((EVIDENCE/'successor-location.json').read_bytes())['directory'])


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def ref(file):
    raw = file.read_bytes()
    return dict(file=str(file), bytes=len(raw), sha256=sha(raw))


target = OUTPUT/'backend-material.tar.gz'
final = OUTPUT/'install-plan-final.json'
assert not target.exists() and not final.exists(), 'IMMUTABLE_OUTPUT_EXISTS'
plan = json.loads((OUTPUT/'install-plan.json').read_bytes())
receipt = pathlib.Path(plan['backendMaterial']['file'])
assert ref(receipt) == plan['backendMaterial']
material = json.loads(receipt.read_bytes())
assert material['materialized'] and material['sourceUnchanged'] and not material['imageBuilt']
assert material['shellSourceProjection']['sourceCommit'] == plan['sourceCommit']
context = pathlib.Path(material['context'])
actual = {p.relative_to(context).as_posix() for p in context.rglob('*') if p.is_file()}
expected = {row['path'] for row in material['files']}
assert actual == expected and len(expected) == len(material['files'])
rows = {row['path']: row for row in material['files']}


def content(name):
    parts = pathlib.PurePosixPath(name)
    assert parts.as_posix() == name and not parts.is_absolute() and '..' not in parts.parts and '\\' not in name
    file = context/name
    assert not file.is_symlink() and file.resolve() == file and file.stat().st_nlink == 1
    raw = file.read_bytes()
    assert len(raw) == rows[name]['bytes'] and sha(raw) == rows[name]['sha256']
    return raw


# Preflight every file before exclusive output creation.
for name in sorted(rows):
    content(name)
with target.open('xb') as stream, gzip.GzipFile(fileobj=stream, mode='wb', filename='', mtime=0) as gz, \
        tarfile.open(fileobj=gz, mode='w|', format=tarfile.PAX_FORMAT) as archive:
    for name in sorted(rows):
        raw = content(name)
        item = tarfile.TarInfo(name)
        item.size, item.mode, item.mtime = len(raw), 0o400, 0
        item.uid = item.gid = 0
        archive.addfile(item, io.BytesIO(raw))
seen = set()
with tarfile.open(target) as archive:
    for member in archive:
        assert member.isfile() and member.name not in seen and member.mode == 0o400
        assert archive.extractfile(member).read() == content(member.name)
        seen.add(member.name)
assert seen == expected
plan['backendMaterialArchive'] = {**ref(target), 'files': len(rows), 'image': False}
plan['supersedesIntermediatePlan'] = ref(OUTPUT/'install-plan.json')
with final.open('xb') as stream:
    stream.write((json.dumps(plan, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n').encode())
print(json.dumps(dict(plan=ref(final), backendMaterialArchive=plan['backendMaterialArchive'])))
