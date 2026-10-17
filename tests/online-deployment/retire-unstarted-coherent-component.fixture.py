"""Retire one never-executed diagnostic container after exact closure proof.

Not a generic recovery unlock: these frozen identities apply only to the
UID70 executable-permission fixture failure. Preserve all bytes and journals.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import signal

ROOT = Path('/root/sabalan-recovery-private/native-qa/coherent-component-58e3810ca78d4af1862c53ec9497a074')
PID, TICKS = 1091882, '121420777'
BOOT = 'ee1b3aa2-d239-4849-b926-200549c77829'
CONTROLLER_SHA = '56d5a04eb637467ff13bf428c2a3a925fbff3eaaa58715de524c3bd78fb6eb12'
CONTAINER = '4d0b9b5a413c0cb2fec1b3acc1f3083a214638eaa54e90dad485b2ed545433cf'
retirement_started = False


def normalized(value):
    value = json.loads(json.dumps(value))
    value['Mounts'].sort(key=lambda item: item['Destination'])
    return value


def main():
    global retirement_started
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    source = ROOT / 'independent-restore.py'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == CONTROLLER_SHA
    assert source.stat().st_mode & 0o777 == 0o400
    spec = importlib.util.spec_from_file_location('unstarted_component_native_owner', source)
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    owner.root = ROOT
    assert json.loads(owner.read(ROOT / 'ownership-held-unproven.json', 65536))['phase'] == 'OWNERSHIP_HELD_UNPROVEN'
    assert owner.public_executable(owner.OWNER)
    for token in ['image-load', 'container-create']:
        outcome = json.loads(owner.read(ROOT / (token + '-closed.json'), 65536))
        log = owner.read(ROOT / (token + '.log'), 4 * 1024 ** 2)
        assert outcome['status'] == 0 and outcome['nativeReaped'] is True
        assert owner.sha(log) == outcome['logSha256']
        assert log.endswith(('\nSABALAN_NATIVE_REAPED ' + token + ' 0\n').encode())
    log = owner.read(ROOT / 'native-restore.log', 65536)
    assert log.endswith(b'\nSABALAN_NATIVE_REAPED native-restore 1\n')
    assert b'exec: "/native-owner": permission denied' in log
    assert not (ROOT / 'native-restore-closed.json').exists()
    assert sorted(path.name for path in ROOT.glob('*-intent.json')) == ['container-create-intent.json', 'image-load-intent.json', 'native-restore-intent.json']
    intent_file = ROOT.parent / 'coherent-component-active.json'
    intent_bytes = owner.read(intent_file, 65536)
    intent = json.loads(intent_bytes)
    assert intent == dict(root=str(ROOT), phase='ACTIVE', pid=PID, startTicks=TICKS, bootId=BOOT)
    [container] = json.loads(owner.readonly(['docker', 'inspect', CONTAINER]))
    state = container['State']
    assert container['Id'] == CONTAINER and container['Image'] == owner.IMAGE
    assert container['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-backup-drill'
    assert container['Config']['Labels']['sabalan.drill.operation'] == ROOT.name.removeprefix('coherent-component-')
    assert state['Status'] == 'created' and state['Pid'] == 0 and not state['Running'] and not state['Dead']
    assert state['StartedAt'].startswith('0001-') and state['FinishedAt'].startswith('0001-') and state['ExitCode'] == 126
    assert 'exec: "/native-owner": permission denied' in state['Error']
    assert not container['ExecIDs'] and not container['NetworkSettings']['SandboxKey']
    assert container['HostConfig']['NetworkMode'] == 'none' and container['HostConfig']['ReadonlyRootfs']
    assert len(container['Mounts']) == 4 and all(item['Type'] == 'bind' and item['Source'].startswith(str(ROOT) + '/') for item in container['Mounts'])
    assert [item['Destination'] for item in container['Mounts'] if item['RW']] == ['/var/lib/postgresql/data']
    assert not list((ROOT / 'pgdata').iterdir())
    assert (ROOT / 'native-owner').stat().st_mode & 0o777 == 0o500
    assert owner.sha((ROOT / 'native-owner').read_bytes()) == owner.OWNER_SHA
    assert owner.readonly(['docker', 'ps', '-aq', '--filter', 'label=sabalan.drill.operation=58e3810ca78d4af1862c53ec9497a074']).decode().split() == [CONTAINER[:12]]
    foreign = owner.foreign()
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
        proof = dict(phase='NO_POSTGRES_EXECUTION_PROVEN', controllerPid=PID, startTicks=TICKS, bootId=BOOT,
                     sourceSha256=CONTROLLER_SHA, nativeDescendantsEmpty=True, nativeToolsReaped=True,
                     containerId=CONTAINER, containerNeverStarted=True, nativeDataDirectoryEmpty=True,
                     lockIdentities=identities, failedNativeLogSha256=owner.sha(log), productionRecoveryPoint=False)
        owner.write(ROOT / 'no-execution-proof.json', json.dumps(proof, sort_keys=True).encode())
        owner.write(ROOT / 'unstarted-container-inspection.json', json.dumps(container, sort_keys=True).encode())
        # No SQL/server/native child has executed or remains. Close ONLY this
        # exact idle diagnostic holder, never a runtime/database or a guessed PID.
        retirement_started = True
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        poll = select.poll()
        poll.register(pidfd, select.POLLIN)
        assert poll.poll(10000), 'EXACT_IDLE_CONTROLLER_EXIT_UNPROVEN'
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
    assert normalized(json.loads(owner.readonly(['docker', 'inspect', CONTAINER]))[0]) == normalized(container)
    assert not list((ROOT / 'pgdata').iterdir())
    owner.mutate(['docker', 'rm', CONTAINER], 'unstarted-container-retire', 60)
    assert not owner.readonly(['docker', 'ps', '-aq', '--filter', 'id=' + CONTAINER]).strip()
    final_foreign = owner.foreign()
    assert all(final_foreign.get(identity) == expected for identity, expected in foreign.items())
    result = dict(proof, phase='CLOSED_FAILED_DIAGNOSTIC', controllerExactExitProven=True,
                  originalKernelLocksReacquired=True, containerRetiredWithoutForce=True,
                  allDiagnosticBytesAndImageRetained=True, foreignServicesUnchanged=True)
    owner.write(ROOT / 'unstarted-retirement-proof.json', json.dumps(result, sort_keys=True).encode())
    assert owner.read(intent_file, 65536) == intent_bytes
    os.rename(intent_file, ROOT / 'closed-failed-owner-intent.json')
    owner.sync(ROOT)
    owner.sync(ROOT.parent)
    print(json.dumps(result))


if __name__ == '__main__':
    os.umask(0o077)
    try:
        main()
    except BaseException:
        # Never release retirement ownership on an unknown native outcome.
        if retirement_started:
            import time
            import traceback
            try:
                file = ROOT / 'retirement-held-diagnostic.log'
                with file.open('x') as stream:
                    os.chmod(file, 0o600)
                    stream.write(traceback.format_exc())
                    stream.flush()
                    os.fsync(stream.fileno())
            except BaseException:
                pass
            while True:
                time.sleep(1)
        raise
