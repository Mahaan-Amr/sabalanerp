"""Publish the approved packet through gh; persist each result before continuing."""
import hashlib
import json
import pathlib
import re
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
repo = 'Mahaan-Amr/sabalanerp'
rows = json.loads((p / 'TICKETS.json').read_text(encoding='utf-8'))
statefile = p / 'PUBLICATION.json'
state = json.loads(statefile.read_text(encoding='utf-8')) if statefile.exists() else {
    'approvedByUser': True, 'repository': repo, 'spec': None, 'tickets': {},
    'parentModified': False, 'pushPerformed': False, 'nativeExecutionPerformed': False,
}
(p / 'published').mkdir(exist_ok=True)

def save():
    statefile.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')

def gh(*args):
    out = subprocess.run(['gh', *args], capture_output=True, encoding='utf-8')
    if out.returncode:
        raise RuntimeError(out.stderr)
    return out.stdout.strip()

def issue(title, body, filename):
    path = p / 'published' / filename
    path.write_text(body, encoding='utf-8')
    # Recover unknown creation outcomes by exact unique title, never blindly duplicate.
    existing = json.loads(gh('issue', 'list', '--repo', repo, '--state', 'all', '--search', title + ' in:title', '--limit', '100', '--json', 'number,title,url'))
    exact = [x for x in existing if x['title'] == title]
    assert len(exact) <= 1
    url = exact[0]['url'] if exact else gh('issue', 'create', '--repo', repo, '--title', title, '--body-file', str(path), '--label', 'ready-for-agent')
    number = int(url.rsplit('/', 1)[1])
    detail = json.loads(gh('api', f'repos/{repo}/issues/{number}'))
    return {'number': number, 'url': url, 'id': detail['id'], 'bodySha256': hashlib.sha256(body.encode()).hexdigest()}

spec = (p / 'SPEC.md').read_text(encoding='utf-8')
spec = re.sub(r'Publication status: DRAFT for confirmation\..*?unchanged\.', 'Publication status: approved by the user for publication. Label: `ready-for-agent`. Parent #405 remains unchanged.', spec, count=1)
spec = spec.replace('The implementation stays paused pending seam and breakdown confirmation.', 'The user approved the existing-master test seam, breakdown and dependencies. Work begins only through scoped assignments; no runtime operation was performed during publication.')
spec += '\n\n## Fresh-session operating packet\n\nThe detailed local checkpoint is preserved on the owner workstation at `' + str(p) + '`. This packet includes unpushed/untracked source and evidence. A fresh remote checkout alone is insufficient; do not assume HEAD contains the staged work. Never push to make this assignment portable without user authorization.\n'
spec += '\n\n<details><summary>Parallel ownership and operational boundaries</summary>\n\n' + (p / 'PARALLEL.md').read_text(encoding='utf-8') + '\n</details>\n'
spec += '\n<details><summary>Source and evidence navigation</summary>\n\n' + (p / 'SOURCE-MAP.md').read_text(encoding='utf-8') + '\n</details>\n'
if state['spec'] is None:
    state['spec'] = issue('Spec: Finish verified update, recovery and current-data rollback', spec, 'SPEC.md')
    save()
    print('Published spec ' + state['spec']['url'], flush=True)

remaining = {x['id']: x for x in rows if str(x['id']) not in state['tickets']}
while remaining:
    frontier = [x for x in remaining.values() if all(str(b) in state['tickets'] for b in x['blockedBy'])]
    assert frontier, 'Dependency cycle'
    for x in frontier:
        n = x['id']
        body = (p / 'tickets' / x['file']).read_text(encoding='utf-8')
        body = re.sub(r'^# .*?\n\nPublication status:.*?\n\n', '', body, count=1, flags=re.S)
        refs = '\n'.join('- ' + state['tickets'][str(b)]['url'] for b in x['blockedBy']) if x['blockedBy'] else 'None (can start immediately).'
        body = re.sub(r'## Blocked by\n\n.*?\n\n## Execution ownership', '## Blocked by\n\n' + refs + '\n\n## Execution ownership', body, count=1, flags=re.S)
        top = 'Approved spec: ' + state['spec']['url'] + '\n\n'
        if x['blockedBy']:
            top += 'Blocked by: ' + ', '.join('#' + str(state['tickets'][str(b)]['number']) for b in x['blockedBy']) + '\n\n'
        top += 'Packet milestone **' + str(n).zfill(2) + '**. All bare milestone numbers below refer to approved packet IDs, not GitHub issue numbers.\n\n'
        prompt = (p / 'prompts' / x['file']).read_text(encoding='utf-8')
        body = top + body + '\n## Ready-to-copy fresh-session prompt\n\n```text\n' + prompt + '\n```\n'
        record = issue('Update/restore ' + str(n).zfill(2) + ': ' + x['title'], body, x['file'])
        record['packetId'] = n
        record['blockedBy'] = x['blockedBy']
        state['tickets'][str(n)] = record
        save()
        print('Published ' + str(n).zfill(2) + ' ' + record['url'], flush=True)
        del remaining[n]

# Native relationships mutate only the new dependent issue, never parent405.
for x in rows:
    current = state['tickets'][str(x['id'])]
    endpoint = f"repos/{repo}/issues/{current['number']}/dependencies/blocked_by"
    actual = json.loads(gh('api', endpoint))
    existing_ids = {v['id'] for v in actual}
    for b in x['blockedBy']:
        blocker = state['tickets'][str(b)]
        if blocker['id'] not in existing_ids:
            gh('api', '--method', 'POST', endpoint, '-F', 'issue_id=' + str(blocker['id']))
    actual = json.loads(gh('api', endpoint))
    assert {v['id'] for v in actual} == {state['tickets'][str(b)]['id'] for b in x['blockedBy']}
    current['nativeDependenciesVerified'] = True
    detail = json.loads(gh('issue', 'view', str(current['number']), '--repo', repo, '--json', 'body,labels,state'))
    expected = (p / 'published' / x['file']).read_text(encoding='utf-8')
    assert detail['body'].replace('\r\n', '\n') == expected
    assert detail['state'] == 'OPEN' and any(y['name'] == 'ready-for-agent' for y in detail['labels'])
    current['bodyAndLabelVerified'] = True
    save()
    print('Verified ' + str(x['id']).zfill(2), flush=True)

index = '\n\n## Published execution tickets\n\n'
for x in rows:
    record = state['tickets'][str(x['id'])]
    index += f"- Packet {x['id']:02d}: [{x['title']}]({record['url']})\n"
spec += index
spec = spec.replace('No issue has been published yet.', 'The approved tickets are published below; packet numbers remain stable.')
specfile = p / 'published' / 'SPEC.md'
specfile.write_text(spec, encoding='utf-8')
gh('issue', 'edit', str(state['spec']['number']), '--repo', repo, '--body-file', str(specfile))
detail = json.loads(gh('issue', 'view', str(state['spec']['number']), '--repo', repo, '--json', 'body,labels'))
assert detail['body'].replace('\r\n', '\n') == spec
assert any(y['name'] == 'ready-for-agent' for y in detail['labels'])
state['spec']['bodySha256'] = hashlib.sha256(spec.encode()).hexdigest()
state['verifiedAt'] = datetime.now(timezone.utc).isoformat()
state['status'] = 'published-and-readback-verified'
save()
for x in rows:
    x['githubIssue'] = state['tickets'][str(x['id'])]['number']
    x['githubUrl'] = state['tickets'][str(x['id'])]['url']
    x['publicationStatus'] = 'published'
(p / 'TICKETS.json').write_text(json.dumps(rows, indent=2) + '\n', encoding='utf-8')
print('COMPLETE: 1 spec, 16 tickets; all bodies, labels and native dependencies verified.', flush=True)
