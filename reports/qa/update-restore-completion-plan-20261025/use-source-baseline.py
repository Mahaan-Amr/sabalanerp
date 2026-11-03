"""Verify approved source baseline; optionally populate an existing clean dedicated worktree."""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import uuid

p = pathlib.Path(__file__).resolve().parent
b = p / 'source-baseline-v1'
raw_manifest = (b / 'BASELINE.json').read_bytes()
m = json.loads(raw_manifest)
sha = lambda raw: hashlib.sha256(raw).hexdigest()
parser = argparse.ArgumentParser()
parser.add_argument('--verify-only', action='store_true')
parser.add_argument('--target', type=pathlib.Path)
args = parser.parse_args()
assert args.verify_only or args.target, 'Use --verify-only or --target <existing dedicated worktree>'
for x in m['files']:
    file = (b / x['file']).resolve()
    assert file.is_relative_to(b.resolve())
    assert file.stat().st_size == x['bytes'] and sha(file.read_bytes()) == x['sha256'], x['file']

def git(root, *argv, env=None):
    return subprocess.check_output(['git', '-C', str(root), *argv], env=env, stderr=subprocess.PIPE)

source = pathlib.Path(m['repository'])
assert git(source, 'rev-parse', '--verify', m['baseCommit'] + '^{commit}').decode().strip() == m['baseCommit']
# Prove that the exact preserved report patch applies to this commit using only an owned alternate index.
index = b / ('.verification-index-' + uuid.uuid4().hex)
assert index.resolve().parent == b.resolve() and not index.exists()
env = dict(os.environ, GIT_INDEX_FILE=str(index.resolve()))
try:
    git(source, 'read-tree', m['baseCommit'], env=env)
    git(source, 'apply', '--cached', str(b / 'staged-evidence.patch'), env=env)
    applied = git(source, 'diff', '--cached', '--name-only', '-z', m['baseCommit'], env=env).split(b'\0')
    assert len([x for x in applied if x]) == 60
finally:
    if index.exists():
        index.unlink()

if args.target:
    target = args.target.resolve(strict=True)
    assert target != source.resolve(), 'Never populate the shared source worktree'
    actual_root = pathlib.Path(git(target, 'rev-parse', '--show-toplevel').decode().strip()).resolve()
    assert actual_root == target
    assert git(target, 'rev-parse', 'HEAD').decode().strip() == m['baseCommit']
    assert not git(target, 'diff', '--name-only').strip(), 'Target has tracked work; do not overwrite it'
    assert not git(target, 'diff', '--cached', '--name-only').strip(), 'Target index must remain clean'
    destinations = []
    for x in m['files']:
        if x['file'].startswith('evidence-overlay/'):
            relative = pathlib.Path(x['file']).relative_to('evidence-overlay')
            out = target / relative
        elif x['file'].startswith('drafts/'):
            out = target / '.scratch/update-restore-baseline-v1' / x['file']
        else:
            continue
        assert out.resolve().is_relative_to(target)
        if out.exists():
            assert out.is_file() and sha(out.read_bytes()) == x['sha256'], 'Conflicting target: ' + str(out)
        destinations.append((b / x['file'], out, x))
    for original, out, x in destinations:
        out.parent.mkdir(parents=True, exist_ok=True)
        if not out.exists():
            with out.open('xb') as f:
                f.write(original.read_bytes())
        assert sha(out.read_bytes()) == x['sha256']
    receipt = target / '.scratch/update-restore-baseline-v1/CONSUMED.json'
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps({'baseCommit': m['baseCommit'], 'baselineSha256': sha(raw_manifest), 'copiedFiles': len(destinations), 'sourceState': 'starting-source-not-native-qualified', 'nativeAllowed': False, 'pushAllowed': False}, indent=2) + '\n', encoding='utf-8')
    assert not git(target, 'diff', '--name-only').strip()
    assert not git(target, 'diff', '--cached', '--name-only').strip()

print(json.dumps({'baselineVerified': True, 'baseCommit': m['baseCommit'], 'baselineSha256': sha(raw_manifest), 'filesVerified': len(m['files']), 'stagedEvidencePatchAppliesToBase': True, 'target': str(args.target) if args.target else None, 'nativeExecution': False, 'push': False}))
