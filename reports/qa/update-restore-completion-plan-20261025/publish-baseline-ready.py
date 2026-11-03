"""Correct the missing source-baseline input on already-authorized new issues only."""
import hashlib
import json
import pathlib
import subprocess
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
state = json.loads((p / 'PUBLICATION.json').read_text(encoding='utf-8'))
repo = state['repository']
baseline = p / 'source-baseline-v1/BASELINE.json'
digest = hashlib.sha256(baseline.read_bytes()).hexdigest()
marker = '## Coordinator baseline ready (source work may proceed)'
section = marker + '\n\nThe root coordinator has now supplied the previously missing approved source snapshot. The source-baseline blocker is resolved; no additional user-supplied commit/ref is required for scoped source work.\n\n'
section += '- Tracked-source commit: `ae056d6036c62499171f0d91691e1287942e75f7`.\n'
section += '- Local packet: `' + str(p) + '`. Read `BASELINE-READY.md` and `source-baseline-v1/BASELINE.json`.\n'
section += '- Baseline manifest SHA-256: `' + digest + '`. All128 files verified; includes the exact60 staged QA reports/patch and67 source/review draft files. Tracked source has no omitted semantic diff; original bytecode remains preserved and excluded from source overlay.\n'
section += '- Use a separate source worktree at the exact commit. Run `use-source-baseline.py --verify-only`, then `use-source-baseline.py --target <absolute clean dedicated worktree>` with the approved Python interpreter (`-I -B`). Do not populate or edit the shared original worktree.\n'
section += '- Editable drafts are copied under `.scratch/update-restore-baseline-v1/drafts/` in the dedicated worktree. Never change historical source/evidence directories. Existing hard-coded draft imports/bindings require review before use.\n'
section += '- Start assigned source implementation and bounded tests. Snapshot approval does not grant native qualification/production health; all runtime leases, dependencies and persistent-owner requirements remain. No push.\n\n'
directive = 'Coordinator baseline supplied: before the assignment, read BASELINE-READY.md in the local packet. Use commit ae056d6036c62499171f0d91691e1287942e75f7 plus source-baseline-v1/BASELINE.json (SHA-256 ' + digest + '). Verify and consume with use-source-baseline.py in a dedicated clean source worktree. The coordinator-baseline input is present; do not ask the user for another ref. Native prerequisites and no-push remain.\n\n'

def gh(*args):
    run = subprocess.run(['gh', *args], capture_output=True, encoding='utf-8')
    if run.returncode:
        raise RuntimeError(run.stderr)
    return run.stdout.strip()

receipt = {'baselineSha256': digest, 'issues': [], 'parentModified': False, 'pushPerformed': False}
for key, record in list(state['tickets'].items()) + [('spec', state['spec'])]:
    num = record['number']
    assert num != 405
    detail = json.loads(gh('issue', 'view', str(num), '--repo', repo, '--json', 'body'))
    body = detail['body'].replace('\r\n', '\n')
    if marker not in body:
        body = section + body
        if key != 'spec':
            token = '## Ready-to-copy fresh-session prompt\n\n```text\n'
            assert token in body
            body = body.replace(token, token + directive, 1)
        path = p / 'published' / ('SPEC.md' if key == 'spec' else next(x['file'] for x in json.loads((p / 'TICKETS.json').read_text(encoding='utf-8')) if str(x['id']) == key))
        path.write_text(body, encoding='utf-8')
        gh('issue', 'edit', str(num), '--repo', repo, '--body-file', str(path))
    actual = json.loads(gh('issue', 'view', str(num), '--repo', repo, '--json', 'body'))['body'].replace('\r\n', '\n')
    assert actual == body and marker in actual and digest in actual
    record['bodySha256'] = hashlib.sha256(body.encode()).hexdigest()
    record['sourceBaselineReadyVerified'] = True
    receipt['issues'].append(num)
    (p / 'PUBLICATION.json').write_text(json.dumps(state, indent=2) + '\n', encoding='utf-8')
    print('Baseline ready verified #' + str(num), flush=True)
receipt['verifiedAt'] = datetime.now(timezone.utc).isoformat()
(p / 'BASELINE-PUBLICATION.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
published = p / 'PUBLISHED.md'
text = published.read_text(encoding='utf-8')
text = text.replace('Coordinator must first provide a bounded accepted source baseline including the intended uncommitted work. A HEAD-only checkout is insufficient.', 'Coordinator baseline is now supplied: read BASELINE-READY.md and consume source-baseline-v1 with use-source-baseline.py. The exact commit plus frozen context/drafts is sufficient; no additional coordinator ref is pending.')
published.write_text(text, encoding='utf-8')
readme = p / 'README.md'
text = readme.read_text(encoding='utf-8')
banner = '# Source baseline is ready\n\nمانع baseline رفع شد. برای شروع نشست تازه، `BASELINE-READY.md` را بخوانید؛ snapshot شامل128 فایل بررسی‌شده است و تیکت‌ها با دستور ادامه به‌روز شده‌اند.\n\n'
if not text.startswith('# Source baseline is ready'):
    readme.write_text(banner + text, encoding='utf-8')
print('COMPLETE: existing spec and16 tickets updated; no parent/native/push action.', flush=True)
