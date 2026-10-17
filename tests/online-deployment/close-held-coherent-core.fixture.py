"""Close one successful native diagnostic with inconclusive ambient QA state.

No failed acceptance is promoted: retain the foreign-observation failure, all
bytes and exact native proofs. This creates no healthy production point.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import signal

ROOT = Path('/root/sabalan-recovery-private/native-qa/coherent-component-f996d3f75fe8434eb801464dbb313734')
PID, TICKS = 1096563, '121451966'
BOOT = 'ee1b3aa2-d239-4849-b926-200549c77829'
CONTROLLER_SHA = '20f89e5747cf73df05565e9bbfc11885a90f02003085b49d544118402ec70a85'
CONTAINER = '564e9f80ab578d44b78a5597a4093c3a40c40438456578df96e9ace1921e951e'
CHANGED_QA = 'f3eb8e28847f86275ddde8e56dba6a77b442b848d899836fe5c2ff16bbd64f14'
closing_started = False


def normalized_mounts(value):
    return sorted(value, key=lambda item: item['Destination'])


def main():
    global closing_started
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    source = ROOT / 'independent-restore.py'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == CONTROLLER_SHA
    assert source.stat().st_mode & 0o777 == 0o400
    spec = importlib.util.spec_from_file_location('closed_component_native_owner', source)
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    owner.root = ROOT
    assert owner.public_executable(owner.OWNER)
    assert json.loads(owner.read(ROOT / 'ownership-held-unproven.json', 65536))['phase'] == 'OWNERSHIP_HELD_UNPROVEN'
    assert not (ROOT / 'independent-proof.json').exists()
    assert sorted(path.name for path in ROOT.glob('*-intent.json')) == ['container-create-intent.json', 'native-restore-intent.json']
    for token in ['container-create', 'native-restore']:
        closed = json.loads(owner.read(ROOT / (token + '-closed.json'), 65536))
        log = owner.read(ROOT / (token + '.log'), 4 * 1024 ** 2)
        assert closed['status'] == 0 and closed['nativeReaped'] is True
        assert owner.sha(log) == closed['logSha256']
        assert log.endswith(('\nSABALAN_NATIVE_REAPED ' + token + ' 0\n').encode())
    assert b'\nSABALAN_COMPONENT_RESTORED 123456789.12345678/0.00000001/original.pdf 427\n' in log
    assert b'\nSABALAN_NATIVE_REAPED component-native-restore 0\n' in log
    assert b'server stopped\n' in log
    [container] = json.loads(owner.readonly(['docker', 'inspect', CONTAINER]))
    state = container['State']
    assert container['Id'] == CONTAINER and container['Image'] == owner.IMAGE
    assert container['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-backup-drill'
    assert container['Config']['Labels']['sabalan.drill.operation'] == ROOT.name.removeprefix('coherent-component-')
    assert state['Status'] == 'exited' and state['Pid'] == 0 and state['ExitCode'] == 0
    assert not state['Running'] and not state['Dead'] and not state['OOMKilled']
    assert not container['ExecIDs'] and not (ROOT / 'pgdata/postmaster.pid').exists()
    assert len(container['Mounts']) == 4 and all(item['Type'] == 'bind' and item['Source'].startswith(str(ROOT) + '/') for item in container['Mounts'])
    assert container['HostConfig']['NetworkMode'] == 'none' and container['HostConfig']['ReadonlyRootfs']
    original = json.loads(owner.read(ROOT / 'foreign-before.json', 65536))
    after = owner.foreign()
    changed = {identity: value for identity, value in original.items() if after.get(identity) != value}
    assert set(changed) == {CHANGED_QA}
    assert changed[CHANGED_QA]['name'] == '/fintech-price-action-study-qa-20261017'
    persistent = {identity: value for identity, value in original.items() if identity != CHANGED_QA}
    assert len(persistent) >= 15
    assert all(after.get(identity) == value for identity, value in persistent.items())
    # Preserve the failed all-foreign-identity acceptance. A concurrent QA
    # replacement is observed, never attributed or silently accepted as PASS.
    core = dict(format='sabalan-independent-coherent-core-observation/v1',
                phase='NATIVE_RESTORE_VERIFIED_FOREIGN_OBSERVATION_INCONCLUSIVE',
                productionRecoveryPoint=False, allForeignAcceptancePassed=False,
                controllerSha256=CONTROLLER_SHA, containerId=CONTAINER,
                nativePostgresRestoreVerified=True, nativePostgresStoppedNaturally=True,
                migrationCount=427, amount='123456789.12345678', quantity='0.00000001',
                storageKey='original.pdf', nativeLogSha256=owner.sha(log),
                persistentForeignIdentitiesUnchanged=persistent,
                changedForeignQaObservation=changed,
                additionalForeignIdentities={key: value for key, value in after.items() if key not in original},
                fullIndependentApplicationAcceptanceStillRequired=True)
    owner.write(ROOT / 'native-core-observation.json', json.dumps(core, sort_keys=True).encode())
    intent_file = ROOT.parent / 'coherent-component-active.json'
    intent_bytes = owner.read(intent_file, 65536)
    assert json.loads(intent_bytes) == dict(root=str(ROOT), phase='ACTIVE', pid=PID, startTicks=TICKS, bootId=BOOT)
    lock_paths = [ROOT.parent.parent / 'drill-ownership.lock', Path('/run/lock/sabalan-backup-storage.lock')]
    identities = []
    process = Path('/proc') / str(PID)
    pidfd = os.pidfd_open(PID)
    try:
        assert Path('/proc/sys/kernel/random/boot_id').read_text().strip() == BOOT
        assert (process / 'stat').read_text().rsplit(') ', 1)[1].split()[19] == TICKS
        assert str(source).encode() in (process / 'cmdline').read_bytes().split(b'\0')
        assert not (process / 'task' / str(PID) / 'children').read_text().strip()
        for number, path in zip((9, 10), lock_paths):
            value, held = path.stat(), (process / ('fd/' + str(number))).stat()
            assert (value.st_dev, value.st_ino) == (held.st_dev, held.st_ino)
            details = (process / ('fdinfo/' + str(number))).read_text()
            assert 'FLOCK  ADVISORY  WRITE ' in details and ':' + str(value.st_ino) + ' 0 EOF' in details
            identities.append((value.st_dev, value.st_ino))
        owner.write(ROOT / 'native-idle-holder-closure-proof.json', json.dumps(dict(
            phase='NATIVE_CLOSURE_PROVEN', controllerPid=PID, startTicks=TICKS, bootId=BOOT,
            nativeToolsReaped=True, nativeDescendantsEmpty=True, containerPidZero=True,
            nativePostgresStoppedNaturally=True, lockIdentities=identities, productionRecoveryPoint=False)).encode())
        closing_started = True
        # All server/native work is already complete. Close this exact idle
        # diagnostic holder, never an executing PostgreSQL/application process.
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        poll = select.poll()
        poll.register(pidfd, select.POLLIN)
        assert poll.poll(10000)
    finally:
        os.close(pidfd)
    locks = [os.open(path, os.O_RDWR | os.O_NOFOLLOW) for path in lock_paths]
    for fd, identity in zip(locks, identities):
        assert (os.fstat(fd).st_dev, os.fstat(fd).st_ino) == identity
        fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
    owner.inherit_ownership(locks)
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]:
        signal.signal(number, lambda *_: None)
    assert owner.read(intent_file, 65536) == intent_bytes
    [fresh] = json.loads(owner.readonly(['docker', 'inspect', CONTAINER]))
    assert fresh['State'] == state and fresh['Image'] == container['Image']
    assert normalized_mounts(fresh['Mounts']) == normalized_mounts(container['Mounts'])
    owner.mutate(['docker', 'rm', CONTAINER], 'completed-diagnostic-container-retire', 60)
    assert not owner.readonly(['docker', 'ps', '-aq', '--filter', 'id=' + CONTAINER]).strip()
    final_foreign = owner.foreign()
    assert all(final_foreign.get(identity) == value for identity, value in persistent.items())
    result = dict(core, phase='CLOSED_DIAGNOSTIC_WITH_FOREIGN_OBSERVATION_FAILURE',
                  controllerExactExitProven=True, originalKernelLocksReacquired=True,
                  terminalContainerRetiredWithoutForce=True, allBytesAndImageRetained=True)
    owner.write(ROOT / 'closed-core-proof.json', json.dumps(result, sort_keys=True).encode())
    assert owner.read(intent_file, 65536) == intent_bytes
    os.rename(intent_file, ROOT / 'closed-owner-foreign-observation-failure.json')
    owner.sync(ROOT)
    owner.sync(ROOT.parent)
    print(json.dumps(result))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BaseException:
        if closing_started:
            import time
            import traceback
            try:
                with (ROOT / 'core-closure-held.log').open('x') as stream:
                    os.chmod(stream.name, 0o600)
                    stream.write(traceback.format_exc())
                    stream.flush()
                    os.fsync(stream.fileno())
            except BaseException:
                pass
            while True:
                time.sleep(1)
        raise
