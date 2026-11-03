"""Read-only mixed-parent census. Held scopes are data, never unused grants."""
import base64, contextlib, hashlib, io, json, os, stat, sys
from pathlib import Path

ROOT = Path('/app/online-runtime-acceptance')
NAMES = ['application-prisma-ebcfd40fff0a28e39d983c6616893b50', 'inquiry-coherent-7878c93646acd9ac37cef95e27a4029d']
SUBPATH = 'c16-recovery-70360dba0eb244dc91cdfcd0533315f9/c16-recovery-32c29444431a4f98bc6070f4182e7bb8'

def identity(s):
    return {k: str(getattr(s, k)) for k in ['st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns']}

def fingerprint(root):
    digest = hashlib.sha256(); count = 0; size = 0; first = None
    def visit(parent, name, relative):
        nonlocal count, size, first
        before = os.stat(name, dir_fd=parent, follow_symlinks=False)
        if first is None: first = identity(before)
        record = {'path': relative, 'identity': identity(before)}
        count += 1; assert count <= 1000000, 'HELD_TREE_ENTRY_BOUND'
        if stat.S_ISDIR(before.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC, dir_fd=parent)
            try:
                assert identity(os.fstat(fd)) == identity(before), 'HELD_DIRECTORY_ALIAS'
                names = sorted(os.listdir(fd)); record['children'] = names
                for child in names: visit(fd, child, relative + '/' + child)
                assert sorted(os.listdir(fd)) == names and identity(os.fstat(fd)) == identity(before), 'HELD_DIRECTORY_CHANGED'
            finally: os.close(fd)
        elif stat.S_ISREG(before.st_mode):
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK | os.O_CLOEXEC, dir_fd=parent)
            try:
                assert identity(os.fstat(fd)) == identity(before), 'HELD_FILE_ALIAS'
                content = hashlib.sha256(); read = 0
                while raw := os.read(fd, 1024 * 1024):
                    content.update(raw); read += len(raw); size += len(raw)
                    assert size <= 16 * 1024**3, 'HELD_TREE_BYTE_BOUND'
                assert read == before.st_size and identity(os.fstat(fd)) == identity(before), 'HELD_FILE_CHANGED'
                record['sha256'] = content.hexdigest()
            finally: os.close(fd)
        elif stat.S_ISLNK(before.st_mode):
            record['linkSha256'] = hashlib.sha256(os.fsencode(os.readlink(name, dir_fd=parent))).hexdigest()
        else:
            record['specialDevice'] = str(before.st_rdev)
        assert identity(os.stat(name, dir_fd=parent, follow_symlinks=False)) == identity(before), 'HELD_ENTRY_CHANGED'
        digest.update(json.dumps(record, sort_keys=True, separators=(',', ':')).encode()); digest.update(b'\n')
    parent = os.open(root.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try: visit(parent, root.name, root.name)
    finally: os.close(parent)
    return {'name': root.name, 'identity': first, 'entries': count, 'bytes': size, 'treeSha256': digest.hexdigest()}

def observe():
    assert ROOT.resolve(strict=True) == ROOT
    fd = os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC)
    try:
        before = os.fstat(fd); assert stat.S_ISDIR(before.st_mode) and before.st_uid == 0 and stat.S_IMODE(before.st_mode) == 0o700
        names = sorted(os.listdir(fd)); assert all(n in names for n in NAMES)
        held = []
        for name in names:
            if name in NAMES: continue
            p = ROOT / name; s = p.lstat()
            assert stat.S_ISDIR(s.st_mode) and not p.is_symlink() and s.st_uid == 0, 'HELD_SCOPE_ROOT_INVALID'
            held.append(fingerprint(p))
        mounts = []
        for line in Path('/proc/self/mountinfo').read_text().splitlines():
            row = line.split()
            if row[4] == str(ROOT) or row[4].startswith(str(ROOT) + '/'): mounts.append(row)
        assert len(mounts) == 3, 'CURRENT_PARENT_EXACT_MOUNTS_REQUIRED'
        root = next(r for r in mounts if r[4] == str(ROOT))
        assert root[3].endswith('/sabalanerp-local_online_runtime_acceptance/_data/' + SUBPATH) and root[5].split(',')[0] == 'rw'
        selected = []
        for name in NAMES:
            child = next(r for r in mounts if r[4] == str(ROOT / name))
            assert child[3].endswith('/sabalanerp-local_online_runtime_acceptance/_data/' + name) and child[5].split(',')[0] == 'ro' and child[1] == root[0]
            selected.append({'target': child[4], 'root': child[3], 'readOnly': True})
        assert identity(os.fstat(fd)) == identity(ROOT.lstat()) == identity(before) and sorted(os.listdir(fd)) == names, 'CURRENT_PARENT_CHANGED'
        return {'parentIdentity': identity(before), 'entries': names, 'protectedEntries': held, 'mounts': {'target': str(ROOT), 'subpath': SUBPATH, 'namedVolume': 'sabalanerp-local_online_runtime_acceptance', 'readOnly': False, 'capsules': selected}}
    finally: os.close(fd)

def main():
    assert sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize
    spec = json.load(sys.stdin); assert set(spec) == {'canonicalSource', 'canonicalSpec'}
    source = base64.b64decode(spec['canonicalSource'], validate=True)
    assert hashlib.sha256(source).hexdigest() == 'a4f20672aec779899b037d775ade51cb84f24ade8f3cbcef5c8d3219f9513b65'
    assert hashlib.sha256(json.dumps(spec['canonicalSpec'], separators=(',', ':'), ensure_ascii=False).encode()).hexdigest() == '604472f73c22e1be20a8d63672be5dcafb2b4044d9858a6224df81339f835472'
    before = observe(); original = sys.stdin; output = io.StringIO()
    try:
        sys.stdin = io.TextIOWrapper(io.BytesIO(json.dumps(spec['canonicalSpec']).encode()))
        with contextlib.redirect_stdout(output): exec(compile(source, 'canonical-two-capsule-preflight', 'exec'), {'__name__': '__main__'})
    finally: sys.stdin = original
    assert len(output.getvalue().encode()) <= 65536
    canonical = json.loads(output.getvalue()); assert observe() == before, 'CURRENT_PARENT_OR_HELD_SCOPE_CHANGED'
    assert canonical['readOnly'] and canonical['capsulesVerified'] == 2 and not canonical['databaseExecuted'] and not canonical['nativeActorStarted']
    print(json.dumps({'format': 'sabalan-current-mixed-capsule-parent/v1', **before, 'canonicalCapsules': canonical, 'heldScopesStableDuringObservation': True, 'parentGloballyEmpty': False, 'unusedNamespaceClaimed': False, 'historicalClosureClaimed': False, 'readOnly': True, 'qualificationAccepted': False, 'productionAdmission': False}), flush=True)

if __name__ == '__main__': main()
