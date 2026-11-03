"""Read-only leaf for the original COMPLETE issuer's fixed resource ports.

No capability is minted here. The Windows original must own the live operation,
pin this source and the observer digest, and compare these observations with its
retained coordinator context. No SQL mutation, credential output or adoption.
"""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import select
import signal
import subprocess
import sys
from urllib.parse import urlsplit, unquote


def require(value):
    if not value:
        raise RuntimeError('ORIGINAL_RESTORED_RESOURCE_UNPROVEN')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def identity(value):
    return {key: str(getattr(value, 'st_' + field)) for key, field in [
        ('device', 'dev'), ('inode', 'ino'), ('mode', 'mode'), ('uid', 'uid'),
        ('nlink', 'nlink'), ('size', 'size'), ('mtimeNs', 'mtime_ns'), ('ctimeNs', 'ctime_ns')]}


def private(file, maximum=8 * 1024**2, mode=0o400):
    file = Path(file)
    require(file.is_absolute() and file.resolve(strict=True) == file)
    fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == 0 and before.st_nlink == 1
                and before.st_mode & 0o777 == mode and 0 < before.st_size <= maximum)
        chunks, count = [], 0
        while chunk := os.read(fd, min(262144, maximum + 1 - count)):
            chunks.append(chunk)
            count += len(chunk)
            require(count <= maximum)
        require(count == before.st_size and identity(before) == identity(os.fstat(fd))
                == identity(file.lstat()))
        return b''.join(chunks), before
    finally:
        os.close(fd)


class OriginalReaders:
    """Bounded drain/discard, sticky cancellation, SAME children through EOF/wait."""
    def __init__(self):
        self.children, self.owners = [], []
        self.cancelled, self.failed, self.closed = False, False, False
        self.handlers = {sig: signal.getsignal(sig) for sig in [signal.SIGINT, signal.SIGTERM]}
        for sig in self.handlers:
            signal.signal(sig, self.cancel)

    def cancel(self, *_):
        self.cancelled = self.failed = True  # Never forward, terminate or replace.

    def finish(self, owner, original_child=None):
        child = original_child if original_child is not None else owner['child']
        streams = [(child.stdout, 'out', owner['maximum']), (child.stderr, 'err', 65536)]
        while not all(owner[name + 'Eof'] for _, name, _ in streams):
            pending = [stream for stream, name, _ in streams if not owner[name + 'Eof']]
            try:
                ready, _, _ = select.select(pending, [], [], 0.1)
            except BaseException:
                self.failed = True
                continue  # Unknown pipe state retains the same owner.
            for stream, name, limit in streams:
                if stream not in ready:
                    continue
                try:
                    raw = os.read(stream.fileno(), 65536)
                    if not raw:
                        owner[name + 'Eof'] = True
                        stream.close()
                    else:
                        owner[name + 'Bytes'] += len(raw)
                        if owner[name + 'Bytes'] <= limit:
                            owner[name].append(raw)
                        else:
                            self.failed = True  # Keep draining; discard excess.
                except BaseException:
                    self.failed = True
        while True:
            try:
                child.wait()
                break
            except BaseException:
                self.failed = True
        owner['reaped'] = True
        if child.returncode != 0:
            self.failed = True

    def run(self, argv, env=None, input_bytes=None, maximum=32 * 1024**2):
        require(not self.closed and not self.failed and not self.cancelled)
        require(type(maximum) is int and 0 < maximum <= 32 * 1024**2)
        require(input_bytes is None or isinstance(input_bytes, bytes) and len(input_bytes) <= 4096)
        # Allocate/register the record before there is any child to lose.
        owner = dict(child=None, maximum=maximum, out=[], err=[], outBytes=0, errBytes=0,
                     outEof=False, errEof=False, reaped=False)
        self.owners.append(owner)
        child = subprocess.Popen(argv, env=env, stdin=subprocess.PIPE if input_bytes is not None else subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:  # Immediately retain this SAME returned Popen through all setup errors.
            owner['child'] = child
            self.children.append(child)
            if input_bytes is not None:
                try:
                    offset = 0
                    while offset < len(input_bytes):
                        count = os.write(child.stdin.fileno(), input_bytes[offset:])
                        require(count > 0)
                        offset += count
                finally:
                    child.stdin.close()
        except BaseException:
            self.failed = True
            if child.stdin is not None and not child.stdin.closed:
                try:
                    child.stdin.close()
                except BaseException:
                    self.failed = True
        finally:
            self.finish(owner, child)
        require(not self.failed and not self.cancelled)
        return b''.join(owner['out'])

    def close(self):
        if not self.closed:
            for owner in self.owners:
                if owner['child'] is not None:
                    self.finish(owner)
            for sig, handler in self.handlers.items():
                signal.signal(sig, handler)
            self.closed = True
        return dict(failed=self.failed, cancelled=self.cancelled,
                    originals=[dict(pid=o['child'].pid, returncode=o['child'].returncode,
                                    reaped=o['reaped'], stdoutEof=o['outEof'], stderrEof=o['errEof'])
                               for o in self.owners if o['child'] is not None])


def root_for(operation):
    require(isinstance(operation, str) and re.fullmatch(r'[a-f0-9]{32}', operation))
    root = Path('/app/runtime-authority/application-native-' + operation + '/restored-complete-app/coherent-private')
    require(root.resolve(strict=True) == root and root.is_dir())
    value = root.stat()
    require(value.st_uid == 0 and value.st_mode & 0o777 == 0o700)
    return root


def material(root, expected_observer_sha, readers):
    require(re.fullmatch(r'[a-f0-9]{64}', expected_observer_sha))
    index_raw, _ = private(root / 'index.json')
    config_raw, _ = private(root / 'config.json')
    index, config = json.loads(index_raw), json.loads(config_raw)
    require(index['sourceDatabaseRole'] == 'VERIFIED_COMPLETE_RESTORED_QA')
    helper = root / 'private-qualification-observer.py'
    helper_raw, helper_stat = private(helper)
    require(sha(helper_raw) == expected_observer_sha == config['sourcePins'][helper.name])
    bootstrap = "import base64,hashlib,sys; p=sys.argv[1]; raw=base64.b64decode(sys.argv[3],validate=True); assert hashlib.sha256(raw).hexdigest()==sys.argv[2]; sys.argv=[p]; exec(compile(raw,p,'exec'),{'__name__':'__main__','__file__':p})"
    raw = readers.run(['/usr/bin/python3.11', '-I', '-B', '-c', bootstrap, str(helper), expected_observer_sha, base64.b64encode(helper_raw).decode()],
                      input_bytes=json.dumps({'root': str(root)}).encode())
    after_raw, after_stat = private(helper)
    require(after_raw == helper_raw and identity(after_stat) == identity(helper_stat))
    facts = json.loads(raw)
    require(facts['format'] == 'sabalan-original-private-qualification-observation/v1'
            and facts['originalSqlProbe']['returncode'] == 0 and facts['originalSqlProbe']['reaped'] is True)
    require(private(root / 'index.json')[0] == index_raw and private(root / 'config.json')[0] == config_raw)
    return dict(index=index, config=config, facts=facts, baselineCompletion=facts['baselineCompletion'],
                restoredQaLineage=index['restoredQaLineage'])


def process_birth(pid):
    require(type(pid) is int and pid > 1)
    proc = Path('/proc') / str(pid)
    fields = (proc / 'stat').read_text().rsplit(') ', 1)[1].split()
    require(fields[0] not in ['Z', 'X'])
    return dict(pid=pid, bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
                pidNamespace=os.readlink(proc / 'ns/pid'), startTicks=fields[19])


def validate_http_records(*, native_raw, work_raw, claim_raw, namespace_raw, grant, birth,
                          events, actor_id, prepared, sql):
    """Data validation only. The fixed leaf below owns all actual reads/probes."""
    native, work, claim, namespace = [json.loads(v) for v in [native_raw, work_raw, claim_raw, namespace_raw]]
    scope = grant['scope']
    require(native['format'] == 'sabalan-runtime-native/v1' and native['phase'] == 'ACTIVE'
            and native['guardian'] == birth and native['onlineScope'] == dict(scope=scope, sha256=grant['sha256'])
            and native['role'] == scope['role'] and native['initialDatabase']['name'] == scope['database']['name']
            and native['clusterIdentifier'] == scope['database']['systemIdentifier'])
    require(claim['format'] == 'sabalan-runtime-claim/v2'
            and claim['native'] == dict(scopeSha256=grant['sha256'], claimSha256=sha(native_raw))
            and claim['scopeSha256'] == sha(namespace_raw) and claim['birth'] == process_birth(claim['birth']['pid']))
    require(namespace['format'] == 'sabalan-runtime-namespace/v1'
            and namespace['scope']['runtimeId'] == scope['runtimeId'])
    pid = claim['birth']['pid']
    ancestry = []
    for _ in range(32):
        require(pid > 1 and pid not in ancestry)
        ancestry.append(pid)
        if pid == birth['pid']:
            break
        pid = int((Path('/proc') / str(pid) / 'stat').read_text().rsplit(') ', 1)[1].split()[1])
    require(len(ancestry) > 1 and ancestry[-1] == birth['pid'])
    require(work['format'] == 'sabalan-runtime-boundary/v1' and work['claimSha256'] == sha(claim_raw)
            and work['phase'] == 'QUIESCENT')
    require(len(events) == (2 if prepared else 1))
    for event, name in zip(events, ['READY', 'PREPARED']):
        require(event['event'] == name and event['actorId'] == actor_id and event['scopeSha256'] == grant['sha256'])
    require(sql['database'] == dict(name=scope['database']['name'], oid=str(sql['database']['oid']),
                                   systemIdentifier=scope['database']['systemIdentifier']))
    require(sql['visible'] is True and sql['prepared'] == 0 and sql['busy'] == 0)
    target = dict(runtimeId=scope['runtimeId'], nonceSha256=sha(scope['nonce'].encode()),
                  releaseId=scope['releaseId'], imageIdentity=scope['image'], scopeSha256=grant['sha256'])
    require(len(sql['targets']) == 1)
    row = sql['targets'][0]
    require(all(row[k] == v for k, v in target.items()) and row['phase'] == ('DRAINING' if prepared else 'ACTIVE'))


def http_record_snapshots(native_dir, work_dir):
    files = [native_dir / 'deployment-runtime-native.json', work_dir / 'state.json', work_dir / 'claim.json', work_dir / 'scope.json']
    modes = [0o600, 0o600, 0o600, 0o400]
    return files, modes, [private(file, mode=mode) for file, mode in zip(files, modes)]


def http_state(root, expected, prepared, readers):
    index_raw, _ = private(root / 'index.json')
    config_raw, _ = private(root / 'config.json')
    index, config = json.loads(index_raw), json.loads(config_raw)
    pair = index['privateQualification']
    grant = pair['httpGrant']
    require(expected == dict(runtimeId=grant['scope']['runtimeId'], scopeSha256=grant['sha256']))
    native_dir, work_dir = [Path(grant['scope'][k]) for k in ['nativeDirectory', 'boundaryDirectory']]
    for directory in [native_dir, work_dir]:
        require(directory.is_relative_to(root / 'coordination') and directory.resolve(strict=True) == directory)
    # The fixed layout saves its immutable namespace at 0400. Native/work/claim
    # are journals at 0600; accepting one common mode contradicts that producer.
    files, modes, snapshots = http_record_snapshots(native_dir, work_dir)
    native = json.loads(snapshots[0][0])
    birth = process_birth(native['guardian']['pid'])
    # Prove the actual native guardian, not another still-live process's birth.
    command = (Path('/proc') / str(birth['pid']) / 'cmdline').read_bytes().split(b'\0')
    require(any(v.endswith(b'/backend-runtime-owner.py') for v in command))
    stdout, _ = private(root / 'http-original.stdout', mode=0o600)
    prefix = b'SABALAN_PRIVATE_QUALIFICATION '
    events = [json.loads(line[len(prefix):]) for line in stdout.splitlines() if line.startswith(prefix)]
    source = urlsplit(os.environ['DATABASE_URL'])
    require(source.hostname == 'postgres' and source.path == '/sabalanerp')
    env = dict(os.environ, PGHOST='postgres', PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
               PGPASSWORD=unquote(source.password), PGDATABASE=index['restoredDatabase'],
               PGAPPNAME='original-complete-http-observer', PGCONNECT_TIMEOUT='5',
               PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000')
    query = "SELECT json_build_object('database',json_build_object('name',current_database(),'oid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system())),'visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database()),'busy',(SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND (state IS DISTINCT FROM 'idle' OR xact_start IS NOT NULL)),'targets',(SELECT coalesce(json_agg(t),'[]'::json) FROM private_qualification_runtime_targets t))"
    raw = readers.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', 'BEGIN READ ONLY; ' + query + '; COMMIT;'], env=env)
    sql = json.loads(raw)
    require(sql['database']['name'] == index['restoredDatabase'] and sql['database']['oid'] == str(index['restoredOid']))
    validate_http_records(native_raw=snapshots[0][0], work_raw=snapshots[1][0], claim_raw=snapshots[2][0],
                          namespace_raw=snapshots[3][0], grant=grant, birth=birth, events=events,
                          actor_id=config['actorId'], prepared=prepared, sql=sql)
    target = json.loads(private(native_dir / 'private-qualification/artifacts.json')[0])
    require(sql['targets'][0]['qualificationId'] == pair['qualificationId']
            and sql['targets'][0]['targetsSha256'] == target['targetsSha256']
            and target['targets'] == [{k: sql['targets'][0][k] for k in ['runtimeId', 'nonceSha256', 'releaseId', 'imageIdentity', 'scopeSha256']}])
    require(process_birth(birth['pid']) == birth)
    for file, mode, (raw, metadata) in zip(files, modes, snapshots):
        after, stat_after = private(file, mode=mode)
        require(after == raw and identity(metadata) == identity(stat_after))
    require(private(root / 'index.json')[0] == index_raw and private(root / 'config.json')[0] == config_raw)
    return dict(verified=True, phase='PREPARED_AND_FENCED' if prepared else 'ACTIVE',
                database=sql['database'], guardian=birth, productionAdmission=False)


def layout_grants(root, published=False):
    index = json.loads(private(root / 'index.json')[0])
    config = json.loads(private(root / 'config.json')[0])
    require(index['sourceDatabaseRole'] == 'VERIFIED_COMPLETE_RESTORED_QA')
    lineage = index['restoredQaLineage']
    require(lineage['completeManifestSha256'] == sha(private(root / 'complete-manifest-value.json')[0]))
    grants = []
    selected = [index['restoredBaselineGrant'], index['privateQualification']['httpGrant'], index['privateQualification']['jobsGrant']]
    for grant in selected:
        scope = grant['scope']
        require(re.fullmatch(r'[a-f0-9]{64}', scope['runtimeId'])
                and scope['releaseId'] == 'qa-complete-' + root.parents[1].name.removeprefix('application-native-')
                and scope['coordinationDirectory'] == str(root / 'coordination')
                and scope['image'] == config['image'] and scope['sourceCommit'] == config['sourceCommit']
                and scope['database']['name'] == index['restoredDatabase'])
        raw = (json.dumps(scope, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode()
        require(sha(raw) == grant['sha256'] and grant['file'] == '/run/sabalan-online/' + scope['runtimeId'] + '.json')
        if published:
            require(private(grant['file'])[0] == raw)
        grants.append(dict(name=scope['runtimeId'] + '.json', sha256=sha(raw), rawBase64=base64.b64encode(raw).decode()))
    require(len({g['name'] for g in grants}) == 3)
    for name, digest in config['sourcePins'].items():
        require(Path(name).name == name and re.fullmatch(r'[a-f0-9]{64}', digest))
        require(sha(private(root / name)[0]) == digest)
    return dict(grants=grants, completeManifestSha256=lineage['completeManifestSha256'], completeManifestValueRawBase64=base64.b64encode(private(root / 'complete-manifest-value.json')[0]).decode(), published=published,
                sourcePins=config['sourcePins'], productionAdmission=False)


def main():
    require(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize)
    os.umask(0o077)
    # The enclosing frozen source constructor selects only these literal modes.
    readers = OriginalReaders()
    try:
        request_raw = sys.stdin.buffer.read(4097)
        require(0 < len(request_raw) <= 4096 and not readers.cancelled)
        request = json.loads(request_raw)
        require(isinstance(request, dict) and request.get('mode') in ['trust', 'material', 'http-active', 'http-fenced', 'layout', 'published-layout'])
        if request['mode'] == 'trust':
            require(set(request) == {'mode'})
            raw, value = private('/run/sabalan-online/qualification-controller-public-key.pem', maximum=4096, mode=0o444)
            result = dict(bytes=len(raw), rawBase64=base64.b64encode(raw).decode(), sha256=sha(raw),
                          identity={**identity(value), 'uid': value.st_uid, 'nlink': value.st_nlink, 'mode': value.st_mode})
        elif request['mode'] == 'material':
            require(set(request) == {'mode', 'operation', 'observerSha256'})
            result = material(root_for(request['operation']), request['observerSha256'], readers)
        elif request['mode'] in ['layout', 'published-layout']:
            require(set(request) == {'mode', 'operation'})
            result = layout_grants(root_for(request['operation']), request['mode'] == 'published-layout')
        else:
            require(set(request) == {'mode', 'operation', 'expected'})
            result = http_state(root_for(request['operation']), request['expected'], request['mode'] == 'http-fenced', readers)
        output = json.dumps(result, ensure_ascii=False, separators=(',', ':')).encode()
        require(0 < len(output) <= 32 * 1024**2)
        sys.stdout.buffer.write(output + b'\n')
    finally:
        closure = readers.close()
        require(not closure['failed'] and not closure['cancelled'])


if __name__ == '__main__':
    main()
