"""Restore authenticated physical/WAL/SQLite/v3 file bytes. Never starts PG.

The original outer controller must subsequently own pg_verifybackup, named-point
replay and the SAME restored application's three original runtime closures.
"""
import hashlib
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sqlite3
import stat
import sys
import tarfile


def require(value, code):
    if not value:
        raise RuntimeError('INDEPENDENT_ONLINE_LAYOUT_' + code)


def sha(file):
    digest = hashlib.sha256()
    with open(file, 'rb') as stream:
        for block in iter(lambda: stream.read(262144), b''):
            digest.update(block)
    return digest.hexdigest()


def identity(file):
    value = file.stat()
    return tuple(getattr(value, key) for key in ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink', 'st_uid', 'st_mode'))


def sync_directory(file):
    # Data-only Windows extractor tests cannot fsync directory handles. Actual
    # restore main requires Linux; no native durability is claimed by tests.
    if os.name != 'posix':return
    fd = os.open(file, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:os.fsync(fd)
    finally:os.close(fd)


def safe_relative(value):
    require(isinstance(value, str) and value and not value.startswith('/')
            and '\\' not in value and '\0' not in value
            and all(part not in ('', '.', '..') for part in value.split('/')), 'RELATIVE_PATH_INVALID')
    return value


def validate_coordination_history(raw, capture_id, cut_names, classifier):
    value = json.loads(raw)
    require(set(value) == {'format', 'captureId', 'source', 'gate', 'entries', 'archivalOnly', 'runtimeAdmission', 'restorePolicy'}, 'COORDINATION_SCHEMA')
    require(value['format'] == 'sabalan-coordination-history/v1' and value['captureId'] == capture_id
            and value['archivalOnly'] is True and value['runtimeAdmission'] is False
            and value['restorePolicy'] == 'READ_ONLY_HISTORY_OUTSIDE_NEW_COORDINATION', 'COORDINATION_SCOPE')
    require(set(value['source']) == {'path', 'device', 'inode'} and set(value['gate']) == {'device', 'inode'}
            and value['source']['path'].startswith('/') and os.path.normpath(value['source']['path']) == value['source']['path']
            and all(re.fullmatch(r'[0-9]{1,30}', identity[key]) for identity in [value['source'], value['gate']] for key in ['device', 'inode']), 'COORDINATION_IDENTITY')
    require(isinstance(value['entries'], list) and len(value['entries']) <= 10000, 'COORDINATION_BOUND')
    entries = value['entries'];excluded = [row for row in entries if row['kind'] == 'EXCLUDED_SUBTREE']
    required = {'SELECTED_VERSIONED_ROOT:' + name for name in cut_names}
    covered = {row['coverage'] for row in excluded}
    require(required.issubset(covered) and len(required) == 9
            and covered.issubset(required | {'ORIGINAL_CAPTURE_WORKSPACE_NOT_RUNTIME_AUTHORITY'})
            and len(covered) == len(excluded), 'COORDINATION_EXCLUSIONS')
    seen, total = set(), 0
    for row in entries:
        name = safe_relative(row['path'])
        require(name not in seen and all('/'.join(name.split('/')[:i]) in seen for i in range(1, len(name.split('/')))), 'COORDINATION_PATH_SET')
        seen.add(name)
        require(not any(name.startswith(item['path'] + '/') for item in excluded), 'COORDINATION_EXCLUDED_CHILD')
        if row['kind'] == 'EXCLUDED_SUBTREE':
            require(set(row) == {'path', 'kind', 'coverage', 'device', 'inode'}
                    and all(re.fullmatch(r'[0-9]{1,30}', row[key]) for key in ['device', 'inode']), 'COORDINATION_EXCLUSION_SCHEMA')
            continue
        expected_class = ('COVERED_SUBTREE_CONTAINER' if row['kind'] == 'DIRECTORY'
                          and any(item['path'].startswith(name + '/') for item in excluded) else classifier.classification(name, source_root=value['source']['path']))
        require(row['classification'] == expected_class and row['kind'] in ('DIRECTORY', 'FILE'), 'COORDINATION_CLASSIFICATION')
        require(set(row) == ({'path', 'kind', 'classification', 'bytes', 'sha256', 'rawBase64'} if row['kind'] == 'FILE' else {'path', 'kind', 'classification'}), 'COORDINATION_ENTRY_SCHEMA')
        if row['kind'] == 'FILE':
            content = base64.b64decode(row['rawBase64'], validate=True)
            require(len(content) <= 8 * 1024 ** 2, 'COORDINATION_FILE_BOUND')
            require(len(content) == row['bytes'] and hashlib.sha256(content).hexdigest() == row['sha256'], 'COORDINATION_FILE_CHANGED')
            total += len(content);require(total <= 32 * 1024 ** 2, 'COORDINATION_TOTAL_BOUND')
    return dict(files=sum(row['kind'] == 'FILE' for row in entries), entries=len(entries), bytes=total,
                sha256=hashlib.sha256(raw).hexdigest(), archivalOnly=True, runtimeAdmission=False)


def extract_physical_base(archive, target, maximum_bytes):
    """Two-pass raw pg_basebackup tar; no links, sparse files or extraction API."""
    require(target.resolve(strict=True) == target and not list(target.iterdir()), 'PG_TARGET_NOT_EMPTY')
    before = identity(archive)
    seen, total = {}, 0
    with tarfile.open(archive, 'r:') as source:
        for member in source:
            name = safe_relative(member.name.rstrip('/'))
            require(name not in seen and len(seen) < 250000
                    and member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE)
                    and not member.issparse() and not member.pax_headers, 'PG_MEMBER_UNSAFE')
            require(member.size >= 0 and (member.isfile() or member.size == 0), 'PG_MEMBER_SIZE')
            total += member.size
            require(total <= maximum_bytes, 'PG_EXPANSION_BOUND')
            seen[name] = (member.type, member.size)
    require('backup_manifest' in seen and 'global/pg_control' in seen and 'PG_VERSION' in seen, 'PG_REQUIRED_FILES')
    require(shutil.disk_usage(target).free >= total + 64 * 1024 ** 2, 'PG_DISK_HEADROOM')
    observed, count, inventory = set(), 0, []
    with tarfile.open(archive, 'r:') as source:
        for member in source:
            name = safe_relative(member.name.rstrip('/'))
            require(name not in observed and seen[name] == (member.type, member.size), 'PG_ARCHIVE_CHANGED')
            observed.add(name)
            file = target / name
            file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
            if member.isdir():
                file.mkdir(mode=0o700, exist_ok=True)
                continue
            # Windows may exercise this data-only extractor on its own fresh
            # test directory. Actual controller main requires Linux NOFOLLOW.
            descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL
                                 | getattr(os, 'O_NOFOLLOW', 0) | getattr(os, 'O_BINARY', 0), 0o600)
            try:
                expected_content = hashlib.sha256()
                with source.extractfile(member) as content:
                    remaining = member.size
                    while remaining:
                        block = content.read(min(262144, remaining))
                        require(block, 'PG_TRUNCATED')
                        expected_content.update(block)
                        pending = memoryview(block)
                        while pending:
                            written = os.write(descriptor, pending)
                            require(written > 0, 'PG_WRITE_INCOMPLETE')
                            pending = pending[written:]
                        remaining -= len(block)
                        count += len(block)
                    require(not content.read(1), 'PG_MEMBER_OVERFLOW')
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
            require(file.stat().st_size == member.size and sha(file) == expected_content.hexdigest(), 'PG_EXTRACTED_READBACK_CHANGED')
            inventory.append(dict(path=name, bytes=member.size, sha256=expected_content.hexdigest()))
    require(observed == set(seen) and count == total and identity(archive) == before, 'PG_SOURCE_CHANGED')
    require((target / 'PG_VERSION').read_bytes() == b'15\n', 'PG15_REQUIRED')
    require(not (target / 'standby.signal').exists() and not (target / 'recovery.signal').exists(), 'INHERITED_RECOVERY_SIGNAL')
    for directory in sorted([path for path in target.rglob('*') if path.is_dir()], key=lambda path:len(path.parts), reverse=True):sync_directory(directory)
    sync_directory(target);sync_directory(target.parent)
    inventory.sort(key=lambda row: row['path'])
    return dict(files=len(seen), expandedBytes=total, backupManifestSha256=sha(target / 'backup_manifest'),
                extractedInventorySha256=hashlib.sha256((json.dumps(inventory, sort_keys=True, separators=(',', ':'))+'\n').encode()).hexdigest())


def load_module(name, file, expected):
    require(file.resolve(strict=True) == file and sha(file) == expected, 'HELPER_CHANGED')
    spec = importlib.util.spec_from_file_location(name, file)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    require(sys.platform == 'linux' and hasattr(os, 'O_NOFOLLOW') and os.getuid() == 0 and len(sys.argv) == 3, 'ORIGINAL_LINUX_ROOT_REQUIRED')
    os.umask(0o077)
    configuration = Path(sys.argv[1])
    require(sha(configuration) == sys.argv[2], 'CONFIG_CHANGED')
    config = json.loads(configuration.read_bytes())
    require(config['format'] == 'sabalan-independent-online-layout-input/v1'
            and re.fullmatch(r'[a-f0-9]{32}', config['operation']), 'CONFIG_INVALID')
    root = Path('/app/online-runtime-acceptance/application-native-' + config['operation'])
    require(root.resolve(strict=True) == root and root.is_dir(), 'ORIGINAL_OPERATION_ROOT_CHANGED')
    def owned_target(value):
        target = Path(value)
        require(target.is_absolute() and str(target) == value and root in target.parents, 'FOREIGN_TARGET')
        for ancestor in [target, *target.parents]:
            if ancestor.exists():
                require(not ancestor.is_symlink() and ancestor.resolve(strict=True) == ancestor, 'TARGET_ALIAS')
            if ancestor == root:
                break
        return target
    for key in ('postgresRoot', 'walRoot', 'storesRoot', 'sqliteTarget', 'coordinationHistoryTarget'):
        owned_target(config[key])
    for binding in config['roots']:
        owned_target(binding['live'])
    # No hidden nested bind or separately mounted filesystem may participate in
    # an owned restore tree, even when st_dev happens to equal the parent's.
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        field = line.split()[4]
        mount = re.sub(r'\\([0-7]{3})', lambda match: chr(int(match.group(1), 8)), field)
        require(not mount.startswith(str(root) + '/'), 'NESTED_MOUNT')
    components_file = Path(config['componentsFile'])
    require(sha(components_file) == config['componentsSha256'], 'COMPONENT_RECEIPT_CHANGED')
    original = json.loads(components_file.read_bytes())
    require(original['format'] == 'sabalan-original-independent-online-components/v1'
            and original['operation'] == config['operation'] and original['captureId'] == config['captureId']
            and original['fullGcmAuthenticated'] and original['independentRsaDecryptVerified'], 'AUTHENTICATED_COMPONENTS_REQUIRED')
    rows = original['components']
    source_manifest_file = Path(config['sourceManifestFile'])
    require(sha(source_manifest_file) == original['manifestSha256'], 'SOURCE_MANIFEST_CHANGED')
    source_manifest = json.loads(source_manifest_file.read_bytes())
    require(source_manifest['format'] == 'sabalan-online-checkpoint-plaintext-components/v1'
            and source_manifest['operation'] == config['captureId'], 'SOURCE_MANIFEST_FORMAT')
    source_rows = {row['name']: row for row in source_manifest['sources']}
    require(len(source_rows) == len(rows) and set(source_rows) == {row['name'] for row in rows}, 'SOURCE_MANIFEST_SET_CHANGED')
    require(len({row['name'] for row in rows}) == len(rows), 'DUPLICATE_COMPONENT')
    for row in rows:
        file = Path(row['path'])
        owned_target(row['path'])
        require(file.resolve(strict=True) == file and file.is_file() and file.stat().st_nlink == 1
                and file.stat().st_size == row['bytes'] and sha(file) == row['sha256'], 'PLAINTEXT_CHANGED')
    retired = []
    def retire_plaintext(row, actual_file):
        owned_target(str(actual_file))
        require(actual_file.resolve(strict=True) == actual_file and actual_file.is_file()
                and actual_file.stat().st_nlink == 1 and actual_file.stat().st_size == row['bytes']
                and sha(actual_file) == row['sha256'], 'SCRATCH_CHANGED')
        cipher = Path(row['retainedCipherPath'])
        require(str(cipher).startswith('/checkpoints/') and cipher.resolve(strict=True) == cipher
                and cipher.stat().st_nlink == 1 and cipher.stat().st_size == row['cipherBytes']
                and not cipher.stat().st_mode & 0o077, 'RETAINED_CIPHER_INVALID')
        descriptor = os.open(cipher, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = identity(cipher)
            require(sha(cipher) == row['cipherSha256'], 'RETAINED_CIPHER_CHANGED')
            os.unlink(actual_file)
            parent = os.open(actual_file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:os.fsync(parent)
            finally:os.close(parent)
            require(identity(cipher) == before and sha(cipher) == row['cipherSha256'], 'RETAINED_CIPHER_CHANGED_AFTER_RETIREMENT')
            require(os.fstat(descriptor).st_ino == cipher.stat().st_ino, 'RETAINED_CIPHER_OWNER_CHANGED')
        finally:os.close(descriptor)
        retired.append(dict(name=row['name'], role=row['role'], plaintextSha256=row['sha256'], plaintextBytes=row['bytes'],
                            retainedCipherPath=str(cipher), retainedCipherSha256=row['cipherSha256'], reason='FULL_EXTRACTION_AND_READBACK_COMPLETE'))
    def one(role):
        selected = [row for row in rows if row['role'] == role]
        require(len(selected) == 1, 'SINGLETON_COMPONENT_REQUIRED')
        return selected[0]
    captured = json.loads(Path(one('coherent-cut')['path']).read_bytes())
    coverage = json.loads(Path(one('coverage-manifest')['path']).read_bytes())
    receiver = json.loads(Path(one('wal-capture')['path']).read_bytes())
    coverage_module = load_module('original_online_byte_coverage', Path(config['coverageReader']), config['coverageReaderSha256'])
    source = receiver['source']
    receiver_configuration = dict(startLsn=receiver['startLsn'], endLsn=receiver['endLsn'],
                                  **{key: source[key] for key in ('databaseName', 'databaseOid', 'systemIdentifier', 'timeline', 'segmentBytes')})
    measured = coverage_module.validate_coverage(coverage['physicalBaseProof'], captured, receiver, receiver_configuration)
    for key, value in measured.items():
        require(coverage[key] == value, 'COVERAGE_CHANGED')
    base = one('physical-base')
    require(base['sha256'] == coverage['physicalBaseProof']['archiveSha256']
            and base['bytes'] == coverage['physicalBaseProof']['archiveBytes'], 'BASE_LINEAGE_CHANGED')
    pg = Path(config['postgresRoot'])
    pg_result = extract_physical_base(Path(base['path']), pg, base['bytes'])
    # All extracted regular files were separately read back against the exact
    # archive bytes. PGtree stays intact for native pg_verifybackup and replay.
    retire_plaintext(base, Path(base['path']))
    wal = Path(config['walRoot']);wal.mkdir(mode=0o700)
    segments = [row for row in rows if row['role'] == 'wal-segment']
    require(len(segments) == len(receiver['segments']), 'WAL_SET_CHANGED')
    for expected in receiver['segments']:
        selected = [row for row in segments if row['name'] == 'wal-' + expected['name']]
        require(len(selected) == 1 and selected[0]['sha256'] == expected['sha256']
                and selected[0]['bytes'] == expected['bytes'], 'WAL_SEGMENT_CHANGED')
        os.rename(selected[0]['path'], wal / expected['name'])
    reader = load_module('independent_current_versioned_reader', Path(config['fileReader']), config['fileReaderSha256'])
    require(len(config['roots']) == 9 and len({root['name'] for root in config['roots']}) == 9, 'NINE_ROOTS_REQUIRED')
    stores = Path(config['storesRoot']);stores.mkdir(mode=0o700)
    restored, consumed = [], set()
    for cut in captured['versionedCuts']:
        selected = [root for root in config['roots'] if root['name'] == cut['name']]
        require(len(selected) == 1, 'ROOT_MAPPING_MISSING')
        target = Path(selected[0]['live']);require(not target.exists(), 'ROOT_TARGET_EXISTS')
        store = stores / cut['name'];store.mkdir(mode=0o700)
        for part in ('objects', 'versions', 'seals'):(store / part).mkdir(mode=0o700)
        for row in rows:
            if row['role'] not in ('versioned-file-cut', 'versioned-file-object', 'versioned-file-lineage'):
                continue
            prefix = cut['storeRoot'] + '/'
            # Original source paths come from the independently authenticated
            # sealed manifest, not from the source host's current filesystem.
            original_row = source_rows[row['name']]
            if not original_row['path'].startswith(prefix):
                continue
            relative = safe_relative(original_row['path'][len(prefix):]);parts = relative.split('/')
            require(len(parts) == 2 and parts[0] in ('objects', 'versions', 'seals') and row['name'] not in consumed, 'STORE_COMPONENT_INVALID')
            os.rename(row['path'], store / relative);sync_directory(Path(row['path']).parent);sync_directory((store / relative).parent);consumed.add(row['name'])
        source_store = reader.SealedVersionedFiles(str(store), cut['captureId'], cut['sha256'])
        source_cut = source_store.cut_metadata(cut['captureId'], cut['sha256'])
        require(source_cut['source']['path'] == selected[0]['sourceLiveRoot'], 'SOURCE_ROOT_MAPPING_CHANGED')
        # The canonical reader's target owns intent/complete receipts alongside
        # a files/ child. Only that actual child becomes the application's live
        # directory; its original receipts remain separate historical evidence.
        restore_stage = stores / ('restored-' + cut['name'])
        actual = source_store.restore(str(restore_stage))
        target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        os.rename(restore_stage / 'files', target);sync_directory(restore_stage);sync_directory(target.parent)
        for row in rows:
            if row['role'] == 'versioned-file-object' and row['name'] in consumed:
                original_path = source_rows[row['name']]['path']
                if original_path.startswith(cut['storeRoot'] + '/'):
                    require(any(value['sha256'] == row['sha256'] and value['bytes'] == row['bytes'] for value in actual['files']), 'OBJECT_NOT_OBSERVED_IN_RESTORE')
                    retire_plaintext(row, store / original_path[len(cut['storeRoot'])+1:])
        restored.append(dict(name=cut['name'], sourceLiveRoot=source_cut['source']['path'],
                             liveRoot=str(target), sourceStoreRoot=cut['storeRoot'], actual=actual))
    require(len(restored) == 9 and len(consumed) == sum(row['role'].startswith('versioned-file-') for row in rows), 'FILE_COMPONENT_SET_CHANGED')
    sqlite = one('inquiry-sqlite');expected = captured['sqliteSnapshot']
    require(sqlite['sha256'] == expected['sha256'] and sqlite['bytes'] == expected['bytes'], 'SQLITE_CUT_CHANGED')
    sqlite_target = Path(config['sqliteTarget']);require(not sqlite_target.exists(), 'SQLITE_TARGET_EXISTS')
    os.rename(sqlite['path'], sqlite_target);sync_directory(Path(sqlite['path']).parent);sync_directory(sqlite_target.parent)
    connection = sqlite3.connect(sqlite_target.as_uri() + '?mode=ro', uri=True)
    try:require(connection.execute('PRAGMA integrity_check').fetchall() == [('ok',)], 'SQLITE_INTEGRITY')
    finally:connection.close()
    require(sha(sqlite_target) == sqlite['sha256'], 'SQLITE_CHANGED_DURING_CHECK')
    coordination = one('coordination');expected_coordination = captured['coordinationHistory']
    require(coordination['sha256'] == expected_coordination['sha256'] and coordination['bytes'] == expected_coordination['bytes'], 'COORDINATION_CUT_CHANGED')
    classifier = load_module('independent_coordination_classifier', Path(config['coordinationReader']), config['coordinationReaderSha256'])
    coordination_result = validate_coordination_history(Path(coordination['path']).read_bytes(), config['captureId'], [cut['name'] for cut in captured['versionedCuts']], classifier)
    historical = Path(config['coordinationHistoryTarget'])
    require(historical == root / 'historical-coordination' / 'history.json' and not historical.exists(), 'COORDINATION_AUTHORITY_OVERLAP')
    historical.parent.mkdir(mode=0o700);os.rename(coordination['path'], historical);os.chmod(historical, 0o400);sync_directory(Path(coordination['path']).parent);sync_directory(historical.parent);sync_directory(historical.parent.parent)
    coordination_result['path'] = str(historical)
    # This cap-dropped carrier never owns CHOWN capability. The original host
    # revalidates this private no-link tree and applies its fixed PG UID70.
    result = dict(format='sabalan-original-independent-online-layout/v1', operation=config['operation'],
                  captureId=config['captureId'], coverage=measured, physicalBase=pg_result, restoredFileCuts=restored,
                  sqlite=dict(path=str(sqlite_target), sha256=sqlite['sha256'], bytes=sqlite['bytes']),coordinationHistory=coordination_result,
                  restorePoint={key: captured['restorePoint'][key] for key in ('name', 'lsn', 'requiredWalEndLsn')}
                  | {'timeline': measured['timeline']}, sourceDatabase=captured['database'], retiredAuthenticatedScratch=retired,
                  physicalReplayQualified=False, threeApplicationHealthQualified=False, productionAdmission=False)
    print(json.dumps(result, sort_keys=True, separators=(',', ':')))


if __name__ == '__main__':
    main()
