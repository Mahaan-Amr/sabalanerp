"""Resume only the proved-dead, never-executed diagnostic's exact cleanup.

The first cleanup stopped on Docker's unstable Mounts order after exact pidfd
exit and before Docker mutations. No old PID is signalled or journal reset.
"""
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import stat

ROOT = Path('/root/sabalan-recovery-private/native-qa/physical-chain-6808d4086c7fe0d25c3198aa647e7180')
QA = ROOT.parent
OPERATION = '6808d4086c7fe0d25c3198aa647e7180'
CONTAINER = 'b09f6eb7f56cc6dacda95c547e634ba9637c18a95912ee5dffd7b8d93a8d0eec'
VOLUME = 'cb826b03378fc05420bd459b96bdb3f5d56250f977659f954b992b8852265d18'


def stable_inspection(value):
    result = json.loads(json.dumps(value))
    result['Mounts'] = sorted(result['Mounts'], key=lambda row: row['Destination'])
    return result


def read(file):
    assert file.resolve(strict=True) == file
    value = file.lstat()
    assert stat.S_ISREG(value.st_mode) and value.st_uid == 0 and value.st_nlink == 1 and not value.st_mode & 0o077
    assert 0 < value.st_size < 1024 ** 2
    return json.loads(file.read_bytes())


def main():
    assert os.getuid() == 0 and ROOT.resolve(strict=True) == ROOT
    assert ROOT.stat().st_uid == 0 and not ROOT.stat().st_mode & 0o077
    proof = read(ROOT / 'v2-no-execution-proof.json')
    assert proof == dict(phase='NO_POSTGRES_EXECUTION_PROVEN', controllerPid=851855, startTicks='119039930',
      bootId='ee1b3aa2-d239-4849-b926-200549c77829',
      controllerSha256='bd7088034da450ecf112393e39b6a5ea05277d9d4a838e57a656e9bc0d425460',
      nativeDescendantsEmpty=True, nativeToolsReaped=True, containerId=CONTAINER, containerNeverStarted=True,
      emptyAnonymousVolume=VOLUME, nativeLockIdentity=dict(device='64513', inode='13050'), productionRecoveryPoint=False)
    lock = os.open(QA.parent / 'drill-ownership.lock', os.O_RDWR | os.O_NOFOLLOW)
    if lock != 9: os.dup2(lock, 9); os.close(lock)
    assert dict(device=str(os.fstat(9).st_dev), inode=str(os.fstat(9).st_ino)) == proof['nativeLockIdentity']
    fcntl.flock(9, fcntl.LOCK_EX | fcntl.LOCK_NB)
    storage = os.open('/run/lock/sabalan-backup-storage.lock', os.O_RDWR | os.O_NOFOLLOW)
    fcntl.flock(storage, fcntl.LOCK_EX | fcntl.LOCK_NB)
    assert Path('/proc/sys/kernel/random/boot_id').read_text().strip() == proof['bootId']
    process = Path('/proc') / str(proof['controllerPid'])
    assert not process.exists(), 'ORIGINAL_CONTROLLER_EXIT_UNPROVEN'
    assert read(ROOT / 'native-replay-state-v2.json')['phase'] == 'OWNERSHIP_HELD_UNPROVEN'
    source = ROOT / 'retire-unstarted-chain-verifier.fixture.py'
    assert hashlib.sha256(source.read_bytes()).hexdigest() == '4104949dad93af65d81416584f9df71e2c37e013ecca581fcce811095fe2b211'
    spec = importlib.util.spec_from_file_location('resume_unstarted_native_owner', QA / 'physical-restore-r4.fixture.py')
    owner = importlib.util.module_from_spec(spec); spec.loader.exec_module(owner)
    owner.STATUS = ROOT / 'v2-unstarted-retirement-resume-state.json'; assert not owner.STATUS.exists()
    assert hashlib.sha256((QA / 'native-process-owner').read_bytes()).hexdigest() == '2c04343fd5befe7e4085811e73b4e441ac5a67c1b11614b5f8540c54efa933b2'
    for number in [signal.SIGTERM, signal.SIGINT, signal.SIGHUP]: signal.signal(number, owner.defer_cancellation)
    foreign = owner.foreign(); prefix = 'chain-' + OPERATION
    assert sorted(p.name for p in QA.glob(prefix + '-*-outcome.json')) == [prefix + '-image-load-outcome.json', prefix + '-verify-create-outcome.json']
    for token in [prefix + '-image-load', prefix + '-verify-create']:
        outcome = read(QA / (token + '-outcome.json')); receipt = '\nSABALAN_NATIVE_REAPED ' + token + ' 0\n'
        assert outcome['exitStatus'] == 0 and outcome['expectedReceipt'] == receipt and outcome['receiptTail'].endswith(receipt)
        assert hashlib.sha256((QA / (token + '.log')).read_bytes()).hexdigest() == outcome['logSha256']
    previous = read(ROOT / 'v2-unstarted-private-inspection.json')
    [current] = json.loads(owner.output(['docker', 'inspect', CONTAINER]))
    assert stable_inspection(current) == stable_inspection(previous)
    # Real captured-record regression: array order is irrelevant; every mount
    # value and all other inspection fields remain strict safety evidence.
    reordered = json.loads(json.dumps(current)); reordered['Mounts'].reverse()
    assert stable_inspection(reordered) == stable_inspection(current)
    changed = json.loads(json.dumps(current)); changed['Mounts'][0]['RW'] = not changed['Mounts'][0]['RW']
    assert stable_inspection(changed) != stable_inspection(current)
    assert current['Id'] == CONTAINER and current['Config']['Labels']['sabalan.drill.operation'] == OPERATION
    state = current['State']
    assert state['Status'] == 'created' and not state['Running'] and state['Pid'] == 0 and not state['Dead']
    assert state['StartedAt'].startswith('0001-') and state['FinishedAt'].startswith('0001-') and not current['ExecIDs']
    assert not owner.output(['docker', 'ps', '-aq', '--filter', 'name=^/sabalanerp-backup-drill-postgres-1$']).strip()
    assert owner.output(['docker', 'ps', '-aq', '--filter', 'label=sabalan.drill.operation=' + OPERATION]).decode().split() == [CONTAINER[:12]]
    assert owner.output(['docker', 'ps', '-aq', '--filter', 'volume=' + VOLUME]).decode().split() == [CONTAINER[:12]]
    volume = Path('/var/lib/docker/volumes') / VOLUME / '_data'
    assert volume.resolve(strict=True) == volume and volume.is_dir() and not list(volume.iterdir())
    assert not (ROOT / 'data/recovery.signal').exists() and not (ROOT / 'data/postmaster.pid').exists()
    assert not (ROOT / 'v2-unstarted-retirement-proof.json').exists()
    owner.state('EXACT_UNSTARTED_VERIFIER_RETIREMENT_INTENT', proof=proof)
    owner.mutate_host(['docker', 'rm', CONTAINER], 60, prefix + '-v2-unstarted-container-retire')
    assert not owner.output(['docker', 'ps', '-aq', '--filter', 'volume=' + VOLUME]).strip()
    assert not list(volume.iterdir())
    owner.mutate_host(['docker', 'volume', 'rm', VOLUME], 60, prefix + '-v2-empty-volume-retire')
    assert owner.foreign() == foreign
    result = dict(proof, phase='COMPLETE', controllerExactExitProven=True, originalKernelLockReacquired=True,
                  containerRetiredWithoutForce=True, emptyOwnedVolumeRetiredWithoutForce=True, foreignServicesUnchanged=True,
                  mountOrderRegressionPassed=True, changedMountPermissionsRejected=True)
    owner.atomic(ROOT / 'v2-unstarted-retirement-proof.json', result); owner.state('COMPLETE', proof=result)
    print(json.dumps(result))


if __name__ == '__main__': main()
