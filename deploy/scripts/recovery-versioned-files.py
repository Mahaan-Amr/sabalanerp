#!/usr/bin/env python3
"""Hash-pinned immutable file-cut reader, independent of application admission.

Reads only selected seals, version records and independent objects. Mutable
heads, pending writes and live paths are never read. This publishes no healthy
application point, traffic authority, cleanup or privacy-retention decision.
"""
import hashlib
import json
import os
import re
import stat
from concurrent.futures import ThreadPoolExecutor

MAX_MANIFEST = 16 * 1024 * 1024
MAX_KEYS = 10000
SHA = re.compile(r"[a-f0-9]{64}\Z")


def fail(code):
    raise RuntimeError(code)


def encoded(value):
    # The producer uses JSON.stringify over ASCII-sorted schema field names.
    return (json.dumps(value, sort_keys=True, ensure_ascii=False,
                       separators=(",", ":")) + "\n").encode("utf-8")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def exact(value, keys):
    return isinstance(value, dict) and set(value) == set(keys)


def integer(value, low, high):
    return type(value) is int and low <= value <= high


def stable(value):
    return (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns,
            value.st_ctime_ns, value.st_mode, value.st_uid, value.st_nlink)


def mount(fd):
    with open('/proc/self/fdinfo/' + str(fd), encoding='ascii') as source:
        found = re.search(r'^mnt_id:\s+(\d+)\s*$', source.read(), re.M)
    if not found:
        fail('VERSIONED_RESTORE_MOUNT_UNPROVEN')
    return found[1]


def directory(path):
    if not os.path.isabs(path) or os.path.normpath(path) != path or os.path.realpath(path) != path:
        fail('VERSIONED_RESTORE_DIRECTORY_ALIAS')
    value = os.lstat(path)
    if not stat.S_ISDIR(value.st_mode) or value.st_uid != os.geteuid() or value.st_mode & 0o077:
        fail('VERSIONED_RESTORE_DIRECTORY_UNSAFE')
    return value.st_dev, value.st_ino


def sync_path(path):
    fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def sync_ancestors(path):
    while True:
        value = os.lstat(path)
        if (not stat.S_ISDIR(value.st_mode) or os.path.realpath(path) != path
                or value.st_mode & 0o022 and not value.st_mode & stat.S_ISVTX):
            fail('VERSIONED_RESTORE_ANCESTRY_UNSAFE')
        sync_path(path)
        parent = os.path.dirname(path)
        if path == parent:
            return
        path = parent


def key(value):
    if (not isinstance(value, str) or not value or '\\' in value or '\0' in value
            or value.startswith('/') or any(part in ('', '.', '..') or part.startswith('.sabalan-file-')
                                            for part in value.split('/'))):
        fail('VERSIONED_RESTORE_KEY_INVALID')
    try:
        if len(value.encode('utf-16-le')) // 2 > 1024:
            fail('VERSIONED_RESTORE_KEY_INVALID')
        value.encode('utf-8')
    except UnicodeError:
        fail('VERSIONED_RESTORE_KEY_INVALID')
    return value


def sealed_directories(value):
    """V2 explicit immutable directories; never infer them for a V1 seal."""
    if value.get('format') == 'sabalan-file-version-cut/v1':
        return []
    rows = value.get('directories')
    if not isinstance(rows, list) or len(rows) >= MAX_KEYS:
        fail('VERSIONED_RESTORE_DIRECTORIES_INVALID')
    seen, previous = set(), None
    for item in rows:
        name = key(item)
        order = name.encode('utf-16-be')
        if name in seen or previous is not None and order <= previous:
            fail('VERSIONED_RESTORE_DIRECTORIES_INVALID')
        parts = name.split('/')
        if any('/'.join(parts[:number]) not in seen for number in range(1, len(parts))):
            fail('VERSIONED_RESTORE_DIRECTORIES_INVALID')
        seen.add(name)
        previous = order
    return rows


class _ImmutableVersionedStore:
    def __init__(self, root):
        self.root = root
        self.identities = {path: directory(path) for path in [root, *[os.path.join(root, part)
                           for part in ('objects', 'versions', 'seals')]]}
        descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            self.mount_id = mount(descriptor)
        finally:
            os.close(descriptor)
        sync_ancestors(root)

    def cut_metadata(self, capture_id, sha256):
        if not isinstance(capture_id, str) or not SHA.fullmatch(capture_id) or not isinstance(sha256, str) or not SHA.fullmatch(sha256):
            fail('VERSIONED_RESTORE_SELECTION_INVALID')
        raw = self.read('seals', capture_id + '.json', MAX_MANIFEST)
        if digest(raw) != sha256:
            fail('VERSIONED_RESTORE_SEAL_CHANGED')
        value = self.decode(raw)
        version_two = value.get('format') == 'sabalan-file-version-cut/v2'
        if (not exact(value, ['format', 'captureId', 'gate', 'source', 'heads'] + (['directories'] if version_two else []))
                or value['format'] not in ['sabalan-file-version-cut/v1', 'sabalan-file-version-cut/v2'] or value['captureId'] != capture_id
                or not exact(value['gate'], ['device', 'inode', 'ownerUid'])
                or not all(isinstance(value['gate'][field], str) and re.fullmatch(r'[0-9]{1,30}', value['gate'][field])
                           for field in ('device', 'inode'))
                or not integer(value['gate']['ownerUid'], 0, 2**32 - 1)
                or not exact(value['source'], ['path', 'device', 'inode'])
                or not isinstance(value['source']['path'], str) or not value['source']['path'].startswith('/')
                or '\0' in value['source']['path'] or os.path.normpath(value['source']['path']) != value['source']['path']
                or not all(isinstance(value['source'][field], str) and re.fullmatch(r'[0-9]{1,30}', value['source'][field])
                           for field in ('device', 'inode'))
                or not isinstance(value['heads'], list) or len(value['heads']) > MAX_KEYS):
            fail('VERSIONED_RESTORE_SEAL_INVALID')
        sealed_directories(value)
        return value

    def assert_owner(self):
        if any(directory(path) != expected for path, expected in self.identities.items()):
            fail('VERSIONED_RESTORE_STORE_CHANGED')

    def open(self, part, name, maximum):
        self.assert_owner()
        parent = os.open(os.path.join(self.root, part), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
            try:
                value = os.fstat(fd)
                if (not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or value.st_uid != os.geteuid()
                        or value.st_mode & 0o222 or value.st_size > maximum
                        or mount(fd) != self.mount_id or mount(parent) != self.mount_id):
                    fail('VERSIONED_RESTORE_RECORD_UNSAFE')
                return fd, value
            except BaseException:
                os.close(fd)
                raise
        finally:
            os.close(parent)

    def finish(self, fd, before, part, name):
        if stable(before) != stable(os.fstat(fd)) or stable(before) != stable(os.lstat(os.path.join(self.root, part, name))):
            fail('VERSIONED_RESTORE_RECORD_CHANGED')
        os.fsync(fd)
        self.assert_owner()

    def read(self, part, name, maximum):
        fd, before = self.open(part, name, maximum)
        try:
            chunks, size = [], 0
            while size < before.st_size:
                chunk = os.read(fd, min(262144, before.st_size - size))
                if not chunk:
                    fail('VERSIONED_RESTORE_RECORD_CHANGED')
                chunks.append(chunk)
                size += len(chunk)
            self.finish(fd, before, part, name)
            return b''.join(chunks)
        finally:
            os.close(fd)

    @staticmethod
    def decode(raw):
        value = json.loads(raw)
        if encoded(value) != raw:
            fail('VERSIONED_RESTORE_RECORD_INVALID')
        return value

def read_sealed_cut_metadata(root, capture_id, sha256):
    """Read only immutable bounded seal metadata; grants no restore validation.

    Full SealedVersionedFiles construction still verifies every predecessor and
    selected object before restoration. Capture must validate its own EX gate.
    """
    if not isinstance(capture_id, str) or not SHA.fullmatch(capture_id) or not isinstance(sha256, str) or not SHA.fullmatch(sha256):
        fail('VERSIONED_RESTORE_SELECTION_INVALID')
    return _ImmutableVersionedStore(root).cut_metadata(capture_id, sha256)


class SealedVersionedFiles(_ImmutableVersionedStore):
    def __init__(self, root, capture_id, sha256):
        if not isinstance(capture_id, str) or not SHA.fullmatch(capture_id) or not isinstance(sha256, str) or not SHA.fullmatch(sha256):
            fail('VERSIONED_RESTORE_SELECTION_INVALID')
        self.capture_id, self.sha256 = capture_id, sha256
        super().__init__(root)
        value = self.cut_metadata(capture_id, sha256)
        self.live_source = value['source']['path']
        self.cut_format = value['format']
        self.preserved_directories = sealed_directories(value)
        self.entries, seen, directories, selected_objects, chains = [], set(), {''} | set(self.preserved_directories), set(), []
        previous_key = None
        for head in value['heads']:
            if not exact(head, ['key', 'sha256']) or not isinstance(head['sha256'], str) or not SHA.fullmatch(head['sha256']):
                fail('VERSIONED_RESTORE_HEAD_INVALID')
            name = key(head['key'])
            # JavaScript compares UTF-16 code units, including astral characters.
            order = name.encode('utf-16-be')
            if name in seen or previous_key is not None and order <= previous_key:
                fail('VERSIONED_RESTORE_HEAD_ORDER_INVALID')
            seen.add(name)
            previous_key = order
            selected, selected_bytes = self.version(head['sha256'])
            if selected['key'] != name:
                fail('VERSIONED_RESTORE_LINEAGE_INVALID')
            if selected['operation'] == 'PUT':
                object_name = selected['object']['name']
                if object_name in selected_objects:
                    fail('VERSIONED_RESTORE_SHARED_OBJECT_REFUSED')
                selected_objects.add(object_name)
            chains.append((selected, selected_bytes))
            self.entries.append(selected)
            for number in range(1, len(name.split('/'))):
                directories.add('/'.join(name.split('/')[:number]))
                if len(directories) > MAX_KEYS:
                    fail('VERSIONED_RESTORE_DIRECTORY_CAPACITY')
        live = {entry['key'] for entry in self.entries if entry['operation'] == 'PUT'}
        live_directories = {'/'.join(name.split('/')[:number]) for name in live
                            for number in range(1, len(name.split('/')))}
        if live.intersection(live_directories | set(self.preserved_directories)):
            fail('VERSIONED_RESTORE_PATH_CONFLICT')
        # At most four in-flight records/chains, including on failure. Settle
        # every started future before returning; never leave a reader running
        # after a failed verification or accumulate historical records.
        self.history_records, self.history_bytes = 0, 0
        with ThreadPoolExecutor(max_workers=4) as workers:
            for offset in range(0, len(chains), 4):
                futures = [workers.submit(self.lineage, entry) for entry in chains[offset:offset + 4]]
                failure = None
                for future in futures:
                    try:
                        count, size = future.result()
                        self.history_records += count
                        self.history_bytes += size
                    except Exception as error:
                        if failure is None:
                            failure = error
                if failure is not None:
                    raise failure
        self.assert_owner()

    def lineage(self, entry):
        selected, size = entry
        current, count = selected, 1
        while current['previousSha256'] is not None:
            count += 1
            if count > MAX_KEYS:
                fail('VERSIONED_RESTORE_HISTORY_CAPACITY')
            ancestor, record_bytes = self.version(current['previousSha256'])
            if ancestor['key'] != selected['key'] or ancestor['generation'] != current['generation'] - 1:
                fail('VERSIONED_RESTORE_LINEAGE_INVALID')
            current = ancestor
            size += record_bytes
        return count, size

    def version(self, sha256):
        raw = self.read('versions', sha256 + '.json', 16384)
        # Walk one predecessor at a time. There are at most MAX_KEYS heads and
        # MAX_KEYS records per head, matching all producer-admitted histories.
        # No aggregate byte cutoff can make an acknowledged cut unrestorable;
        # historical records/objects are not accumulated in memory. Actual
        # restore time and storage still belong to the release admission gates.
        if digest(raw) != sha256:
            fail('VERSIONED_RESTORE_VERSION_CHANGED')
        value = self.decode(raw)
        if (not exact(value, ['format', 'key', 'generation', 'previousSha256', 'operation', 'object', 'live'])
                or value['format'] != 'sabalan-file-version/v1' or not integer(value['generation'], 1, MAX_KEYS)
                or (value['previousSha256'] is not None if value['generation'] == 1 else
                    not isinstance(value['previousSha256'], str) or not SHA.fullmatch(value['previousSha256']))):
            fail('VERSIONED_RESTORE_VERSION_INVALID')
        key(value['key'])
        if value['operation'] == 'DELETE':
            if value['object'] is not None or value['live'] is not None:
                fail('VERSIONED_RESTORE_VERSION_INVALID')
        elif (value['operation'] != 'PUT' or not exact(value['object'], ['name', 'sha256', 'bytes'])
              or not isinstance(value['object']['name'], str) or not re.fullmatch(r'[a-f0-9-]{36}', value['object']['name'])
              or not isinstance(value['object']['sha256'], str) or not SHA.fullmatch(value['object']['sha256'])
              or not integer(value['object']['bytes'], 0, 2**53 - 1)
              or not exact(value['live'], ['device', 'inode', 'bytes', 'modified', 'changed'])
              or not all(isinstance(item, str) and re.fullmatch(r'[0-9]{1,30}', item) for item in value['live'].values())
              or value['live']['bytes'] != str(value['object']['bytes'])):
            fail('VERSIONED_RESTORE_VERSION_INVALID')
        return value, len(raw)

    def restore(self, target):
        self.assert_owner()
        parent = os.path.dirname(target)
        if (not os.path.isabs(target) or os.path.normpath(target) != target
                or any(os.path.commonpath([target, protected]) in (target, protected)
                       for protected in (self.root, self.live_source))):
            fail('VERSIONED_RESTORE_TARGET_INVALID')
        directory(parent)
        # Never adopt or repair an existing/partial target.
        os.mkdir(target, 0o700)
        sync_ancestors(target)
        target_identity = directory(target)

        def record(name, value):
            fd = os.open(os.path.join(target, name), os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
            try:
                with os.fdopen(os.dup(fd), 'wb') as output:
                    output.write(encoded(value))
                    output.flush()
                os.fsync(fd)
            finally:
                os.close(fd)
            sync_path(target)

        record('intent.json', {'format': 'sabalan-versioned-file-restore-intent/v1', 'sealSha256': self.sha256})
        destination = os.path.join(target, 'files')
        os.mkdir(destination, 0o700)
        created = {destination: directory(destination)}
        root_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            target_mount = mount(root_fd)
        finally:
            os.close(root_fd)

        def checked_directory(path):
            identity = directory(path)
            descriptor = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                if mount(descriptor) != target_mount:
                    fail('VERSIONED_RESTORE_TARGET_MOUNT_CHANGED')
            finally:
                os.close(descriptor)
            return identity

        # Prefix closure/order was checked from immutable bytes before creating
        # the target. Retain empty directories before restoring business files.
        for name in self.preserved_directories:
            path = os.path.join(destination, *name.split('/'))
            if (directory(target) != target_identity
                    or any(checked_directory(item) != expected for item, expected in created.items())):
                fail('VERSIONED_RESTORE_TARGET_CHANGED')
            os.mkdir(path, 0o700)
            created[path] = checked_directory(path)
            sync_path(os.path.dirname(path))
        observed = []
        for entry in self.entries:
            if entry['operation'] == 'DELETE':
                continue
            components = entry['key'].split('/')
            for number in range(1, len(components)):
                path = os.path.join(destination, *components[:number])
                if path not in created:
                    os.mkdir(path, 0o700)
                    created[path] = checked_directory(path)
                    sync_path(os.path.dirname(path))
            if directory(target) != target_identity or any(checked_directory(path) != expected for path, expected in created.items()):
                fail('VERSIONED_RESTORE_TARGET_CHANGED')
            name, size = entry['object']['name'], entry['object']['bytes']
            source, before = self.open('objects', name, size)
            output = None
            try:
                if before.st_size != size:
                    fail('VERSIONED_RESTORE_OBJECT_CHANGED')
                path = os.path.join(destination, *components)
                output = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
                content, length = hashlib.sha256(), 0
                while True:
                    chunk = os.read(source, 262144)
                    if not chunk:
                        break
                    length += len(chunk)
                    if length > size:
                        fail('VERSIONED_RESTORE_OBJECT_CHANGED')
                    content.update(chunk)
                    while chunk:
                        written = os.write(output, chunk)
                        if written <= 0:
                            fail('VERSIONED_RESTORE_OUTPUT_INCOMPLETE')
                        chunk = chunk[written:]
                if length != size or content.hexdigest() != entry['object']['sha256']:
                    fail('VERSIONED_RESTORE_OBJECT_CHANGED')
                self.finish(source, before, 'objects', name)
                os.fsync(output)
                expected = stable(os.fstat(output))
            finally:
                os.close(source)
                if output is not None:
                    os.close(output)
            # Separate actual read-back, never infer correctness from write calls.
            check = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            try:
                actual = hashlib.sha256()
                while True:
                    chunk = os.read(check, 262144)
                    if not chunk:
                        break
                    actual.update(chunk)
                if (stable(os.fstat(check)) != expected or stable(os.lstat(path)) != expected
                        or actual.hexdigest() != entry['object']['sha256']):
                    fail('VERSIONED_RESTORE_OUTPUT_CHANGED')
                os.fsync(check)
            finally:
                os.close(check)
            sync_path(os.path.dirname(path))
            observed.append({'key': entry['key'], 'sha256': entry['object']['sha256'], 'bytes': size})
        if directory(target) != target_identity or any(checked_directory(path) != expected for path, expected in created.items()):
            fail('VERSIONED_RESTORE_TARGET_CHANGED')
        self.assert_owner()
        sync_path(destination)
        result = {'format': 'sabalan-versioned-file-restore/v1', 'sealSha256': self.sha256,
                  'files': observed, 'tombstones': sum(entry['operation'] == 'DELETE' for entry in self.entries),
                  'historyRecordsVerified': self.history_records, 'historyBytesVerified': self.history_bytes}
        if self.cut_format == 'sabalan-file-version-cut/v2':
            result['format'] = 'sabalan-versioned-file-restore/v2'
            result['directories'] = list(self.preserved_directories)
        record('complete.json', result)
        return result
