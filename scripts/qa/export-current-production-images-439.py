"""One-use #439 image export. Run only after independent review; no QA import."""
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile


IMAGES = {
    "backend": "sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3",
    "frontend": "sha256:008388c7f0188170b46b7466f534398f91894f12770a96c9af96a4f6cc90e040",
    "inquiry": "sha256:7b029f245af9ad80ca85d92df38996ac268821b62732b9b325901d697295e1b9",
    "postgres": "sha256:5fe8ca7fc662071188c30271cb870d1ce9a6ec4578c934b064697ae77a9241e1",
    "clamav": "sha256:269ade6b36a74a2e188dc26265385a13141276d8acdab80c65f09df3b106f355",
    "nginx": "sha256:65645c7bb6a0661892a8b03b89d0743208a18dd2f3f17a54ef4b76fb8e2f2a10",
}
DEST = Path(r"D:\sabalanerp-439-current-images")
SOURCE_RESERVE = 6_461_124_544
BACKUP_RESERVE = 2_710_526_931
D_ENVELOPE = 69_114_879_958

# Executed only in the existing production host via `python3 -c`; no source
# file/archive staging. Docker save receives exact immutable IDs, never tags.
SOURCE = r'''
import fcntl, hashlib, json, os, subprocess, sys
expected=json.loads(sys.argv[1]); selected=sys.argv[2]
assert selected in expected.values()
os.chdir('/opt/sabalanerp')
lock=os.open('.deploy-state/deployment.lock', os.O_WRONLY|os.O_NOFOLLOW)
fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
os.dup2(lock, 9)
def call(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,pass_fds=(9,))
 return p.stdout
def census():
 ids=call(['docker','ps','-q','--filter','label=com.docker.compose.project=sabalanerp']).decode().split()
 assert len(ids)==6, 'SIX_RUNNING_CONTAINERS_REQUIRED'
 rows=json.loads(call(['docker','inspect',*ids]))
 found={}
 for row in rows:
  labels=row['Config']['Labels']; service=labels.get('com.docker.compose.service')
  assert labels.get('com.docker.compose.project')=='sabalanerp' and service in expected and service not in found
  assert row['State']['Status']=='running' and row['State']['Health']['Status']=='healthy'
  assert row['Image']==expected[service]
  found[service]={'container':row['Id'],'image':row['Image'],'startedAt':row['State']['StartedAt']}
 assert set(found)==set(expected)
 return found
before=census()
image=json.loads(call(['docker','image','inspect',selected]))[0]
assert image['Id']==selected and image['Os']=='linux' and image['Architecture']=='amd64'
diff=image['RootFS']['Layers']; assert diff and all(x.startswith('sha256:') for x in diff)
preflight=['node','deploy/scripts/storage-preflight.mjs','--mode','plan','--project','sabalanerp',
 '--lock-file','.deploy-state/deployment.lock','--lock-fd','9','--storage-root','/var/lib/docker',
 '--required-bytes','6461124544','--checkpoint-root','/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages',
 '--checkpoint-root','/mnt/sabalanerp-independent-recovery','--journal-root','/opt/sabalanerp/reports/deploy',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/deployment-checkpoint.json',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/pending-restore.json',
 '--document','/opt/sabalanerp/reports/deploy/active-deployment-session.json',
 '--audit','/opt/sabalanerp/reports/deploy/storage-cleanup-local.jsonl']
capacity=json.loads(call(preflight))
assert capacity['ok'] and capacity['availableBytes']>=6461124544 and not capacity['plan']['images'] and not capacity['plan']['containers']
p=subprocess.Popen(['docker','image','save',selected],stdout=sys.stdout.buffer,stderr=subprocess.PIPE)
error=p.communicate()[1]
assert p.returncode==0, 'DOCKER_SAVE_FAILED:'+error.decode(errors='replace')[-300:]
sys.stdout.buffer.flush()
after=census(); assert after==before, 'SOURCE_CENSUS_CHANGED'
print('SABALAN439_PROOF='+json.dumps({'selected':selected,'before':before,'after':after,
 'rootfsDiffIds':diff,'capacity':capacity['availableBytes']}),file=sys.stderr,flush=True)
'''


def run(args):
    return subprocess.run(args, capture_output=True, check=True).stdout


def backup_preflight():
    cmd = ("exec 9>/run/lock/sabalan-backup-storage.lock; flock -n 9 || exit 75; "
           "node /opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs "
           "--mode plan --project sabalanerp-backup --lock-file /run/lock/sabalan-backup-storage.lock "
           "--lock-fd 9 --storage-root /srv/sabalanerp-recovery --required-bytes 2710526931 "
           "--checkpoint-root /srv/sabalanerp-recovery/checkpoints "
           "--audit /var/log/sabalanerp-backup/storage-cleanup.jsonl")
    value = json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10', 'sabalan-backup', cmd]))
    assert value['ok'] and value['availableBytes'] >= BACKUP_RESERVE
    assert not value['plan']['images'] and not value['plan']['containers']
    return value['availableBytes']


def private_destination():
    assert not DEST.exists(), 'DESTINATION_ALREADY_EXISTS'
    DEST.mkdir(mode=0o700)
    owner = run(['whoami']).decode().strip()
    run(['icacls', str(DEST), '/inheritance:r', '/grant:r', f'{owner}:(OI)(CI)F',
         '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'])
    acl = run(['icacls', str(DEST)]).decode(errors='replace')
    assert owner.lower() in acl.lower() and '(F)' in acl and '(I)' not in acl
    return acl


def full_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def oci_proof(path, image):
    root = Path(__file__).resolve().parents[2]
    code = ("import {inspectPrivateDockerArchive} from './scripts/lib/private-docker-image-archive.mjs';"
            "console.log(JSON.stringify(inspectPrivateDockerArchive(process.argv[1],process.argv[2])));")
    proof = json.loads(run(['node', '--input-type=module', '-e', code, str(path), image]))
    assert proof['index'] == image and proof['archiveSha256'] == full_hash(path)
    with tarfile.open(path, 'r:') as archive:
        members = {entry.name: entry for entry in archive.getmembers()}
        def blob(digest):
            entry = members['blobs/sha256/' + digest[7:]]
            return archive.extractfile(entry)
        index = json.load(blob(image))
        platform = next(m for m in index['manifests'] if m.get('platform', {}).get('os') == 'linux'
                        and m['platform'].get('architecture') == 'amd64')
        manifest = json.load(blob(platform['digest']))
        config = json.load(blob(manifest['config']['digest']))
        assert proof['rootfsDiffIds'] == config['rootfs']['diff_ids']
        secret_name = re.compile(r'(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|API_KEY)', re.I)
        assert not any(secret_name.search(item.partition('=')[0]) and item.partition('=')[2]
                       for item in config.get('config', {}).get('Env', [])), 'EMBEDDED_CONFIG_SECRET'
        assert not any('-----BEGIN PRIVATE KEY-----' in row.get('created_by', '')
                       for row in config.get('history', [])), 'EMBEDDED_HISTORY_KEY'
        assert len(manifest['layers']) == len(proof['rootfsDiffIds'])
        for layer, expected in zip(manifest['layers'], proof['rootfsDiffIds']):
            raw = blob(layer['digest'])
            if layer['mediaType'].endswith('+gzip'):
                raw = gzip.GzipFile(fileobj=raw)
            else:
                assert layer['mediaType'].endswith('.tar'), 'UNSUPPORTED_LAYER_COMPRESSION'
            digest = hashlib.sha256()
            for chunk in iter(lambda: raw.read(1024 * 1024), b''):
                digest.update(chunk)
            assert 'sha256:' + digest.hexdigest() == expected, 'ROOTFS_DIFF_ID_MISMATCH'
            raw = blob(layer['digest'])
            mode = 'r|gz' if layer['mediaType'].endswith('+gzip') else 'r|'
            with tarfile.open(fileobj=raw, mode=mode) as expanded:
                for entry in expanded:
                    name = entry.name.removeprefix('./')
                    assert not re.search(r'(^|/)(\.env(\.prod)?|id_(rsa|ed25519)|credentials)$|(^|/)\.ssh/|(^|/)\.aws/', name), 'EMBEDDED_SECRET_PATH'
    return proof


def stream_one(service, image):
    encoded = base64.b64encode(SOURCE.encode()).decode()
    remote = "python3 -c 'import base64;exec(base64.b64decode(\"" + encoded + "\"))' '" + json.dumps(IMAGES, separators=(',', ':')) + "' '" + image + "'"
    partial = DEST / (service + '.docker.tar.partial')
    final = DEST / (service + '.docker.tar')
    assert not partial.exists() and not final.exists()
    process = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
                                'sabalan-prod', remote], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    digest = hashlib.sha256()
    size = 0
    try:
        with partial.open('xb') as output:
            for chunk in iter(lambda: process.stdout.read(1024 * 1024), b''):
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            output.flush(); os.fsync(output.fileno())
        stderr = process.communicate()[1].decode(errors='replace')
        assert process.returncode == 0, 'SOURCE_EXPORT_FAILED:' + stderr[-500:]
        markers = [line[17:] for line in stderr.splitlines() if line.startswith('SABALAN439_PROOF=')]
        assert len(markers) == 1, 'SOURCE_PROOF_MISSING'
        source = json.loads(markers[0]); assert source['selected'] == image and source['before'] == source['after']
        assert len(source['before']) == 6 and source['capacity'] >= SOURCE_RESERVE
        assert size > 1024 and full_hash(partial) == digest.hexdigest(), 'DESTINATION_READBACK_MISMATCH'
        proof = oci_proof(partial, image)
        assert proof['rootfsDiffIds'] == source['rootfsDiffIds']
        partial.rename(final)
        return {'service':service,'image':image,'bytes':size,'sha256':digest.hexdigest(),
                'source':source,'oci':proof,'file':str(final)}
    except BaseException:
        process.kill(); process.wait()
        if partial.exists():
            partial.unlink()
        raise


def main():
    assert sys.argv[1:] == ['--execute-after-review'], 'REVIEW_REQUIRED'
    assert os.name == 'nt' and Path.cwd().samefile(Path(__file__).resolve().parents[2])
    assert shutil.disk_usage('D:\\').free >= D_ENVELOPE
    backup = backup_preflight()
    private_destination()
    results = [stream_one(service, image) for service, image in IMAGES.items()]
    assert all(row['source']['before'] == results[0]['source']['before'] for row in results), 'SOURCE_CENSUS_CHANGED_BETWEEN_EXPORTS'
    with (DEST / 'proof.json').open('x', encoding='utf-8') as output:
        json.dump({'format':'sabalan-439-image-export/v1','productionAdmission':False,
                   'backupPreflightAvailableBytes':backup,'images':results}, output, indent=2)
        output.flush(); os.fsync(output.fileno())
    print(json.dumps({'directory':str(DEST),'images':[{k:v for k,v in row.items() if k in ('service','image','bytes','sha256')} for row in results]}))


if __name__ == '__main__':
    main()
