"""Resolve a fulfilled source prerequisite without closing pending native acceptance."""
import hashlib
import json
import pathlib
import re
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
repo = 'Mahaan-Amr/sabalanerp'
r = p.parents[2]

def gh(*args):
    result = subprocess.run(['gh', *args], capture_output=True, encoding='utf-8')
    if result.returncode:
        raise RuntimeError(result.stderr)
    return result.stdout.strip()

def git(*args):
    return subprocess.check_output(['git', '-C', str(r), *args])

sha = lambda raw: hashlib.sha256(raw).hexdigest()
source = '5f844c0dc6a408bda67c81ada9622403bb3d30f1'
carrier_receipt_raw = git('show', '9887efa6:reports/qa/inquiry-carrier-411-validation.json')
carrier_receipt = json.loads(carrier_receipt_raw)
assert carrier_receipt['sourceCommit'] == source
assert carrier_receipt['sourceTree'] == git('rev-parse', source + '^{tree}').decode().strip()
for path, identity in carrier_receipt['files'].items():
    raw = git('show', source + ':' + path)
    assert sha(raw) == identity['sha256'] and len(raw) == identity['bytes'], path
consumer_raw = git('show', '05305541:reports/qa/issue-410-inquiry-consumption-20261025/RECEIPT.json')
assert sha(consumer_raw) == '748a7c17375172a45238af92dcd214b84531556f758c56e96ed2bc3554e206e1'
consumer = json.loads(consumer_raw)
for revision in ['154778f8', 'fd7a12c6', '05305541']:
    git('cat-file', '-e', revision + '^{commit}')
current = json.loads(gh('issue', 'view', '417', '--repo', repo, '--json', 'body'))['body'].replace('\r\n', '\n')
deps = json.loads(gh('api', f'repos/{repo}/issues/417/dependencies/blocked_by'))
assert {x['number'] for x in deps} <= {409,410,411}
assert all(x['state'] == 'closed' for x in deps if x['number'] in [409,410])
assert json.loads(gh('issue', 'view', '411', '--repo', repo, '--json', 'state'))['state'] == 'OPEN'

section = '''## Source prerequisites satisfied — ready for source integration

The coordinator verified the source-only prerequisite from #411. #409 and #410 are closed for their source scope. #411 remains OPEN for genuine native acceptance, but that future acceptance is not a prerequisite for implementing source09 here.

Verified inputs:
- #411 final source `5f844c0dc6a408bda67c81ada9622403bb3d30f1`, receipt commit `9887efa6`: all five source file sizes/SHA-256 and source tree match the receipt.
- #410 already consumed the #411 producer. Consume its latest consumer `154778f8`, contract `fd7a12c6` and receipt `05305541` without duplicating the carrier commits. Receipt SHA-256: `748a7c17375172a45238af92dcd214b84531556f758c56e96ed2bc3554e206e1`.
- Read the complete #409/#410/#411 handoffs and verify ancestry before integrating. These are input/receipt checks, not a rerun of their tests or proof of genuine restore.

The overly broad native GitHub edge to the whole open #411 is removed because its required source deliverable has been supplied. Its source provenance remains recorded below. Native #411 criteria, Linux-only skipped tests, actual Inquiry stop/closure and genuine FULL/production acceptance remain pending and must be earned in the existing coordinator runtime milestones, including #419. Do not close #411, mark native tests PASS, or grant deployment authority to clear this UI state.

Start scoped source implementation and bounded tests now in a dedicated worktree using the supplied baseline. No shared Docker/SQL/SSH, image rebuild, live master or push is authorized by this correction.

'''
marker = '## Source prerequisites satisfied — ready for source integration'
body = current
if marker not in body:
    body = section + body
    body = body.replace('Blocked by: #409, #410, #411', 'Source prerequisites: #409 and #410 (source complete); #411 source accepted by the coordinator as recorded above. Native acceptance remains pending.')
    body = body.replace('## Blocked by\n\n- https://github.com/Mahaan-Amr/sabalanerp/issues/409\n- https://github.com/Mahaan-Amr/sabalanerp/issues/410\n- https://github.com/Mahaan-Amr/sabalanerp/issues/411', '## Source prerequisites\n\n- #409: source scope complete; consume its recorded local commits.\n- #410: source scope complete; consume its latest carrier-aware consumer.\n- #411: required source delivered and hash-verified; future native acceptance does not block source09.')
    body = body.replace('Execute completion ticket 09 after its published dependencies are complete.', 'Execute source completion ticket09 now: required source prerequisites409/410/411 are supplied. Read the coordinator source-acceptance section above; do not wait for native411 closure. Verify and integrate the actual local source inputs, preserving all runtime gates.')
out = p / 'published/09-master-complete-integration.md'
out.write_text(body, encoding='utf-8')
gh('issue', 'edit', '417', '--repo', repo, '--body-file', str(out))
for dep in deps:
    if dep['number'] == 411:
        gh('api', '--method', 'DELETE', f"repos/{repo}/issues/417/dependencies/blocked_by/{dep['id']}")
after = json.loads(gh('api', f'repos/{repo}/issues/417/dependencies/blocked_by'))
assert all(x['state'] == 'closed' for x in after)
assert not any(x['number'] == 411 for x in after)
actual = json.loads(gh('issue', 'view', '417', '--repo', repo, '--json', 'body'))['body'].replace('\r\n', '\n')
assert actual == body
assert json.loads(gh('issue', 'view', '411', '--repo', repo, '--json', 'state'))['state'] == 'OPEN'
receipt = {
    'verifiedAt': datetime.now(timezone.utc).isoformat(),
    'issue': 417, 'activeNativeGithubBlockers': [],
    'removedOverbroadIssueEdge': 411, 'sourcePrerequisiteRetainedInBody': True,
    'source411FilesVerified': len(carrier_receipt['files']),
    'consumer410ReceiptSha256': sha(consumer_raw),
    'native411StillOpen': True, 'runtimeGatesChanged': False,
    'testsRerun': False, 'nativeExecuted': False, 'pushPerformed': False,
    'issueBodySha256': sha(body.encode()),
}
(p / '417-SOURCE-READY.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
statepath = p / 'PUBLICATION.json'
state = json.loads(statepath.read_text(encoding='utf-8'))
state['tickets']['9']['bodySha256'] = receipt['issueBodySha256']
state['tickets']['9']['nativeDependencyOverride'] = {'blockedByGithub': [x['number'] for x in after], 'fulfilledSourcePrerequisite': 411, 'reason': 'source readiness independently verified; native acceptance remains in runtime milestones'}
statepath.write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
print(json.dumps(receipt))
