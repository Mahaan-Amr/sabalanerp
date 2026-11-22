"""Run the bounded migration through its original genuine native jobs owner."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.parse import urlunsplit


def wait_original_migration_owner(actor, record_deadline, timeout=120, clock=time.monotonic):
    """A diagnostic deadline cannot release custody of the original Popen.

    The caller keeps its serving actor alive until this exact jobs owner exits.
    Crossing the deadline remains a failed qualification even if it later exits 0.
    An evidence-write failure is also deferred until the owner has really exited.
    """
    started = clock()
    deadline_exceeded = False
    recording_error = None
    def crossed_deadline():
        nonlocal deadline_exceeded, recording_error
        deadline_exceeded = True
        try:
            record_deadline(dict(format='sabalan-original-migration-deadline/v1',
                originalPid=actor.pid, deadlineSeconds=timeout, originalResult=False,
                originalHandleRetained=True, ownerStillRunning=actor.returncode is None,
                terminationRequested=False, adoptionAllowed=False))
        except BaseException as error:
            if recording_error is None:
                recording_error = error
    while True:
        try:
            actor.wait(timeout=1)
            break
        except subprocess.TimeoutExpired:
            if not deadline_exceeded and clock() - started >= timeout:
                crossed_deadline()
        except BaseException as error:
            # Interrupting observation cannot release the native child either.
            # Preserve the first failure and report it after actual same-handle exit.
            if recording_error is None:
                recording_error = error
    # A late exit inside the final polling interval is still over the deadline.
    if not deadline_exceeded and clock() - started >= timeout:
        crossed_deadline()
    if recording_error is not None:
        raise recording_error
    return deadline_exceeded


def run(root, index, ready, source, history, sql, write, encoded, check):
    grant = next(value for value in index['grants'] if value['scope']['purpose'] == 'jobs')
    write(root / 'migration-input.json', encoded(dict(format='sabalan-native-migration-input/v1',
          port=ready['port'], seedSha256=ready['seedSha256'], sources=ready['sources'], originalHistory=index['history'])))
    environment = dict(os.environ, DATABASE_URL=urlunsplit(source._replace(path='/' + index['database'], query='connection_limit=2&pool_timeout=10')),
        NODE_ENV='test', NODE_PATH='/app/node_modules', BACKEND_RUNTIME_ROLE='control',
        RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],
        BACKEND_ONLINE_SCOPE_FILE=grant['file'], BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
        APPLICATION_NATIVE_CWD=str(root / 'app'), APPLICATION_MIGRATION_INPUT=str(root / 'migration-input.json'))
    bootstrap = "process.umask(0o077);process.chdir(process.env.APPLICATION_NATIVE_CWD);require(process.argv[1]);"
    started_wall, started_monotonic = time.time(), time.monotonic()
    with (root / 'migration.stdout').open('xb') as output, (root / 'migration.stderr').open('xb') as errors:
        actor = subprocess.Popen(['python3', '-I', '-B', str(root / 'online-runtime-owner.py'), 'node', '-e', bootstrap,
                                  str(root / 'application-migration.cjs')], env=environment, stdin=subprocess.DEVNULL, stdout=output, stderr=errors)
    # Hold this original handle and keep A available through actual jobs closure.
    # Never let TimeoutExpired unwind the controller while jobs is still alive.
    deadline_exceeded = wait_original_migration_owner(actor,
        lambda value: write(root / 'migration-original-deadline.json', encoded(value)))
    stdout = (root / 'migration.stdout').read_bytes()
    check(len(stdout) <= 262144 and b'APPLICATION_NATIVE_MIGRATION_CLOSED' in stdout.splitlines(), 'APPLICATION_NATIVE_MIGRATION_WORK_NOT_CLOSED')
    events = []
    for line in stdout.splitlines():
        try:
            value = json.loads(line)
        except (ValueError, UnicodeError):
            continue
        if isinstance(value, dict) and value.get('event') == 'migration-qualified':
            events.append(value)
    native_raw = (Path(grant['scope']['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
    native = json.loads(native_raw)
    work = json.loads((Path(grant['scope']['boundaryDirectory']) / 'state.json').read_bytes())
    claim = json.loads((Path(grant['scope']['boundaryDirectory']) / 'claim.json').read_bytes())
    write(root / 'migration-original-owner-exited.json', encoded(dict(
        format='sabalan-original-migration-owner-exited/v1', originalPid=actor.pid,
        originalReturncode=actor.returncode, originalHandleRetained=True,
        deadlineExceeded=deadline_exceeded, qualificationPassed=False,
        nativeRawSha256=hashlib.sha256(native_raw).hexdigest(),
        controllerObservedSpawnUnixSeconds=started_wall,
        controllerElapsedSeconds=time.monotonic() - started_monotonic,
        nativeGuardian=native['guardian'], nativeActiveWallTimeKnown=False,
        nativePhase=native['phase'], nativeStatus=native['nativeStatus'],
        nativeReaped=native['nativeReaped'], workPhase=work['phase'],
        databaseQuiet=native['databaseQuiet'])))
    check(actor.returncode == 0 and native['guardian']['pid'] == actor.pid and native['phase'] == work['phase'] == 'QUIESCENT'
          and native['nativeReaped'] and native['databaseQuiet'] and native['nativeStatus'] == 0 and not native['stoppedBySignal']
          and claim['native'] == dict(scopeSha256=grant['sha256'], claimSha256=native['activeClaimSha256']), 'APPLICATION_NATIVE_MIGRATION_OWNER_NOT_CLOSED')
    check(sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='" + native['namespace'] + "'") == '0', 'APPLICATION_NATIVE_MIGRATION_SQL_NOT_CLOSED')
    check(not deadline_exceeded, 'APPLICATION_NATIVE_MIGRATION_DEADLINE_EXCEEDED_AFTER_ORIGINAL_CLOSURE')
    check(len(events) == 1 and events[0]['runtimeId'] == grant['scope']['runtimeId']
          and events[0]['originalHistory'] == index['history'] and events[0]['history'] == history(index['database']), 'APPLICATION_NATIVE_MIGRATION_HISTORY_CHANGED')
    proof = dict(events[0], nativeClaimSha256=hashlib.sha256(native_raw).hexdigest(), nativeStatus=native['nativeStatus'])
    write(root / 'migration-qualified.json', encoded(proof))
    return proof
