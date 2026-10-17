"""Close one diagnostic controller only after proving no PG execution occurred.

This preserves its failure journal and never declares a serving/recovery gate
passed. Exact native receipts, birth-bound pidfd exit, never-started container
and empty anonymous volume proofs precede their narrowly owned retirement.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import select
import signal
import subprocess

ROOT = Path('/root/sabalan-recovery-private/native-qa/physical-chain-6808d4086c7fe0d25c3198aa647e7180')
QA = ROOT.parent
OPERATION = '6808d4086c7fe0d25c3198aa647e7180'
PID = 851855
START = '119039930'
BOOT = 'ee1b3aa2-d239-4849-b926-200549c77829'
CONTROLLER_SHA = 'bd7088034da450ecf112393e39b6a5ea05277d9d4a838e57a656e9bc0d425460'
CONTAINER = 'b09f6eb7f56cc6dacda95c547e634ba9637c18a95912ee5dffd7b8d93a8d0eec'
VOLUME = 'cb826b03378fc05420bd459b96bdb3f5d56250f977659f954b992b8852265d18'


def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    assert ROOT.stat().st_uid == 0 and not ROOT.stat().st_mode & 0o077
    controller = ROOT / 'replay-physical-chain-v2.fixture.py'
    assert controller.resolve(strict=True) == controller and controller.stat().st_mode & 0o777 == 0o400
    assert digest(controller) == CONTROLLER_SHA
    held = json.loads((ROOT / 'native-replay-state-v2.json').read_text())
    assert held['phase'] == 'OWNERSHIP_HELD_UNPROVEN' and held['step'] == 'private-chain-replay'
    spec = importlib.util.spec_from_file_location('retire_unstarted_native_owner', QA / 'physical-restore-r4.fixture.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    owner.STATUS = ROOT / 'v2-unstarted-retirement-state.json'; assert not owner.STATUS.exists()
    assert digest(QA / 'native-process-owner') == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    foreign = owner.foreign()
    prefix = 'chain-' + OPERATION
    outcomes = sorted(path.name for path in QA.glob(prefix + '-*-outcome.json'))
    assert outcomes == [prefix + '-image-load-outcome.json', prefix + '-verify-create-outcome.json']
    for token in [prefix + '-image-load', prefix + '-verify-create']:
        value = json.loads((QA / (token + '-outcome.json')).read_text())
        receipt = '\nSABALAN_NATIVE_REAPED ' + token + ' 0\n'
        assert value['exitStatus'] == 0 and value['expectedReceipt'] == receipt and value['receiptTail'].endswith(receipt)
        assert digest(QA / (token + '.log')) == value['logSha256']
    ids = owner.output(['docker', 'ps', '-aq', '--filter', 'label=sabalan.drill.operation=' + OPERATION]).decode().split()
    assert ids == [CONTAINER[:12]] or ids == [CONTAINER]
    assert not owner.output(['docker', 'ps', '-aq', '--filter', 'name=^/sabalanerp-backup-drill-postgres-1$']).strip()
    [container] = json.loads(owner.output(['docker', 'inspect', CONTAINER]))
    state = container['State']
    assert container['Id'] == CONTAINER and container['Image'] == 'sha256:9b4593c6de443299b46098151fc1ec154c882339b77a56334c7ce612c8a7be6a'
    assert container['Config']['Labels']['sabalan.drill.operation'] == OPERATION
    assert state['Status'] == 'created' and not state['Running'] and state['Pid'] == 0 and not state['Dead']
    assert state['StartedAt'].startswith('0001-') and state['FinishedAt'].startswith('0001-')
    assert state['ExitCode'] == 0 and not container['ExecIDs'] and not container['NetworkSettings']['SandboxKey']
    assert container['HostConfig']['NetworkMode'] == 'none' and container['HostConfig']['ReadonlyRootfs']
    binds = [row for row in container['Mounts'] if row['Type'] == 'bind']
    assert len(binds) == 3 and all(not row['RW'] and row['Source'].startswith(str(ROOT) + '/') for row in binds)
    volumes = [row for row in container['Mounts'] if row['Type'] == 'volume']
    assert len(volumes) == 1 and volumes[0]['Name'] == VOLUME and volumes[0]['Destination'] == '/var/lib/postgresql/data'
    volume_path = Path('/var/lib/docker/volumes') / VOLUME / '_data'
    assert volumes[0]['Source'] == str(volume_path) and volume_path.resolve(strict=True) == volume_path
    assert volume_path.is_dir() and not list(volume_path.iterdir())
    assert owner.output(['docker', 'ps', '-aq', '--filter', 'volume=' + VOLUME]).decode().split() == [CONTAINER[:12]]
    assert not (ROOT / 'data/recovery.signal').exists() and not (ROOT / 'data/postmaster.pid').exists()
    assert (ROOT / 'data/backup_label').is_file()
    pidfd = os.pidfd_open(PID)
    try:
        proc = Path('/proc') / str(PID)
        assert Path('/proc/sys/kernel/random/boot_id').read_text().strip() == BOOT
        assert (proc / 'stat').read_text().rsplit(') ', 1)[1].split()[19] == START
        assert os.readlink(proc / 'ns/pid') == 'pid:[4026531836]'
        assert str(controller).encode() in (proc / 'cmdline').read_bytes().split(b'\0')
        assert not (proc / 'task' / str(PID) / 'children').read_text().strip()
        named = (QA.parent / 'drill-ownership.lock').stat(); inherited = (proc / 'fd/9').stat()
        assert (named.st_dev, named.st_ino) == (inherited.st_dev, inherited.st_ino)
        info = (proc / 'fdinfo/9').read_text()
        assert 'FLOCK  ADVISORY  WRITE ' + str(PID) + ' ' in info and ':' + str(named.st_ino) + ' 0 EOF' in info
        proof = dict(phase='NO_POSTGRES_EXECUTION_PROVEN', controllerPid=PID, startTicks=START, bootId=BOOT,
                     controllerSha256=CONTROLLER_SHA, nativeDescendantsEmpty=True, nativeToolsReaped=True,
                     containerId=CONTAINER, containerNeverStarted=True, emptyAnonymousVolume=VOLUME,
                     nativeLockIdentity=dict(device=str(named.st_dev), inode=str(named.st_ino)),
                     productionRecoveryPoint=False)
        owner.atomic(ROOT / 'v2-no-execution-proof.json', proof)
        owner.atomic(ROOT / 'v2-unstarted-private-inspection.json', container)
        # A pidfd identifies this exact still-live incarnation. There are no
        # unreaped descendants, SQL work or executed PG process to abandon.
        signal.pidfd_send_signal(pidfd, signal.SIGKILL)
        poll = select.poll(); poll.register(pidfd, select.POLLIN)
        assert poll.poll(10000), 'EXACT_CONTROLLER_EXIT_UNPROVEN'
    finally: os.close(pidfd)
    lock = os.open(QA.parent / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if lock != 9: os.dup2(lock, 9); os.close(lock)
    assert (os.fstat(9).st_dev, os.fstat(9).st_ino) == (named.st_dev, named.st_ino)
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    assert json.loads(owner.output(['docker', 'inspect', CONTAINER]))[0] == container
    owner.state('EXACT_UNSTARTED_VERIFIER_RETIREMENT_INTENT', proof=proof)
    owner.mutate_host(['docker', 'rm', CONTAINER], 60, prefix + '-v2-unstarted-container-retire')
    assert not owner.output(['docker', 'ps', '-aq', '--filter', 'volume=' + VOLUME]).strip()
    assert not list(volume_path.iterdir())
    owner.mutate_host(['docker', 'volume', 'rm', VOLUME], 60, prefix + '-v2-empty-volume-retire')
    assert owner.foreign() == foreign
    result = dict(proof, phase='COMPLETE', controllerExactExitProven=True, originalKernelLockReacquired=True,
                  containerRetiredWithoutForce=True, emptyOwnedVolumeRetiredWithoutForce=True, foreignServicesUnchanged=True)
    owner.atomic(ROOT / 'v2-unstarted-retirement-proof.json', result); owner.state('COMPLETE', proof=result)
    print(json.dumps(result))


if __name__ == '__main__': main()
