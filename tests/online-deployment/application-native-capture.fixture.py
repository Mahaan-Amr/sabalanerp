"""One diagnostic native fleet, paired routing, coherent cut and restored app.

The SQLite source is the actual separately native-owned Inquiry runtime. No
healthy production point, continuous WAL, image admission or public switch.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import threading
import time
import http.client
import weakref
from urllib.parse import urlunsplit

_original_inquiry = None
_original_capture = None
_original_arrival = None
_original_sql = None
_original_root = None
_abort_proofs = weakref.WeakSet()


class OriginalCaptureFailureProof:
    def __init__(self, authority):
        if authority is not _abort_proofs:
            raise RuntimeError('APPLICATION_CAPTURE_FAILURE_PROOF_UNPROVEN')


def original_capture_failure_proof():
    if _original_sql is None or not original_capture_custody_closed(_original_sql):
        raise RuntimeError('APPLICATION_CAPTURE_ORIGINAL_OWNER_STILL_UNKNOWN')
    if _original_inquiry is not None:
        for name, actor in _original_inquiry.actors.items():
            if actor.poll() is None or name not in _original_inquiry.closures:
                raise RuntimeError('APPLICATION_CAPTURE_ORIGINAL_INQUIRY_STILL_UNKNOWN')
        if any(client.poll() is None for client in _original_inquiry.clients.values()):
            raise RuntimeError('APPLICATION_CAPTURE_ORIGINAL_INQUIRY_CLIENT_STILL_UNKNOWN')
    proof = OriginalCaptureFailureProof(_abort_proofs)
    _abort_proofs.add(proof)
    return proof


def read_original_capture_failure_proof(proof):
    if proof not in _abort_proofs:
        raise RuntimeError('APPLICATION_CAPTURE_FAILURE_PROOF_UNPROVEN')
    # Revalidate the SAME retained original handles and fresh SQL at use.
    original_capture_failure_proof()
    return dict(originalPass=False, root=str(_original_root),
                captureNeverStarted=_original_capture is None,
                originalCapturePid=_original_capture[0].pid if _original_capture is not None else None,
                originalCaptureReturncode=_original_capture[0].returncode if _original_capture is not None else None)


def resource_floor(root, stage, required, write, encoded, check):
    cgroup = Path('/sys/fs/cgroup')
    maximum, current = int((cgroup / 'memory.max').read_text()), int((cgroup / 'memory.current').read_text())
    facts = dict(stage=stage, maximum=maximum, current=current, available=maximum-current,
                 requiredDiagnosticBytes=required, guaranteedWorkloadCap=False,
                 events=(cgroup / 'memory.events').read_text(), observedMonotonic=time.monotonic())
    write(root / ('resources-' + stage + '.json'), encoded(facts))
    check(maximum == 768*1024*1024 and maximum-current >= required,
          'APPLICATION_CAPTURE_CAPACITY_REFUSED_' + stage.upper().replace('-', '_'))
    return facts


def no_resource_oom(before, after):
    values = lambda facts: {key: int(value) for key, value in (line.split() for line in facts['events'].splitlines())}
    left, right = values(before), values(after)
    return all(left.get(key, 0) == right.get(key, 0) for key in ['oom', 'oom_kill', 'oom_group_kill'])


def original_capture_custody_closed(sql):
    """A JSON record cannot replace the original Popen or queued client."""
    if _original_arrival is not None and _original_arrival.is_alive():
        return False
    if _original_capture is None:
        return True
    owner, grant = _original_capture
    if owner.poll() is None:
        return False
    native = json.loads((Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes())
    work = json.loads((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes())
    return (native['guardian']['pid'] == owner.pid and native['onlineScope']['sha256'] == grant['sha256']
        and native['phase'] == work['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet']
        and not native['stoppedBySignal'] and owner.returncode == (native['nativeStatus'] if 0 <= native['nativeStatus'] <= 125 else 125)
        and sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native['namespace'] + "'") == '0'
        and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + grant['scope']['database']['name'] + "'") == '0')


def close_original_inquiry_if_quiet(root, write, encoded):
    """Only the retained original Popen owners; never reopen capture or adopt."""
    inquiry = _original_inquiry
    if inquiry is None or inquiry.outer != root:
        return
    outcomes = []
    for name, actor in inquiry.actors.items():
        if name in inquiry.closures:
            outcomes.append(dict(name=name, **inquiry.closures[name]))
            continue
        try:
            inquiry.check(actor.poll() is None and inquiry.work(name)['phase'] == 'QUIESCENT', 'INQUIRY_FAILURE_WORK_NOT_QUIET')
            outcomes.append(dict(name=name, **inquiry.stop(name)))
        except Exception as failure:
            outcomes.append(dict(name=name, held=True, failureType=type(failure).__name__))
    write(root / 'failure-original-inquiry-finish.json', encoded(dict(originalPass=False,
        originalOwners=outcomes, captureNotReopened=True, databaseNotDropped=True)))


def run(root, index, observations, routing, source, environment, sql, history, write, encoded, check, *, role_client):
    global _original_inquiry, _original_capture, _original_arrival, _original_sql, _original_root
    _original_sql, _original_root = sql, root
    grant = next(value for value in index['grants'] if value['scope']['purpose'] == 'capture')
    sources = observations[0]['sources']
    check(len(sources) == 9 and sources == observations[1]['sources'], 'APPLICATION_CAPTURE_ROOT_ENROLLMENT_CHANGED')
    for actor in observations:
        scope = next(value['scope'] for value in index['grants'] if value['scope']['runtimeId'] == actor['runtimeId'])
        deadline = time.monotonic() + 5
        while json.loads((Path(scope['boundaryDirectory']) / 'state.json').read_bytes())['phase'] != 'QUIESCENT':
            check(time.monotonic() < deadline, 'APPLICATION_CAPTURE_WORK_NOT_QUIET')
            time.sleep(0.02)
    component = root / 'coherent-component'
    component.mkdir(mode=0o700)
    inquiry_spec = importlib.util.spec_from_file_location('joined_native_inquiry', root / 'application-native-inquiry.fixture.py')
    inquiry_module = importlib.util.module_from_spec(inquiry_spec); inquiry_spec.loader.exec_module(inquiry_module)
    inquiry = inquiry_module.InquiryActors(root, index, environment, write, check)
    _original_inquiry = inquiry
    before_inquiry = resource_floor(root, 'before-source-inquiry', 192*1024*1024, write, encoded, check)
    sqlite_source = inquiry.prepare_source()
    inquiry.start_source()
    before_capture = resource_floor(root, 'before-native-capture', 128*1024*1024, write, encoded, check)
    check(no_resource_oom(before_inquiry, before_capture), 'APPLICATION_CAPTURE_SOURCE_INQUIRY_OOM_DELTA')
    inquiry.begin_lost_ack()
    capture_id, handshake = hashlib.sha256(os.urandom(32)).hexdigest(), hashlib.sha256(os.urandom(32)).hexdigest()
    scope = dict(format='sabalan-coherent-capture-scope/v3', captureId=capture_id, handshake=handshake,
                 systemIdentifier=grant['scope']['database']['systemIdentifier'], databaseName=index['database'],
                 storeRoot=None, sources=[{key: value[key] for key in ['name', 'path', 'device', 'inode', 'storeRoot']} for value in sources],
                 inquiry=sqlite_source, logicalDump=True,
                 sealer=dict(script=str(root / 'native-file-sealer.cjs'), sha256=hashlib.sha256((root / 'native-file-sealer.cjs').read_bytes()).hexdigest(),
                     stores=[dict(name=value['name'], **value['storeIdentity']) for value in sources]))
    write(component / 'scope.json', encoded(scope))
    capture_env = dict(os.environ, DATABASE_URL=urlunsplit(source._replace(path='/' + index['database'], query='connection_limit=2&pool_timeout=10')),
        NODE_ENV='test', BACKEND_RUNTIME_ROLE='control', RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],
        BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'], NODE_PATH='/app/node_modules')
    with (root / 'capture.stdout').open('xb') as output, (root / 'capture.stderr').open('xb') as errors:
        owner = subprocess.Popen(['python3', '-I', '-B', str(root / 'online-runtime-owner.py'), 'python3', '-I', '-B',
                                  str(root / 'application-native-capture.worker.py'), str(component / 'scope.json')],
                                  env=capture_env, stdin=subprocess.PIPE, stdout=output, stderr=errors)
    _original_capture = (owner, grant)
    closing_file = Path(grant['scope']['admission']['directory']) / '00000001.json'
    deadline = time.monotonic() + 30
    while not closing_file.exists():
        check(owner.poll() is None and time.monotonic() < deadline, 'APPLICATION_CAPTURE_CLOSING_NOT_PUBLISHED')
        time.sleep(0.02)
    check(json.loads(closing_file.read_bytes())['phase'] == 'CLOSING', 'APPLICATION_CAPTURE_CLOSING_CHANGED')
    inquiry.queue_during_capture()
    inquiry.release_lost_ack()
    frozen = wait_event(root / 'capture.stdout', owner, 'phase', 'FROZEN', 120, check)
    check(frozen['handshake'] == handshake and len(frozen['versionedCuts']) == len(sources), 'APPLICATION_CAPTURE_FROZEN_INVALID')
    check(json.loads((Path(grant['scope']['admission']['directory']) / '00000001.json').read_bytes())['phase'] == 'CLOSING',
          'APPLICATION_CAPTURE_PAUSE_MISSING')
    seed = json.loads((root / 'app/acceptance-seed.json').read_bytes())
    # This actual client submits a complete HTTP multipart body during the
    # pause. It cannot cancel ownership of the server's admitted work.
    queued, sent = {}, threading.Event()
    def later_upload():
        connection = http.client.HTTPConnection(observations[0]['host'], observations[0]['port'], timeout=180)
        boundary = 'private-native-capture-' + capture_id[:24]
        contents = b'%PDF-1.4\nPOST NATIVE COHERENT CUT\n'
        body = (f'--{boundary}\r\nContent-Disposition: form-data; name="category"\r\n\r\nNATIONAL_ID_FRONT\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="inspectionSource"\r\n\r\nCOPY_RECEIVED\r\n'
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="post-cut.pdf"\r\nContent-Type: application/pdf\r\n\r\n').encode() + contents + f'\r\n--{boundary}--\r\n'.encode()
        try:
            connection.request('POST', '/api/hr-hiring/applications/' + seed['apiApplicationId'] + '/documents', body=body,
                headers={'Cookie': 'sabalan_session=' + seed['sessionToken'], 'Content-Type': 'multipart/form-data; boundary=' + boundary})
            sent.set()
            response = connection.getresponse(); payload = response.read()
            queued.update(status=response.status, body=json.loads(payload), sha256=hashlib.sha256(contents).hexdigest())
        except BaseException as failure:
            queued['failure'] = type(failure).__name__
            sent.set()
        finally:
            connection.close()
    arrival = threading.Thread(target=later_upload)
    _original_arrival = arrival
    arrival.start()
    check(sent.wait(10) and 'failure' not in queued, 'APPLICATION_CAPTURE_QUEUED_CLIENT_NOT_SENT')
    check(sql("SELECT count(*) FROM public.hr_hiring_documents WHERE \"applicationId\"='" + seed['apiApplicationId'] + "'", index['database']) == '4',
          'APPLICATION_CAPTURE_QUEUED_WRITE_VISIBLE')
    check(arrival.is_alive() and not queued, 'APPLICATION_CAPTURE_QUEUED_WRITE_FINISHED_EARLY')
    owner.stdin.write(encoded(dict(phase='BEGIN_CAPTURE', handshake=handshake, versionedCuts=frozen['versionedCuts'])))
    owner.stdin.flush(); owner.stdin.close()
    owner.wait(timeout=120)
    check(owner.returncode == 0, 'APPLICATION_CAPTURE_NATIVE_OWNER_FAILED')
    after_capture = resource_floor(root, 'after-native-capture', 0, write, encoded, check)
    check(no_resource_oom(before_capture, after_capture), 'APPLICATION_CAPTURE_NATIVE_OOM_DELTA')
    native_raw = (Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
    native = json.loads(native_raw)
    check(native['phase'] == 'QUIESCENT' and native['nativeReaped'] and native['databaseQuiet']
          and native['nativeStatus'] == 0 and not native['stoppedBySignal'], 'APPLICATION_CAPTURE_CLOSURE_UNPROVEN')
    opened = json.loads((Path(grant['scope']['admission']['directory']) / '00000002.json').read_bytes())
    check(opened['phase'] == 'OPEN' and opened['closureSha256'] == hashlib.sha256(native_raw).hexdigest(), 'APPLICATION_CAPTURE_REOPEN_UNPROVEN')
    inquiry.source_after_open()
    arrival.join(timeout=30)
    check(not arrival.is_alive() and queued.get('status') == 201, 'APPLICATION_CAPTURE_QUEUED_WRITE_NOT_ACKNOWLEDGED')
    post_cut = queued['body']['data']
    check(post_cut['sha256'] == queued['sha256'], 'APPLICATION_CAPTURE_POST_CUT_BYTES_CHANGED')
    check(sql("SELECT count(*) FROM public.hr_hiring_documents WHERE \"applicationId\"='" + seed['apiApplicationId'] + "'", index['database']) == '5',
          'APPLICATION_CAPTURE_POST_CUT_SQL_MISSING')
    captured = json.loads((component / 'captured.json').read_bytes())
    check(captured['versionedCuts'] == frozen['versionedCuts'] and captured['phase'] == 'CAPTURED_AWAITING_NATIVE_CLOSURE', 'APPLICATION_CAPTURE_POINT_CHANGED')
    check(hashlib.sha256((component / 'registered-backend-boundary.json').read_bytes()).hexdigest() == captured['registeredBackendBoundarySha256'],
          'APPLICATION_CAPTURE_CENSUS_CHANGED')
    census = json.loads((component / 'registered-backend-boundary.json').read_bytes())
    expected_roster = {value['scope']['runtimeId']: ('CAPTURING' if value['scope']['purpose'] == 'capture' else
                       'QUIESCENT' if value['scope']['purpose'] == 'jobs' else 'ACTIVE') for value in index['grants']}
    expected_roster[index['inquiryGrants']['source']['scope']['runtimeId']] = 'ACTIVE'
    check({value['runtimeId']: value['phase'] for value in census['runtimes']} == expected_roster
          and len(census['runtimes']) == len(expected_roster), 'APPLICATION_CAPTURE_FLEET_CHANGED')
    dump = component / captured['logicalDump']['file']
    check(dump.stat().st_size == captured['logicalDump']['bytes'] and hashlib.sha256(dump.read_bytes()).hexdigest() == captured['logicalDump']['sha256'], 'APPLICATION_CAPTURE_DUMP_CHANGED')
    # Every restoration and object copy below occurs AFTER genuine OPEN.
    specification = importlib.util.spec_from_file_location('native_independent_versioned_reader', root / 'recovery-versioned-files.py')
    reader = importlib.util.module_from_spec(specification); specification.loader.exec_module(reader)
    restored_app = Path(index['privateQualification']['qualificationRoot'])
    check(restored_app == Path(index['restoredGrant']['scope']['coordinationDirectory']) / 'private-qualifications'
          / index['privateQualification']['qualificationId'] / 'restored-app', 'APPLICATION_CAPTURE_PRIVATE_ROOT_CHANGED')
    restored_app.parent.mkdir(parents=True, exist_ok=False, mode=0o700)
    restored_versions = restored_app / '.versioned-files'
    restored_app.mkdir(mode=0o700); restored_versions.mkdir(mode=0o700)
    restored_files = []
    baseline_sources = []
    for cut, enrolled in zip(captured['versionedCuts'], sources):
        target = root / ('independent-cut-' + cut['name'])
        restored_files.append(reader.SealedVersionedFiles(cut['storeRoot'], cut['captureId'], cut['sha256']).restore(str(target)))
        relative = Path(enrolled['path']).relative_to(root / 'app')
        destination = restored_app / relative
        destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        check(not destination.exists(), 'APPLICATION_CAPTURE_RESTORE_TARGET_EXISTS')
        shutil.copytree(target / 'files', destination)
        for directory, _directories, files in os.walk(destination, topdown=False):
            for name in files:
                fd = os.open(Path(directory) / name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
                try:
                    os.fsync(fd)
                finally:
                    os.close(fd)
            fd = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
            try:
                os.fsync(fd)
            finally:
                os.close(fd)
        fd = os.open(destination.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
        store = restored_versions / ('hr-' + str(len(baseline_sources)))
        store.mkdir(mode=0o700)
        baseline_sources.append(dict(name=cut['name'], liveRoot=str(destination), storeRoot=str(store),
                                     cutSha256=cut['sha256'], restoreReceipt=dict(path=str(target / 'complete.json'),
                                         sha256=hashlib.sha256((target / 'complete.json').read_bytes()).hexdigest()),
                                     files=sorted(restored_files[-1]['files'], key=lambda value: value['key'])))
    source_inquiry_closure = inquiry.stop_source()
    migration = json.loads((root / 'migration-qualified.json').read_bytes())
    check(migration['performanceCleanup']['format'] == 'sabalan-native-performance-cleanup/v1'
          and len(migration['performanceCleanup']['cases']) == 7
          and migration['performanceCleanup']['transactionClientRefusedBeforeMutation']
          and migration['performanceCleanup']['periodicJobsCleanupExercised']
          and migration['performanceExport']['format'] == 'sabalan-native-performance-export/v1'
          and migration['performanceExport']['cipherBytes'] > 32
          and migration['performanceExport']['versionSha256']
          and migration['performanceExport']['sourcePolicyId'], 'APPLICATION_CAPTURE_PERFORMANCE_DOMAIN_UNQUALIFIED')
    restored_db = index['restoredDatabase']
    check(sql("SELECT oid FROM pg_database WHERE datname='" + restored_db + "'") == index['restoredOid'], 'APPLICATION_CAPTURE_RESTORE_DATABASE_REPLACED')
    restored = subprocess.run(['pg_restore', '--no-owner', '--no-privileges', '--exit-on-error', '-d', restored_db, str(dump)], env=environment, stdin=subprocess.DEVNULL, capture_output=True)
    check(restored.returncode == 0 and history(restored_db) == migration['history'], 'APPLICATION_CAPTURE_SQL_RESTORE_FAILED')
    check(sql('SELECT count(*)::text || \':\' || sum(amount)::text || \':\' || bool_and(amount=amount_v2)::text FROM application_online_migration_probe', restored_db)
          == '100:1032.50000000:true', 'APPLICATION_CAPTURE_RESTORED_BACKFILL_CHANGED')
    manifest = root / 'restored-file-baseline.json'
    captured_copy = root / 'restored-captured-manifest.json'
    captured_bytes = (component / 'captured.json').read_bytes()
    write(captured_copy, captured_bytes)
    baseline_bytes = encoded(dict(format='sabalan-application-restored-file-baseline/v1', captureId=capture_id,
        capturedManifest=dict(path=str(captured_copy), sha256=hashlib.sha256(captured_bytes).hexdigest()), sources=baseline_sources))
    write(manifest, baseline_bytes)
    baseline_grant = index['restoredBaselineGrant']
    role_client.request('RUN_RESTORED_BASELINE', dict(manifestPath=str(manifest),
        manifestSha256=hashlib.sha256(baseline_bytes).hexdigest()), 'RESTORED_BASELINE_DONE', baseline_grant)
    baseline_proof = json.loads(Path(str(manifest) + '.completed.json').read_bytes())
    check(baseline_proof['manifestSha256'] == hashlib.sha256(baseline_bytes).hexdigest()
          and baseline_proof['captureId'] == capture_id and len(baseline_proof['proofs']) == len(sources), 'APPLICATION_RESTORED_BASELINE_PROOF_INVALID')
    restored_inquiry = role_client.request('RUN_RESTORED_INQUIRY', dict(capturedSqlite=str(component / captured['sqliteSnapshot']['file']),
        sha256=captured['sqliteSnapshot']['sha256'], sourceClosureReceipt=source_inquiry_closure),
        'RESTORED_INQUIRY_DONE', index['inquiryGrants']['restored'])
    restored_inquiry_closure = restored_inquiry['result']
    write(restored_app / 'acceptance-seed.json', (root / 'app/acceptance-seed.json').read_bytes(), 0o600)
    write(restored_app / 'restore-expectations.json', encoded(dict(uploads=routing['uploads'], erased=[value['erased'] for value in observations],
        accountingArtifacts=[value['accountingArtifact'] for value in observations],
        sharedImages=[value['sharedImage'] for value in observations],
        supportRetention=migration['support'],
        performanceCleanup=migration['performanceCleanup'], performanceExport=migration['performanceExport'],
        dispatchArtifact=migration['dispatch'], contractPrint=observations[0]['contractPrint'],
        securityUpload=observations[0]['securityUpload'], browserSupportTickets=routing['tickets'],
        supportStagedHttp=observations[0]['supportStagedHttp'],
        postCutDocumentId=post_cut['id'], postCutStorageName=post_cut['storageName'])), 0o600)
    restored_grant = index['restoredGrant']
    restored_ready = role_client.request('START_RESTORED_HTTP', dict(seedSha256=observations[0]['seedSha256'],
        expectationsSha256=hashlib.sha256((restored_app / 'restore-expectations.json').read_bytes()).hexdigest()),
        'RESTORED_HTTP_READY')
    ready = restored_ready['result']
    check(ready['runtimeId'] == restored_grant['scope']['runtimeId'] and ready['restoredAcceptance']['postCutAbsent'], 'APPLICATION_CAPTURE_RESTORED_APP_UNQUALIFIED')
    check(ready['restoredAcceptance']['restoredPerformanceCleanupCases'] == 7
          and ready['restoredAcceptance']['restoredPerformanceDomainDownload'], 'APPLICATION_CAPTURE_RESTORED_PERFORMANCE_UNQUALIFIED')
    check(ready['restoredAcceptance']['restoredBrowserSupport'] == dict(tickets=2, attachments=2, originalScreenshotBytes=True,
          actualRestoredHttpAuthorization=True), 'APPLICATION_CAPTURE_RESTORED_BROWSER_SUPPORT_UNQUALIFIED')
    check(ready['restoredAcceptance']['restoredSupportStagedHttp'] == dict(above16MiBValidPdf=True, originalSqlAndFileHash=True,
          actualAuthorizedDownload=True, unauthorized401=True), 'APPLICATION_CAPTURE_RESTORED_STAGED_SUPPORT_UNQUALIFIED')
    role_client.request('FINISH_RESTORED_HTTP', dict(actorId=role_client.actors['restored-http']),
        'RESTORED_HTTP_DONE', restored_grant, actor_id=role_client.actors['restored-http'])
    check(b'APPLICATION_NATIVE_WORK_CLOSED' in (root / 'restored-application.stdout').read_bytes(), 'APPLICATION_CAPTURE_RESTORED_APP_NOT_CLOSED')
    check(sql("SELECT (SELECT count(*) FROM pg_stat_activity WHERE datname='" + restored_db + "')+(SELECT count(*) FROM pg_prepared_xacts WHERE database='" + restored_db + "')") == '0'
          and history(restored_db) == migration['history'] and sql("SELECT oid FROM pg_database WHERE datname='" + restored_db + "'") == index['restoredOid'], 'APPLICATION_CAPTURE_RESTORED_DATABASE_STILL_ACTIVE')
    return dict(format='sabalan-native-application-coherent-integration/v1', passResult=True, productionAdmission=False,
                continuousWalQualified=False, inquiryRuntimeQualified=True, immutableDifferentImagesQualified=False,
                independentHostQualified=False, restoredFileHistoryEnrollmentQualified=False, restoredWriterBaselineQualified=True,
                restoredFileBaseline=baseline_proof, sourceFileHistoryRetainedSeparately=True,
                captureId=capture_id, nativeClaimSha256=hashlib.sha256(native_raw).hexdigest(),
                originalMigrationHistory=index['history'], migrationHistory=migration['history'], ownedMigration=migration,
                inquiry=dict(sourceClosure=source_inquiry_closure, restoredClosure=restored_inquiry_closure,
                    actualNextActions=True, acknowledgedLostCommitRestored=True, queuedPostCutAbsent=True),
                fleet=census, restoredFileRoots=len(restored_files),
                restoredFileCount=sum(len(value['files']) for value in restored_files),
                independentlyVerifiedFileCuts=restored_files, accountingArtifactContentsQualified=True,
                restoredApplication=ready['restoredAcceptance'], queuedRequestSubmittedDuringClosing=True,
                postCutDocumentId=post_cut['id'], originalRestoredDatabaseRetiredWithoutForce=False,
                restoredDatabaseHeldForPrivateQualification=True)


def wait_event(file, child, key, value, seconds, check):
    deadline, total = time.monotonic() + seconds, 0
    with file.open('rb') as stream:
        while True:
            check(time.monotonic() < deadline, 'APPLICATION_CAPTURE_EVENT_DEADLINE')
            offset = stream.tell(); line = stream.readline(65537)
            if not line:
                check(child.poll() is None, 'APPLICATION_CAPTURE_ACTOR_FAILED'); time.sleep(0.02); continue
            check(len(line) <= 65536, 'APPLICATION_CAPTURE_LOG_CAPACITY')
            if not line.endswith(b'\n'):
                stream.seek(offset); time.sleep(0.02); continue
            total += len(line); check(total <= 262144, 'APPLICATION_CAPTURE_LOG_CAPACITY'); os.fsync(stream.fileno())
            try:
                record = json.loads(line)
            except (ValueError, UnicodeError):
                continue
            if isinstance(record, dict) and record.get(key) == value:
                return record
