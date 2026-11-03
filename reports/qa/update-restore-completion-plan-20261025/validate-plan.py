"""Validate local planning artifacts and preservation; no runtime/tracker mutation."""
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
cp = json.loads((p / 'CHECKPOINT.json').read_text(encoding='utf-8'))
r = pathlib.Path(cp['repository'])
rows = json.loads((p / 'TICKETS.json').read_text(encoding='utf-8'))
assert len(rows) == 16
ids = {x['id'] for x in rows}
assert ids == set(range(1, 17))
seen = set()
order = []
while len(seen) < len(rows):
    frontier = [x['id'] for x in rows if x['id'] not in seen and set(x['blockedBy']) <= seen]
    assert frontier, 'Cyclic or missing dependency'
    seen.update(frontier)
    order.extend(frontier)
for x in rows:
    assert set(x['blockedBy']) <= ids and x['id'] not in x['blockedBy']
    assert (x['githubIssue'] is None and x['publicationStatus'] == 'draft') or (isinstance(x['githubIssue'], int) and x['publicationStatus'] == 'published')
    for folder in ['tickets', 'prompts']:
        s = (p / folder / x['file']).read_text(encoding='utf-8')
        assert len(s) > 900
    body = (p / 'tickets' / x['file']).read_text(encoding='utf-8')
    assert all(h in body for h in ['## Parent', '## What to build', '## Acceptance criteria', '## Blocked by', '## Handoff contract'])
    assert '- [ ] ' in body
assert 12 in rows[9]['blockedBy']
assert rows[11]['blockedBy'] == [8, 9]

def git(*args):
    return subprocess.check_output(['git', '-C', str(r), *args])

sha = lambda b: hashlib.sha256(b).hexdigest()
coordinator_file = p / 'COORDINATOR-STATE.json'
expected_head = json.loads(coordinator_file.read_text(encoding='utf-8'))['head'] if coordinator_file.exists() else cp['head']
preservation = {
    'headMatchesRecordedCoordinatorState': git('rev-parse', 'HEAD').decode().strip() == expected_head,
    'stagedPatch': sha(git('diff', '--cached', '--binary')) == cp['stagedPatchSha256'],
    'trackedPyc': sha(pathlib.Path(cp['trackedPyc']['file']).read_bytes()) == cp['trackedPyc']['sha256'],
    'stashHead': git('rev-parse', 'refs/stash').decode().strip() == cp['stashHead'],
}
assert all(preservation.values()), preservation
for name in ['README.md', 'SPEC.md', 'PARALLEL.md', 'SOURCE-MAP.md', 'DOMAIN-DECISIONS.md', 'REVIEW.md']:
    s = (p / name).read_text(encoding='utf-8')
    assert 'PRIVATE KEY-----' not in s
result = {
    'validatedAt': datetime.now(timezone.utc).isoformat(),
    'scope': 'Local planning packet only; not runtime acceptance',
    'ticketCount': len(rows),
    'promptCount': len(list((p / 'prompts').glob('*.md'))),
    'acyclic': True,
    'topologicalOrder': order,
    'initialSourceFrontier': [x['id'] for x in rows if not x['blockedBy']],
    'preservation': preservation,
    'trackerPublished': all(x['publicationStatus'] == 'published' for x in rows),
    'runtimeExecuted': False,
    'pushPerformed': False,
}
(p / 'VALIDATION.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
manifest = {'format': 'local-planning-packet-sha256/v1', 'files': []}
for f in sorted(p.rglob('*')):
    if f.is_file() and f.name != 'MANIFEST.json':
        b = f.read_bytes()
        manifest['files'].append({'file': f.relative_to(p).as_posix(), 'bytes': len(b), 'sha256': sha(b)})
(p / 'MANIFEST.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
print(json.dumps(result))
