"""Package one closed native diagnostic capture; never publish a recovery point."""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tarfile


def check(value, code):
    if not value:
        raise RuntimeError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read(file, maximum=16 * 1024 ** 2):
    check(file.resolve(strict=True) == file, 'PRIVATE_PATH_REQUIRED')
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        check(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid()
              and before.st_nlink == 1 and not before.st_mode & 0o077
              and 0 < before.st_size <= maximum, 'PRIVATE_FILE_REQUIRED')
        with os.fdopen(os.dup(fd), 'rb') as stream:
            data = stream.read(maximum + 1)
        after = os.fstat(fd)
        identity = lambda item: (item.st_dev, item.st_ino, item.st_size, item.st_mtime_ns, item.st_ctime_ns)
        check(len(data) == before.st_size and identity(before) == identity(after)
              and identity(before) == identity(file.lstat()), 'PRIVATE_FILE_CHANGED')
        os.fsync(fd)
        return data
    finally:
        os.close(fd)


def write(file, data):
    with file.open('xb') as stream:
        os.chmod(file, 0o400)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())


def main():
    root, destination = map(Path, sys.argv[1:])
    check(root.parent == destination.parent == Path('/app/online-runtime-acceptance')
          and re.fullmatch(r'coherent-capture-[a-f0-9]{32}', root.name)
          and re.fullmatch(r'coherent-seal-[a-f0-9]{32}', destination.name)
          and root.resolve(strict=True) == root and not destination.exists(), 'PRIVATE_SCOPE_REQUIRED')
    gate = os.open(root / 'deployment-write-admission.lock', os.O_RDWR | os.O_NOFOLLOW)
    control = os.open(root / 'native-control/deployment-runtime-control.lock', os.O_RDWR | os.O_NOFOLLOW)
    for descriptor in (gate, control):
        fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
    closure_bytes = read(root / 'native-control/deployment-runtime-native.json', 16384)
    closure = json.loads(closure_bytes)
    check(closure['phase'] == 'QUIESCENT' and closure['role'] == 'control'
          and closure['nativeReaped'] is True and closure['databaseQuiet'] is True
          and closure['nativeStatus'] == 0 and closure['stoppedBySignal'] is False,
          'NATIVE_CLOSURE_REQUIRED')
    active = {key: value for key, value in closure.items()
              if key not in ['nativeReaped', 'databaseQuiet', 'nativeStatus', 'stoppedBySignal', 'activeClaimSha256']}
    active['phase'] = 'ACTIVE'
    active_sha = digest((json.dumps(active, sort_keys=True, separators=(',', ':')) + '\n').encode())
    captured_bytes = read(root / 'captured-component/captured.json', 65536)
    captured = json.loads(captured_bytes)
    check(captured['phase'] == 'CAPTURED_AWAITING_NATIVE_CLOSURE'
          and captured['productionRecoveryPoint'] is False
          and captured['nativeClaimSha256'] == active_sha
          and captured['database']['namespace'] == closure['namespace'], 'CAPTURE_CLOSURE_CHANGED')
    scope_bytes = read(root / 'captured-component/scope.json', 65536)
    check(digest(scope_bytes) == captured['scopeSha256'], 'CAPTURE_SCOPE_CHANGED')
    gate_stat, control_stat = os.fstat(gate), os.fstat(control)
    check(closure['captureGate']['file'] == str(root / 'deployment-write-admission.lock')
          and closure['captureGate']['device'] == str(gate_stat.st_dev)
          and closure['captureGate']['inode'] == str(gate_stat.st_ino)
          and closure['lock'] == dict(device=str(control_stat.st_dev), inode=str(control_stat.st_ino)),
          'NATIVE_LOCK_CHANGED')
    # Observe the cluster again. A closed JSON record alone is not authority.
    namespace = closure['namespace']
    check(re.fullmatch(r'sabalan-rt-[a-f0-9]{48}', namespace), 'NATIVE_NAMESPACE_REQUIRED')
    from urllib.parse import unquote, urlsplit
    connection = urlsplit(os.environ['DATABASE_URL'])
    check(connection.hostname == closure['connection']['host'] == 'postgres'
          and (connection.port or 5432) == closure['connection']['port'], 'SOURCE_CLUSTER_CHANGED')
    environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    environment.update(PGHOST=connection.hostname, PGPORT=str(connection.port or 5432),
                       PGUSER=unquote(connection.username), PGPASSWORD=unquote(connection.password),
                       PGDATABASE='postgres', PGCONNECT_TIMEOUT='5',
                       PGOPTIONS='-c statement_timeout=10000 -c search_path=pg_catalog')
    query = "SELECT system_identifier::text||'/'||(SELECT count(*) FROM pg_stat_activity WHERE application_name='" + namespace + "')::text||'/'||(SELECT count(*) FROM pg_prepared_xacts)::text FROM pg_control_system()"
    observed = subprocess.check_output(['psql', '-X', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query], env=environment).decode().strip()
    check(observed == closure['clusterIdentifier'] + '/0/0', 'NATIVE_DATABASE_NOT_QUIET')
    birth = closure['guardian']
    if birth['bootId'] == Path('/proc/sys/kernel/random/boot_id').read_text().strip() and Path('/proc/' + str(birth['pid'])).exists():
        observed_ticks = Path('/proc/' + str(birth['pid']) + '/stat').read_text().rsplit(') ', 1)[1].split()[19]
        check(observed_ticks != birth['startTicks'], 'NATIVE_GUARDIAN_STILL_PRESENT')
    spec = importlib.util.spec_from_file_location('coherent_file_generations', root / 'recovery-file-generations.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    store = module.FileGenerations(str(root / 'store'), gate, str(gate_stat.st_dev), str(gate_stat.st_ino))
    manifest = store.verify(captured['fileGenerationSha256'])
    check(manifest['generation'] == 1 and manifest['previousSha256'] is None and len(manifest['entries']) == 2,
          'DIAGNOSTIC_GENERATION_REQUIRED')
    dump = read(root / 'captured-component/main.dump', 32 * 1024 ** 2)
    check(len(dump) == captured['logicalDump']['bytes'] and digest(dump) == captured['logicalDump']['sha256'], 'DUMP_CHANGED')
    files = {'capture/scope.json': scope_bytes, 'capture/captured.json': captured_bytes,
             'capture/main.dump': dump, 'native/source-closure.json': closure_bytes,
             'source-proof.json': read(root / 'native-proof.json', 65536),
             'tools/recovery-file-generations.py': read(root / 'recovery-file-generations.py')}
    generation = '000000000001-' + manifest['captureId']
    for name in ['intent.json', 'manifest.json']:
        files['files/captures/' + generation + '/' + name] = read(root / 'store/captures' / generation / name)
    for entry in manifest['entries']:
        name = entry['sha256']
        content = read(root / 'store/objects' / name)
        check(digest(content) == name and len(content) == entry['bytes'], 'OBJECT_CHANGED')
        files['files/objects/' + name] = content
    check(sum(map(len, files.values())) <= 48 * 1024 ** 2, 'DIAGNOSTIC_BOUND_EXCEEDED')
    destination.mkdir(mode=0o700)
    package = destination / 'component.tar'
    with package.open('xb') as output:
        os.chmod(package, 0o400)
        with tarfile.open(fileobj=output, mode='w', format=tarfile.USTAR_FORMAT) as archive:
            import io
            for name, data in sorted(files.items()):
                item = tarfile.TarInfo(name)
                item.size, item.mode = len(data), 0o400
                archive.addfile(item, io.BytesIO(data))
        output.flush()
        os.fsync(output.fileno())
    result = dict(format='sabalan-private-coherent-package/v1', productionRecoveryPoint=False,
                  sourceRoot=str(root), sourceClosureSha256=digest(closure_bytes), nativeClaimSha256=active_sha,
                  fileGenerationSha256=captured['fileGenerationSha256'],
                  packageBytes=package.stat().st_size, packageSha256=digest(read(package, 64 * 1024 ** 2)),
                  files=[dict(name=name, bytes=len(data), sha256=digest(data)) for name, data in sorted(files.items())])
    write(destination / 'package-proof.json', json.dumps(result, sort_keys=True).encode())
    for path in [destination, destination.parent]:
        descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY)
        os.fsync(descriptor)
        os.close(descriptor)
    check(read(root / 'native-control/deployment-runtime-native.json') == closure_bytes, 'CLOSURE_CHANGED')
    print(json.dumps(result))


if __name__ == '__main__':
    main()
