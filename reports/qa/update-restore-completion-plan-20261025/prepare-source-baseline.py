"""Freeze bounded source inputs; never change the source index/worktree or run native jobs."""
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
cp = json.loads((p / 'CHECKPOINT.json').read_text(encoding='utf-8'))
r = pathlib.Path(cp['repository'])
b = p / 'source-baseline-v1'
assert not b.exists(), 'Immutable baseline already exists; verify it instead of overwriting'
sha = lambda raw: hashlib.sha256(raw).hexdigest()
def git(*args):
    return subprocess.check_output(['git', '-C', str(r), *args])
assert git('rev-parse', 'HEAD').decode().strip() == cp['head']
patch = git('diff', '--cached', '--binary')
assert sha(patch) == cp['stagedPatchSha256']
assert sha(pathlib.Path(cp['trackedPyc']['file']).read_bytes()) == cp['trackedPyc']['sha256']
assert git('rev-parse', 'refs/stash').decode().strip() == cp['stashHead']
staged = [v.decode() for v in git('diff', '--cached', '--name-only', '-z').split(b'\0') if v]
assert len(staged) == 60 and all(v.startswith('reports/qa/') for v in staged)
changes = [v.decode() for v in git('diff', '--name-only', '-z').split(b'\0') if v]
assert changes == ['deploy/scripts/__pycache__/private-image-filesystem-capacity.cpython-314.pyc'], changes
untracked = [v.decode() for v in git('ls-files', '--others', '--exclude-standard', '-z', '--', 'scripts', 'deploy', 'tests', 'backend', 'frontend', 'docs', '.agents').split(b'\0') if v]
assert all(v.endswith('.pyc') and '__pycache__/' in v for v in untracked), untracked

evidence = json.loads((p / 'EVIDENCE.json').read_text(encoding='utf-8'))
drafts = [x for x in evidence if x.get('directory')]
assert len(drafts) == 2
sources = []
for item in drafts:
    for f in item['files']:
        raw = pathlib.Path(f['file']).read_bytes()
        assert sha(raw) == f['sha256'], f['file']
        sources.append((pathlib.Path(f['file']), 'drafts/' + item['key'] + '/' + pathlib.Path(f['file']).name, raw))
# Freeze the reviewed crypto packets too, so the same baseline serves the initial frontier.
for version, key in [(6, 'r6'), (7, 'r7')]:
    root = pathlib.Path('D:/sabalanerp-online-qa/' + ('C30-source-a-fixed-existing-gzip-stream-source-r6-frontend-owner-component-selector-20261025' if version == 6 else 'C30-source-a-fixed-existing-gzip-stream-source-r7-typed-component-rsa-projection-20261025'))
    review = root / 'source-review.json'
    matching = [v for v in evidence if v.get('file') and pathlib.Path(v['file']) == review]
    assert len(matching) == 1 and sha(review.read_bytes()) == matching[0]['sha256']
    record = json.loads(review.read_text(encoding='utf-8'))
    sources.append((review, 'drafts/' + root.name + '/source-review.json', review.read_bytes()))
    for f in record['files'].values():
        path = pathlib.Path(f['file'])
        assert path.parent == root
        raw = path.read_bytes()
        assert sha(raw) == f['sha256'], str(path)
        sources.append((path, 'drafts/' + root.name + '/' + path.name, raw))

files = []
def put(relative, raw, origin, state):
    dest = b / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    assert not dest.exists()
    dest.write_bytes(raw)
    files.append({'file': relative, 'sha256': sha(raw), 'bytes': len(raw), 'origin': origin, 'state': state})

put('staged-evidence.patch', patch, 'unchanged original Git index: 60 QA reports', 'context-not-runtime-authority')
for rel in staged:
    raw = git('show', ':' + rel)
    put('evidence-overlay/' + rel, raw, 'original index:' + rel, 'context-not-runtime-authority')
for origin, relative, raw in sources:
    assert b'-----BEGIN PRIVATE KEY-----' not in raw and b'-----BEGIN RSA PRIVATE KEY-----' not in raw
    put(relative, raw, str(origin), 'immutable-starting-source-not-native-qualified')

manifest = {
    'format': 'sabalan-coordinator-source-baseline/v1',
    'approvedAt': datetime.now(timezone.utc).isoformat(),
    'approvedBy': 'root operational coordinator for the user-approved ticket plan',
    'baseCommit': cp['head'], 'repository': str(r),
    'scope': 'Source implementation and bounded behavioral tests for tickets409-418; no global native or production admission',
    'trackedSourceAudit': 'No semantic tracked source diff against HEAD. All 60 staged paths are QA reports. Only unstaged semantic diff is preserved tracked bytecode, excluded from source overlay. Two migration status entries have no Git content diff; do not rewrite them.',
    'stagedPatchSha256': sha(patch),
    'sourceOverlayRequired': False,
    'contextOverlayRequired': True,
    'draftCopiesRequired': True,
    'preserveOriginalPyc': cp['trackedPyc'], 'preserveStash': cp['stashHead'],
    'nativeAllowed': False, 'pushAllowed': False,
    'files': files,
}
(b / 'BASELINE.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
assert sha(git('diff', '--cached', '--binary')) == cp['stagedPatchSha256']
assert sha(pathlib.Path(cp['trackedPyc']['file']).read_bytes()) == cp['trackedPyc']['sha256']
assert git('rev-parse', 'refs/stash').decode().strip() == cp['stashHead']
print(json.dumps({'baseline': str(b / 'BASELINE.json'), 'baseCommit': cp['head'], 'files': len(files), 'sourceDraftFiles': len(sources), 'bytes': sum(x['bytes'] for x in files)}))
