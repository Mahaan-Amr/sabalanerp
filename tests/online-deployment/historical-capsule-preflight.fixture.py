"""Read-only content preflight. Never runs a database, runtime or migration."""
import ast
import base64
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys

PRISMA = Path('/app/online-runtime-acceptance/application-prisma-ebcfd40fff0a28e39d983c6616893b50')
INQUIRY = Path('/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d')
SPEC_SHA = '604472f73c22e1be20a8d63672be5dcafb2b4044d9858a6224df81339f835472'


def check(value, message):
    if not value:
        raise AssertionError(message)


def digest(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(file, directory=False):
    value = file.lstat()
    check(not stat.S_ISLNK(value.st_mode) and value.st_uid == 0, 'CAPSULE_ALIAS_OR_OWNER')
    check(stat.S_ISDIR(value.st_mode) if directory else stat.S_ISREG(value.st_mode), 'CAPSULE_TYPE')
    check(directory or value.st_nlink == 1, 'CAPSULE_LINK_COUNT')
    check(file.resolve(strict=True) == file, 'CAPSULE_PATH_ALIAS')
    return [str(value.st_dev), str(value.st_ino), value.st_size, value.st_mtime_ns, value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink]


def read(file):
    before = identity(file)
    check(before[2] <= 16 * 1024**2, 'CAPSULE_METADATA_BOUND')
    raw = file.read_bytes()
    check(identity(file) == before, 'CAPSULE_METADATA_CHANGED')
    return raw


def native(file, expected, capture=False):
    raw = read(file)
    value = json.loads(raw)
    check(digest(raw) == expected and value['phase'] == 'QUIESCENT' and value['nativeReaped'] is True,
          'CAPSULE_NATIVE_CLOSURE_CHANGED')
    check(value.get('databaseQuiet') is True if capture else value.get('sqliteNativeClosed') is True,
          'CAPSULE_NATIVE_RESOURCE_NOT_CLOSED')
    check(not Path('/proc/' + str(value['guardian']['pid'])).exists(), 'CAPSULE_OLD_GUARDIAN_PRESENT')
    return raw


def original_inventory(prisma_source):
    tree = ast.parse(prisma_source)
    functions = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in ['digest', 'inventory']]
    check(len(functions) == 2, 'CAPSULE_PRISMA_HELPER_SHAPE')
    module = {'hashlib': hashlib, 'json': json, 'os': os, 'Path': Path}
    exec(compile(ast.Module(body=functions, type_ignores=[]), 'original-prisma-inventory', 'exec'), module)
    return module['inventory']


def main():
    raw = sys.stdin.buffer.read(4 * 1024**2 + 1)
    check(0 < len(raw) <= 4 * 1024**2, 'CAPSULE_SPEC_BOUND')
    spec = json.loads(raw)
    canonical = json.dumps(spec, separators=(',', ':'), ensure_ascii=False).encode()
    check(digest(canonical) == SPEC_SHA, 'CAPSULE_SOURCE_OWNED_SPEC_CHANGED')
    roots = {str(root): identity(root, True) for root in [PRISMA, INQUIRY]}
    proof_raw = read(PRISMA / 'generated-prisma-proof.json')
    check(json.loads(proof_raw) == spec['prisma'], 'CAPSULE_PRISMA_PROOF_CHANGED')
    initial_raw = read(PRISMA / 'initial-migration-coordination/deployment-runtime-native.json')
    initial = json.loads(initial_raw)
    check(digest(initial_raw) == spec['prismaNativeSha256'] and initial['phase'] == 'QUIESCENT'
          and initial['nativeStatus'] == 0 and initial['nativeReaped'] is True
          and initial['databaseQuiet'] is True and initial['stoppedBySignal'] is False,
          'CAPSULE_PRISMA_NATIVE_NOT_CLOSED')
    prisma_source = base64.b64decode(spec['prismaSource'], validate=True)
    check(digest(prisma_source) == '7af630e015aaf87872823b3f4e41bdfccd23214c356432604a7c149dcb347a79',
          'CAPSULE_PRISMA_HELPER_CHANGED')
    observed = original_inventory(prisma_source)(PRISMA / 'node_modules/@prisma/client', check)
    check(observed == spec['prisma']['capsule'], 'CAPSULE_PRISMA_CLIENT_CHANGED')
    prepared_raw = read(INQUIRY / 'prepared.json')
    prepared = json.loads(prepared_raw)
    locks = []
    lock_identities = []
    native_raw = {}
    try:
        for name in ['deployment-online-worker.lock', 'deployment-runtime-control.lock', 'deployment-write-admission.lock']:
            file = INQUIRY / 'coordination' / name
            before = identity(file)
            fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
            locks.append(fd)
            held = os.fstat(fd)
            check([str(held.st_dev), str(held.st_ino), held.st_size, held.st_mtime_ns, held.st_ctime_ns, held.st_mode, held.st_uid, held.st_nlink] == before
                  and held.st_nlink == 1, 'CAPSULE_LOCK_DESCRIPTOR_CHANGED')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            check(identity(file) == before, 'CAPSULE_LOCK_NAMED_CHANGED')
            lock_identities.append((file, before, fd))
        for role, expected in spec['inquiryNativeSha256'].items():
            directory = Path(prepared[role]['nativeDirectory'])
            check(directory.is_relative_to(INQUIRY) and directory.resolve(strict=True) == directory,
                  'CAPSULE_NATIVE_DIRECTORY_OUTSIDE_EXACT_ROOT')
            native_raw[role] = native(directory / 'deployment-runtime-native.json', expected, role == 'capture')
        dependency = spec['inquiry']['retainedDependencies']
        check(dependency == str(INQUIRY / 'app/node_modules'), 'CAPSULE_INQUIRY_DEPENDENCY_ROOT_CHANGED')
        source = base64.b64decode(spec['inquirySource'], validate=True)
        check(digest(source) == '197ae9581b67efd7f28a8e3b87422eaee81511bf486567b0d633cc716f5dcf91',
              'CAPSULE_INQUIRY_HELPER_CHANGED')
        child = subprocess.Popen(['/usr/local/bin/node', '-e', source.decode(), dependency],
                                 stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        stdout, stderr = child.communicate()
        check(child.returncode == 0 and child.stdout.closed and child.stderr.closed
              and len(stdout) <= 65536 and len(stderr) <= 65536, 'CAPSULE_INQUIRY_INVENTORY_NOT_CLOSED')
        expected = {key: spec['inquiry'][key] for key in ['entries', 'bytes', 'inventorySha256']}
        check(json.loads(stdout) == expected, 'CAPSULE_INQUIRY_DEPENDENCIES_CHANGED')
        for role, previous in native_raw.items():
            file = Path(prepared[role]['nativeDirectory']) / 'deployment-runtime-native.json'
            check(read(file) == previous, 'CAPSULE_NATIVE_CHANGED_DURING_INVENTORY')
        for file, before, fd in lock_identities:
            held = os.fstat(fd)
            check(identity(file) == before and
                  [str(held.st_dev), str(held.st_ino), held.st_size, held.st_mtime_ns, held.st_ctime_ns, held.st_mode, held.st_uid, held.st_nlink] == before
                  and held.st_nlink == 1, 'CAPSULE_LOCK_CHANGED_DURING_INVENTORY')
    finally:
        for fd in locks:
            os.close(fd)
    check(read(PRISMA / 'generated-prisma-proof.json') == proof_raw
          and read(PRISMA / 'initial-migration-coordination/deployment-runtime-native.json') == initial_raw
          and read(INQUIRY / 'prepared.json') == prepared_raw, 'CAPSULE_METADATA_CHANGED_DURING_PREFLIGHT')
    check(all(identity(Path(name), True) == before for name, before in roots.items()), 'CAPSULE_DIRECTORY_CHANGED')
    print(json.dumps({'readOnly': True, 'capsulesVerified': 2, 'directoryIdentities': roots,
                      'prisma': observed, 'inquiry': expected,
                      'lockIdentities': [{'file': str(file), 'identity': before} for file, before, fd in lock_identities],
                      'inventoryChild': {'originalPid': child.pid, 'code': child.returncode,
                                         'stdoutEof': child.stdout.closed, 'stderrEof': child.stderr.closed},
                      'databaseExecuted': False, 'nativeActorStarted': False, 'productionAdmission': False}))


if __name__ == '__main__':
    main()
