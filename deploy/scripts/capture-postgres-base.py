#!/usr/bin/env python3
"""Private physical-base capture, NOT a coherent application recovery point.

Requires an already-held inherited host ownership lock and private staging.
Nothing is uploaded, pruned, restored, published as healthy, or admitted online.
The returned plaintext component must be encrypted before off-host transfer.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import stat
import subprocess
import sys
import tarfile
import time


def require(condition, code):
    if not condition:
        raise RuntimeError(code)


def digest(file):
    result = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def capture(options):
    require(sys.platform == 'linux' and os.getuid() == 0, 'PHYSICAL_BASE_HOST_REQUIRED')
    require(options.project in ['sabalanerp', 'sabalanerp-local', 'sabalanerp-backup-drill'], 'PHYSICAL_BASE_PROJECT_INVALID')
    require(re.fullmatch(r'[a-z][a-z0-9-]{7,95}', options.operation_id), 'PHYSICAL_BASE_ID_INVALID')
    require(re.fullmatch(r'sha256:[a-f0-9]{64}', options.image), 'PHYSICAL_BASE_IMAGE_INVALID')
    require(re.fullmatch(r'[0-9]{1,20}', options.system_identifier), 'PHYSICAL_BASE_SYSTEM_INVALID')
    require(re.fullmatch(r'[a-z0-9][a-z0-9_.-]{1,127}', options.container), 'PHYSICAL_BASE_CONTAINER_INVALID')
    root = Path(options.root)
    require(root.is_absolute() and root.resolve(strict=True) == root, 'PHYSICAL_BASE_ROOT_INVALID')
    root_stat = root.stat()
    require(stat.S_ISDIR(root_stat.st_mode) and root_stat.st_uid == 0 and root_stat.st_mode & 0o077 == 0, 'PHYSICAL_BASE_ROOT_INVALID')

    def ownership():
        named = Path(options.lock_file)
        require(named.is_absolute() and named.resolve(strict=True) == named, 'PHYSICAL_BASE_LOCK_INVALID')
        observed = named.stat()
        inherited = os.fstat(9)
        require(stat.S_ISREG(observed.st_mode) and observed.st_nlink == 1 and observed.st_uid == 0
                and observed.st_mode & 0o022 == 0 and (observed.st_dev, observed.st_ino) == (inherited.st_dev, inherited.st_ino), 'PHYSICAL_BASE_LOCK_INVALID')
        info = Path('/proc/self/fdinfo/9').read_text()
        require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                                 + str(inherited.st_ino) + r'\s+0\s+EOF\s*', line) for line in info.splitlines()), 'PHYSICAL_BASE_LOCK_REQUIRED')

    cancellation_requested = False

    def defer_cancellation(_number, _frame):
        nonlocal cancellation_requested
        cancellation_requested = True

    for number in [signal.SIGINT, signal.SIGTERM, signal.SIGHUP]:
        signal.signal(number, defer_cancellation)

    ownership()
    initial = json.loads(subprocess.check_output(['docker', 'inspect', options.container], timeout=20))[0]
    container_id = initial['Id']
    require(re.fullmatch(r'[a-f0-9]{64}', container_id), 'PHYSICAL_BASE_CONTAINER_INVALID')

    def source():
        ownership()
        current = json.loads(subprocess.check_output(['docker', 'inspect', container_id], timeout=20))[0]
        labels = current['Config'].get('Labels') or {}
        require(current['Id'] == initial['Id'] and current['Image'] == options.image
                and labels.get('com.docker.compose.project') == options.project
                and labels.get('com.docker.compose.service') == 'postgres'
                and current['State']['Running'] and current['State'].get('Health', {}).get('Status') == 'healthy', 'PHYSICAL_BASE_SOURCE_CHANGED')
        return current

    source()
    supervisor = Path(options.supervisor)
    require(supervisor.is_absolute() and supervisor.resolve(strict=True) == supervisor,
            'PHYSICAL_BASE_SUPERVISOR_INVALID')
    supervisor_stat = supervisor.stat()
    require(stat.S_ISREG(supervisor_stat.st_mode) and supervisor_stat.st_uid == 0
            and supervisor_stat.st_nlink == 1 and supervisor_stat.st_mode & 0o022 == 0
            and re.fullmatch(r'[a-f0-9]{64}', options.supervisor_sha256)
            and digest(supervisor) == options.supervisor_sha256, 'PHYSICAL_BASE_SUPERVISOR_INVALID')
    work = root / options.operation_id
    work.mkdir(mode=0o700)  # Never reuse an interrupted capture or foreign data.
    for directory in [root, *root.parents]:
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)  # Persist every pre-provisioned ancestor entry.
        finally:
            os.close(descriptor)
    archive = work / 'base.tar'
    journal = work / 'capture.jsonl'

    def event(value):
        ownership()
        with journal.open('a', encoding='utf8') as stream:
            os.chmod(journal, 0o600)
            stream.write(json.dumps({'at': time.time(), **value}) + '\n')
            stream.flush()
            os.fsync(stream.fileno())
        descriptor = os.open(work, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    def uncertain(phase):
        # Losing the Docker connection is not proof that native work stopped.
        # Keep the inherited ownership lock; inspection must establish outcome.
        try:
            event({'phase': 'OWNERSHIP_HELD_UNPROVEN', 'step': phase})
        except Exception:
            # Even a full audit filesystem must not release unresolved work.
            pass
        while True:
            time.sleep(1)

    native_root = '/tmp/sabalan-pgbase-' + options.operation_id
    native_owner = native_root + '/native-process-owner'
    event({'phase': 'BOOTSTRAP_INTENT', 'containerId': container_id, 'image': options.image,
           'supervisorSha256': options.supervisor_sha256})
    # Bootstrap is limited to an exclusive empty directory and a small pinned
    # binary. An ambiguous bootstrap also retains the host lock.
    try:
        subprocess.run(['docker', 'exec', container_id, 'mkdir', '-m', '700', native_root], check=True, timeout=20)
        subprocess.run(['docker', 'cp', str(supervisor), container_id + ':' + native_owner], check=True, timeout=20)
    except Exception:
        uncertain('bootstrap')
    command_number = 0
    def native(arguments, seconds=60, input_file=None, output_file=None, maximum_bytes=1024 ** 2):
        nonlocal command_number
        require(not cancellation_requested, 'PHYSICAL_BASE_CANCELLED')
        source()
        command_number += 1
        token = options.operation_id + '-' + str(command_number)
        event({'phase': 'NATIVE_INTENT', 'token': token, 'seconds': seconds})
        command = ['docker', 'exec', '-i', container_id, native_owner, str(seconds), token, *arguments]
        process = subprocess.Popen(command, stdin=input_file or subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        proven = False
        try:
            result = bytearray()
            errors_tail = bytearray()
            copied = 0
            failure = None
            with (work / ('native-' + str(command_number) + '.log')).open('xb') as log:
                os.chmod(log.name, 0o600)
                logged = 0
                with selectors.DefaultSelector() as selector:
                    selector.register(process.stdout, selectors.EVENT_READ, 'out')
                    selector.register(process.stderr, selectors.EVENT_READ, 'err')
                    while selector.get_map():
                        ownership()
                        for key, _ in selector.select(timeout=1):
                            chunk = os.read(key.fileobj.fileno(), 1024 * 1024)
                            if not chunk:
                                selector.unregister(key.fileobj)
                                continue
                            if key.data == 'err':
                                errors_tail.extend(chunk)
                                del errors_tail[:-4096]
                                remaining = max(0, 2 * 1024 ** 2 - logged)
                                log.write(chunk[:remaining])
                                logged += min(remaining, len(chunk))
                            else:
                                copied += len(chunk)
                                if copied > maximum_bytes:
                                    failure = 'PHYSICAL_BASE_CAPTURE_TOO_LARGE'
                                elif not failure:
                                    try:
                                        if output_file:
                                            output_file.write(chunk)
                                        else:
                                            result.extend(chunk)
                                    except OSError:
                                        failure = 'PHYSICAL_BASE_OUTPUT_FAILED'
                        if output_file and (os.statvfs(root).f_bavail * os.statvfs(root).f_frsize < 1024 ** 3
                                or os.statvfs(docker_root).f_bavail * os.statvfs(docker_root).f_frsize < 1024 ** 3):
                            failure = 'PHYSICAL_BASE_CAPACITY_LOST'
                        # Continue draining without storing after a host limit. The
                        # in-container subreaper enforces its own deadline and proves
                        # every descendant has exited before issuing its receipt.
                        if cancellation_requested:
                            failure = 'PHYSICAL_BASE_CANCELLED'
                status = process.wait()
                receipt = ('\nSABALAN_NATIVE_REAPED ' + token + ' ' + str(status) + '\n').encode()
                if not errors_tail.endswith(receipt):
                    uncertain(token)
                proven = True
                log.flush()
                os.fsync(log.fileno())
        finally:
            if not proven:
                uncertain(token)
        event({'phase': 'NATIVE_REAPED', 'token': token, 'status': status})
        require(status == 0, 'PHYSICAL_BASE_NATIVE_FAILED')
        require(not failure, failure)
        return bytes(result)

    def profile():
        query = """SELECT json_build_object('version',current_setting('server_version_num'),
          'systemIdentifier',(pg_control_system()).system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,
          'clusterBytes',(SELECT sum(pg_database_size(oid)) FROM pg_database),
          'tablespaces',(SELECT count(*) FROM pg_tablespace WHERE spcname NOT IN ('pg_default','pg_global')));"""
        # A real anonymous file supplies stdin without a shell-quoted SQL command.
        import tempfile
        with tempfile.TemporaryFile() as sql:
            sql.write(("SET statement_timeout='10s';\n" + query).encode())
            sql.seek(0)
            result = json.loads(native(['sh', '-c',
                        'exec psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
                        seconds=20, input_file=sql))
        require(150000 <= int(result['version']) < 160000 and result['systemIdentifier'] == options.system_identifier
                and result['tablespaces'] == 0 and 1 <= result['timeline'] <= 0xffffffff
                and isinstance(result['clusterBytes'], int) and result['clusterBytes'] > 0, 'PHYSICAL_BASE_PROFILE_INVALID')
        return result

    before = profile()
    maximum_bytes = int(before['clusterBytes'] * 5 // 4) + 256 * 1024 ** 2
    available = os.statvfs(root).f_bavail * os.statvfs(root).f_frsize
    require(available >= maximum_bytes * 3 + 1024 ** 3, 'PHYSICAL_BASE_CAPACITY_REQUIRED')
    docker_root = Path(subprocess.check_output(['docker', 'info', '--format', '{{.DockerRootDir}}'], timeout=20).decode().strip())
    require(docker_root.is_absolute() and docker_root.resolve(strict=True) == docker_root, 'PHYSICAL_BASE_DOCKER_STORAGE_INVALID')
    docker_available = os.statvfs(docker_root).f_bavail * os.statvfs(docker_root).f_frsize
    require(docker_available >= maximum_bytes * 3 + 1024 ** 3, 'PHYSICAL_BASE_DOCKER_CAPACITY_REQUIRED')
    event({'phase': 'CAPTURE_INTENT', 'source': before, 'containerId': initial['Id'], 'image': options.image, 'maximumBytes': maximum_bytes})
    try:
        source()
        command = ['sh', '-c',
                   'exec pg_basebackup -h /var/run/postgresql -U "$POSTGRES_USER" --no-password '
                   '--pgdata=- --format=tar --wal-method=fetch --manifest-checksums=SHA256 --max-rate=16M']
        # No slot, replication role, server parameter, application state or
        # maintenance boundary is changed. A WAL gap makes this capture fail.
        with archive.open('xb') as output:
            os.chmod(archive, 0o600)
            native(command, seconds=1800, output_file=output, maximum_bytes=maximum_bytes)
            output.flush()
            os.fsync(output.fileno())
        source()
        manifest = None
        seen = set()
        with tarfile.open(archive, mode='r:') as package:
            total = 0
            for index, member in enumerate(package, 1):
                require(index <= 250000, 'PHYSICAL_BASE_ARCHIVE_INVALID')
                name = member.name.removeprefix('./').rstrip('/')
                require(name and not name.startswith('/') and '\\' not in name and not any(part in ['', '.', '..'] for part in name.split('/'))
                        and name not in seen and (member.isfile() or member.isdir()), 'PHYSICAL_BASE_ARCHIVE_UNSAFE')
                seen.add(name)
                total += member.size
                require(total <= maximum_bytes, 'PHYSICAL_BASE_ARCHIVE_TOO_LARGE')
                if name == 'backup_manifest':
                    require(member.size <= 32 * 1024 ** 2, 'PHYSICAL_BASE_MANIFEST_TOO_LARGE')
                    manifest = package.extractfile(member).read()
                if name == 'PG_VERSION':
                    require(package.extractfile(member).read(16) == b'15\n', 'PHYSICAL_BASE_MAJOR_INVALID')
        require(manifest and {'PG_VERSION', 'global/pg_control', 'backup_label'}.issubset(seen), 'PHYSICAL_BASE_MANIFEST_REQUIRED')
        manifest_value = json.loads(manifest)
        require(manifest_value.get('PostgreSQL-Backup-Manifest-Version') == 1 and manifest_value.get('Files')
                and all(item.get('Checksum-Algorithm') == 'SHA256' for item in manifest_value['Files']), 'PHYSICAL_BASE_MANIFEST_INVALID')
        ranges = manifest_value.get('WAL-Ranges')
        require(isinstance(ranges, list) and len(ranges) == 1 and ranges[0].get('Timeline') == before['timeline'], 'PHYSICAL_BASE_TIMELINE_INVALID')
        def lsn(value):
            require(isinstance(value, str) and re.fullmatch(r'[0-9A-F]{1,8}/[0-9A-F]{1,8}', value), 'PHYSICAL_BASE_LSN_INVALID')
            high, low = value.split('/')
            return (int(high, 16) << 32) | int(low, 16)
        require(lsn(ranges[0].get('End-LSN')) > lsn(ranges[0].get('Start-LSN')), 'PHYSICAL_BASE_RANGE_INVALID')
        event({'phase': 'NATIVE_VERIFY_INTENT', 'archiveBytes': archive.stat().st_size,
               'archiveSha256': digest(archive), 'nativeRoot': native_root})
        native(['mkdir', '-m', '700', native_root + '/data'])
        with archive.open('rb') as tar_input:
            native(['tar', '-xf', '-', '-C', native_root + '/data'], seconds=180, input_file=tar_input)
        verified = native(['pg_verifybackup', native_root + '/data'], seconds=180)
        after = profile()
        require(after['systemIdentifier'] == before['systemIdentifier'] and after['timeline'] == before['timeline'], 'PHYSICAL_BASE_SOURCE_CHANGED')
        # The exact owned prefix and operation identity are fixed above. Failed
        # captures remain quarantined rather than clearing unfamiliar work.
        require(native_root.startswith('/tmp/sabalan-pgbase-') and native_root.rsplit('/', 1)[1] == 'sabalan-pgbase-' + options.operation_id, 'PHYSICAL_BASE_CLEANUP_INVALID')
        # Keep the running supervisor executable until it has issued its receipt.
        native(['rm', '-rf', '--', native_root + '/data'])
        proof = {'format': 'sabalan-private-physical-base/v1', 'status': 'NATIVE_VERIFIED_PRIVATE_ONLY',
                 'operationId': options.operation_id, 'source': before, 'containerId': initial['Id'], 'image': options.image,
                 'archiveBytes': archive.stat().st_size, 'archiveSha256': digest(archive),
                 'manifestSha256': hashlib.sha256(manifest).hexdigest(), 'walRanges': ranges,
                 'nativeVerification': verified.decode().strip(), 'encryptionRequired': True, 'independentRestoreRequired': True}
        event({'phase': 'COMPLETE', 'proof': proof})
        output_file = work / 'component.json'
        with output_file.open('x') as output:
            os.chmod(output_file, 0o600)
            json.dump(proof, output, indent=2)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        event({'phase': 'COMPONENT_DURABLE'})
        return proof
    except Exception:
        event({'phase': 'FAILED_QUARANTINED'})
        raise


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['project', 'operation-id', 'image', 'system-identifier', 'container', 'root', 'lock-file', 'supervisor', 'supervisor-sha256']:
        parser.add_argument('--' + name, required=True)
    try:
        print(json.dumps(capture(parser.parse_args())))
    except Exception as error:
        print(json.dumps({'ok': False, 'failureClass': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1)
