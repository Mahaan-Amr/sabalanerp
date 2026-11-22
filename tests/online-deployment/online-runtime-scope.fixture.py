"""Real read-only grant mounts/aliases in the two existing passive slots.

This validates native identity inputs only. It cannot admit a public runtime,
publish traffic, create a release acceptance, or modify a business database.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import sys


def write(file, data):
    with file.open('xb') as stream:
        os.chmod(file, 0o400)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def source_lock(path):
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd = os.open(path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
    value = os.fstat(fd)
    os.fsync(fd)
    os.close(fd)
    return dict(file=str(path), device=str(value.st_dev), inode=str(value.st_ino), ownerUid=value.st_uid)


def main():
    root = Path(sys.argv[1])
    assert root.parent == Path('/app/online-runtime-acceptance') and root.name.startswith('online-authority-')
    mode = sys.argv[2]
    if mode == 'prepare':
        assert os.getuid() == 0
        root.mkdir(mode=0o700)
        authority = Path('/app/runtime-authority')
        assert authority.is_dir() and authority.resolve(strict=True) == authority
        os.chmod(authority, 0o700)
        coordination = root / 'coordination'
        coordination.mkdir(mode=0o700)
        gate = source_lock(coordination / 'deployment-write-admission.lock')
        interlock = source_lock(coordination / 'deployment-runtime-control.lock')
        worker = source_lock(coordination / 'deployment-online-worker.lock')
        grants = []
        for purpose in ['http', 'jobs', 'capture']:
            runtime_id = secrets.token_hex(32)
            native = coordination / 'online/native' / runtime_id
            boundary = coordination / 'online/work' / runtime_id
            native.mkdir(mode=0o700, parents=True)
            boundary.mkdir(mode=0o700, parents=True)
            source_lock(native / 'deployment-runtime-control.lock')
            scope = dict(format='sabalan-online-runtime-scope/v1', runtimeId=runtime_id,
                         releaseId='native-authority-diagnostic', manifestSha256='a' * 64,
                         sourceCommit='b' * 40, image='sha256:33cb69566bb1de4f8895e73486be364ccad1d60e978ba0a30f34c210ecf6f505',
                         nonce=secrets.token_hex(32), purpose=purpose,
                         role='serving' if purpose == 'http' else 'control',
                         coordinationDirectory=str(coordination), nativeDirectory=str(native),
                         boundaryDirectory=str(boundary), gate=gate, interlock=interlock,
                         worker=worker if purpose != 'http' else None,
                         database=dict(systemIdentifier='7667464637415309346', name='sabalanerp'))
            encoded = (json.dumps(scope, sort_keys=True, separators=(',', ':')) + '\n').encode()
            write(authority / (runtime_id + '.json'), encoded)
            grants.append(dict(file='/run/sabalan-online/' + runtime_id + '.json', sha256=hashlib.sha256(encoded).hexdigest(),
                               role=scope['role'], scope=scope))
        # Hardlink/symlink cases are distinct files: do not change a valid grant.
        raw = (authority / (grants[0]['scope']['runtimeId'] + '.json')).read_bytes()
        hardlink = secrets.token_hex(32) + '.json'
        write(authority / hardlink, raw)
        os.link(authority / hardlink, authority / (hardlink + '-alias'))
        symlink = secrets.token_hex(32) + '.json'
        os.symlink(grants[0]['scope']['runtimeId'] + '.json', authority / symlink)
        invalid = []
        for kind in ['unknown-field', 'wrong-purpose', 'native-directory-escape', 'missing-worker',
                     'changed-gate-inode', 'invalid-database', 'noncanonical']:
            scope = json.loads(json.dumps(grants[0]['scope']))
            runtime_id = secrets.token_hex(32)
            scope['runtimeId'] = runtime_id
            scope['nativeDirectory'] = str(coordination / 'online/native' / runtime_id)
            scope['boundaryDirectory'] = str(coordination / 'online/work' / runtime_id)
            for name in ['nativeDirectory', 'boundaryDirectory']:
                Path(scope[name]).mkdir(mode=0o700)
            source_lock(Path(scope['nativeDirectory']) / 'deployment-runtime-control.lock')
            if kind == 'unknown-field':
                scope['manualPass'] = True
            elif kind == 'wrong-purpose':
                scope['purpose'] = 'promote'
            elif kind == 'native-directory-escape':
                scope['nativeDirectory'] = str(root)
            elif kind == 'missing-worker':
                scope['purpose'], scope['role'] = 'jobs', 'control'
            elif kind == 'changed-gate-inode':
                scope['gate']['inode'] = str(int(scope['gate']['inode']) + 1)
            elif kind == 'invalid-database':
                scope['database']['systemIdentifier'] = 'unknown'
            if kind == 'noncanonical':
                encoded = json.dumps(scope, indent=2).encode()
            else:
                encoded = (json.dumps(scope, sort_keys=True, separators=(',', ':')) + '\n').encode()
            write(authority / (runtime_id + '.json'), encoded)
            invalid.append(dict(kind=kind, file='/run/sabalan-online/' + runtime_id + '.json',
                                sha256=hashlib.sha256(encoded).hexdigest(), role=scope['role']))
        probe = json.loads(json.dumps(grants[0]['scope']))
        probe['runtimeId'] = secrets.token_hex(32)
        probe['nativeDirectory'] = str(coordination / 'online/native' / probe['runtimeId'])
        probe['boundaryDirectory'] = str(coordination / 'online/work' / probe['runtimeId'])
        for name in ['nativeDirectory', 'boundaryDirectory']:
            Path(probe[name]).mkdir(mode=0o700)
        source_lock(Path(probe['nativeDirectory']) / 'deployment-runtime-control.lock')
        encoded = (json.dumps(probe, sort_keys=True, separators=(',', ':')) + '\n').encode()
        write(authority / (probe['runtimeId'] + '.json'), encoded)
        index = dict(grants=grants, hardlink='/run/sabalan-online/' + hardlink,
                     symlink='/run/sabalan-online/' + symlink, invalid=invalid,
                     cacheProbe=dict(file='/run/sabalan-online/' + probe['runtimeId'] + '.json',
                                     sha256=hashlib.sha256(encoded).hexdigest(), role=probe['role'], scope=probe))
        write(root / 'grant-index.json', json.dumps(index).encode())
        fd = os.open(authority, os.O_RDONLY | os.O_DIRECTORY)
        os.fsync(fd)
        os.close(fd)
        print(json.dumps(dict(prepared=True, grants=len(grants), root=str(root))))
        return
    spec = importlib.util.spec_from_file_location('online_native_scope', root / 'online-runtime-scope.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    index = json.loads((root / 'grant-index.json').read_text())
    observed = []
    for grant in index['grants']:
        environment = dict(os.environ, BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
                           BACKEND_RUNTIME_ROLE=grant['role'], RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'])
        if mode == 'readonly':
            loaded = module.load_scope(environment)
            assert loaded['scope'] == grant['scope'] and loaded['sha256'] == grant['sha256']
            assert loaded['mountId'].isdigit()
            observed.append(dict(purpose=grant['scope']['purpose'], mountId=loaded['mountId'], runtimeId=grant['scope']['runtimeId']))
            assert os.stat(index['hardlink']).st_nlink == 2
            assert Path(index['symlink']).is_symlink()
            for changed in [dict(environment, BACKEND_ONLINE_SCOPE_SHA256='0' * 64),
                            dict(environment, BACKEND_RUNTIME_ROLE='candidate'),
                            dict(environment, RECOVERY_COORDINATION_DIR=str(root)),
                            {key: value for key, value in environment.items() if key != 'BACKEND_ONLINE_SCOPE_SHA256'},
                            dict(environment, BACKEND_ONLINE_SCOPE_FILE=index['hardlink']),
                            dict(environment, BACKEND_ONLINE_SCOPE_FILE=index['symlink'])]:
                try:
                    module.load_scope(changed)
                except RuntimeError as error:
                    assert str(error) == 'ONLINE_RUNTIME_SCOPE_UNPROVEN'
                else:
                    raise AssertionError('Changed or aliased authority was accepted')
        elif mode == 'writable-alias':
            try:
                module.load_scope(environment)
            except RuntimeError as error:
                assert str(error) == 'ONLINE_RUNTIME_SCOPE_UNPROVEN'
            else:
                raise AssertionError('Read-only grant with actual writable alias was accepted')
        else:
            raise AssertionError('Unknown native fixture mode')
    assert module.load_scope({}) is None
    if mode == 'readonly':
        for item in index['invalid']:
            environment = dict(os.environ, BACKEND_ONLINE_SCOPE_FILE=item['file'], BACKEND_ONLINE_SCOPE_SHA256=item['sha256'],
                               BACKEND_RUNTIME_ROLE=item['role'], RECOVERY_COORDINATION_DIR=index['grants'][0]['scope']['coordinationDirectory'])
            try:
                module.load_scope(environment)
            except RuntimeError as error:
                assert str(error) == 'ONLINE_RUNTIME_SCOPE_UNPROVEN'
            else:
                raise AssertionError('Invalid native grant accepted: ' + item['kind'])
    print(json.dumps(dict(pass_=True, mode=mode, grants=observed,
                         moduleSha256=hashlib.sha256((root / 'online-runtime-scope.py').read_bytes()).hexdigest())))


if __name__ == '__main__':
    os.umask(0o077)
    main()
