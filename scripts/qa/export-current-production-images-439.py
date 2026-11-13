"""One-use #439 image export. Run only after independent review; no QA import."""
import base64
import ctypes
import gzip
import hashlib
import json
import os
from pathlib import Path
import posixpath
import re
import shutil
import subprocess
import sys
import tarfile
import threading
import uuid


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
D_RESERVE = 6_461_124_544
MAX_ARCHIVE_BYTES = D_ENVELOPE - D_RESERVE
MAX_TOTAL_BYTES = D_ENVELOPE - D_RESERVE
TRANSFER_TIMEOUT_SECONDS = 3600
STDERR_TAIL_BYTES = 65_536


class ExportGuardError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ExportGuardError(message)


def require_efs(path):
    """Prove NTFS encrypts this path before any image bytes are written."""
    require(os.name == 'nt', 'WINDOWS_EFS_REQUIRED')
    attributes = ctypes.windll.kernel32.GetFileAttributesW
    attributes.argtypes = [ctypes.c_wchar_p]
    attributes.restype = ctypes.c_uint32
    flags = attributes(str(path))
    require(flags != 0xffffffff and flags & 0x4000, 'EFS_REQUIRED')


def durable_rename(source, destination):
    """Publish a flushed file/directory with Windows write-through metadata."""
    require(not destination.exists(), 'DESTINATION_ALREADY_EXISTS')
    if os.name == 'nt':
        move = ctypes.windll.kernel32.MoveFileExW
        move.argtypes = [ctypes.c_wchar_p, ctypes.c_wchar_p, ctypes.c_uint]
        move.restype = ctypes.c_int
        if not move(str(source), str(destination), 0x8):
            raise ctypes.WinError()
    else:
        source.rename(destination)
        handle = os.open(destination.parent, os.O_RDONLY)
        try:
            os.fsync(handle)
        finally:
            os.close(handle)


def discard_incomplete_stage(stage):
    """Free only this invocation's private, unpublished output for a clean rerun."""
    require(stage.parent == DEST.parent and stage.name.startswith(DEST.name + '.staging-'),
            'UNEXPECTED_STAGE_PATH')
    allowed = {'proof.json'} | {service + '.docker.tar' for service in IMAGES}
    allowed |= {service + '.docker.tar.partial' for service in IMAGES}
    for child in stage.iterdir():
        require(child.name in allowed and (child.is_file() or child.is_symlink()), 'UNEXPECTED_STAGE_ENTRY')
        child.unlink()
    stage.rmdir()

# Executed only in the existing production host via `python3 -c`; no source
# file/archive staging. Docker save receives exact immutable IDs, never tags.
SOURCE = r'''
import fcntl, hashlib, json, os, subprocess, sys
expected=json.loads(sys.argv[1]); selected=sys.argv[2]
def require(condition, message):
 if not condition: raise RuntimeError(message)
require(selected in expected.values(), 'UNEXPECTED_IMAGE')
os.chdir('/opt/sabalanerp')
lock=os.open('.deploy-state/deployment.lock', os.O_WRONLY|os.O_NOFOLLOW)
fcntl.flock(lock, fcntl.LOCK_EX|fcntl.LOCK_NB)
os.dup2(lock, 9)
def call(args):
 p=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,pass_fds=(9,))
 return p.stdout
def census():
 ids=call(['docker','ps','-q','--filter','label=com.docker.compose.project=sabalanerp']).decode().split()
 require(len(ids)==6, 'SIX_RUNNING_CONTAINERS_REQUIRED')
 rows=json.loads(call(['docker','inspect',*ids]))
 found={}
 for row in rows:
  labels=row['Config']['Labels']; service=labels.get('com.docker.compose.service')
  require(labels.get('com.docker.compose.project')=='sabalanerp' and service in expected and service not in found, 'SOURCE_SERVICE_IDENTITY_CHANGED')
  require(row['State']['Status']=='running' and row['State']['Health']['Status']=='healthy', 'SOURCE_HEALTH_CHANGED')
  require(row['Image']==expected[service], 'SOURCE_IMAGE_CHANGED')
  found[service]={'container':row['Id'],'image':row['Image'],'startedAt':row['State']['StartedAt']}
 require(set(found)==set(expected), 'SOURCE_SERVICE_SET_CHANGED')
 return found
before=census()
image=json.loads(call(['docker','image','inspect',selected]))[0]
require(image['Id']==selected and image['Os']=='linux' and image['Architecture']=='amd64', 'SOURCE_PLATFORM_MISMATCH')
diff=image['RootFS']['Layers']; require(diff and all(x.startswith('sha256:') for x in diff), 'SOURCE_DIFF_IDS_INVALID')
preflight=['node','deploy/scripts/storage-preflight.mjs','--mode','plan','--project','sabalanerp',
 '--lock-file','.deploy-state/deployment.lock','--lock-fd','9','--storage-root','/var/lib/docker',
 '--required-bytes','6461124544','--checkpoint-root','/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages',
 '--checkpoint-root','/mnt/sabalanerp-independent-recovery','--journal-root','/opt/sabalanerp/reports/deploy',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/deployment-checkpoint.json',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/pending-restore.json',
 '--document','/opt/sabalanerp/reports/deploy/active-deployment-session.json',
 '--audit','/opt/sabalanerp/reports/deploy/storage-cleanup-local.jsonl']
capacity=json.loads(call(preflight))
require(capacity['ok'] and capacity['availableBytes']>=6461124544 and not capacity['plan']['images'] and not capacity['plan']['containers'], 'SOURCE_CAPACITY_PREFLIGHT_FAILED')
p=subprocess.Popen(['docker','image','save',selected],stdout=sys.stdout.buffer,stderr=subprocess.PIPE)
error=bytearray()
for chunk in iter(lambda: p.stderr.read(8192), b''):
 error.extend(chunk)
 if len(error)>65536: del error[:-65536]
p.wait()
require(p.returncode==0, 'DOCKER_SAVE_FAILED:'+error.decode(errors='replace')[-300:])
sys.stdout.buffer.flush()
after=census(); require(after==before, 'SOURCE_CENSUS_CHANGED')
print('SABALAN439_PROOF='+json.dumps({'selected':selected,'before':before,'after':after,
 'rootfsDiffIds':diff,'capacity':capacity['availableBytes']}),file=sys.stderr,flush=True)
'''


def run(args, timeout):
    return subprocess.run(args, capture_output=True, check=True, timeout=timeout).stdout


def backup_preflight():
    cmd = ("exec 9>/run/lock/sabalan-backup-storage.lock; flock -n 9 || exit 75; "
           "node /opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs "
           "--mode plan --project sabalanerp-backup --lock-file /run/lock/sabalan-backup-storage.lock "
           "--lock-fd 9 --storage-root /srv/sabalanerp-recovery --required-bytes 2710526931 "
           "--checkpoint-root /srv/sabalanerp-recovery/checkpoints "
           "--audit /var/log/sabalanerp-backup/storage-cleanup.jsonl")
    value = json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
                            'sabalan-backup', cmd], timeout=180))
    require(value['ok'] and value['availableBytes'] >= BACKUP_RESERVE, 'BACKUP_CAPACITY_PREFLIGHT_FAILED')
    require(not value['plan']['images'] and not value['plan']['containers'], 'BACKUP_PREFLIGHT_PLAN_NOT_EMPTY')
    return value['availableBytes']


def private_destination(path):
    require(not path.exists(), 'DESTINATION_ALREADY_EXISTS')
    path.mkdir(mode=0o700)
    owner = run(['whoami'], timeout=30).decode().strip()
    run(['icacls', str(path), '/inheritance:r', '/grant:r', f'{owner}:(OI)(CI)F',
         '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F'], timeout=30)
    acl = run(['icacls', str(path)], timeout=30).decode(errors='replace')
    require(owner.lower() in acl.lower() and '(F)' in acl and '(I)' not in acl, 'PRIVATE_ACL_NOT_VERIFIED')
    run(['cipher', '/e', '/b', str(path)], timeout=60)
    require_efs(path)
    return acl


def full_hash(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def secret_path(name):
    """Reject common private material by filename; this is a screen, not a secret audit."""
    parts = name.lower().replace('\\', '/').split('/')
    if any(part in {'.ssh', '.aws', '.azure', '.kube', 'secrets', 'credentials'} for part in parts):
        return True
    base = parts[-1]
    return (base.startswith('.env') or base.startswith('id_rsa') or base.startswith('id_ed25519')
            or base in {'credentials', 'service-account.json', 'service_account.json', 'kubeconfig'}
            or base.endswith(('.pem', '.p12', '.pfx', '.key')))


def public_ca_certificate_symlink(entry):
    """Allow only a public OS CA link whose target stays in the CA store."""
    name = entry.name.removeprefix('./')
    if not entry.issym() or name != posixpath.normpath(name):
        return False
    if (name, entry.linkname) in {
            ('etc/ssl/cert.pem', 'certs/ca-certificates.crt'),
            ('etc/ssl1.1/cert.pem', '/etc/ssl/cert.pem')}:
        return True
    if name == 'usr/lib/ssl/cert.pem' and entry.linkname == '/etc/ssl/certs/ca-certificates.crt':
        return True
    if posixpath.dirname(name) != 'etc/ssl/certs' or not name.endswith('.pem'):
        return False
    if '\\' in entry.linkname:
        return False
    if posixpath.isabs(entry.linkname):
        target = posixpath.normpath(entry.linkname)
        return target.startswith('/usr/share/ca-certificates/') and target.endswith('.crt')
    target = posixpath.normpath(posixpath.join(posixpath.dirname(name), entry.linkname))
    return target.startswith('usr/share/ca-certificates/') and target.endswith('.crt')


def empty_ssh_directory_entry(entry):
    """The directory entry carries no key material; descendants remain blocked."""
    return entry.isdir() and entry.name.removeprefix('./') == 'root/.ssh'


def oci_proof(path, image):
    root = Path(__file__).resolve().parents[2]
    code = ("import {inspectPrivateDockerArchive} from './scripts/lib/private-docker-image-archive.mjs';"
            "console.log(JSON.stringify(inspectPrivateDockerArchive(process.argv[1],process.argv[2])));")
    proof = json.loads(run(['node', '--input-type=module', '-e', code, str(path), image], timeout=7200))
    require(proof['index'] == image and proof['archiveSha256'] == full_hash(path), 'OCI_ARCHIVE_PROOF_MISMATCH')
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
        require(proof['rootfsDiffIds'] == config['rootfs']['diff_ids'], 'ROOTFS_CONFIG_MISMATCH')
        secret_name = re.compile(r'(PASSWORD|PASSWD|SECRET|TOKEN|PRIVATE_KEY|API_KEY|CREDENTIAL|DATABASE_URL|CONNECTION_STRING)', re.I)
        require(not any(secret_name.search(item.partition('=')[0]) and item.partition('=')[2]
                        for item in config.get('config', {}).get('Env', [])), 'EMBEDDED_CONFIG_SECRET')
        require(not any('-----BEGIN PRIVATE KEY-----' in row.get('created_by', '')
                        for row in config.get('history', [])), 'EMBEDDED_HISTORY_KEY')
        require(len(manifest['layers']) == len(proof['rootfsDiffIds']), 'ROOTFS_LAYER_COUNT_MISMATCH')
        blocked_paths = []
        for layer, expected in zip(manifest['layers'], proof['rootfsDiffIds']):
            raw = blob(layer['digest'])
            if layer['mediaType'].endswith('+gzip'):
                raw = gzip.GzipFile(fileobj=raw)
            else:
                require(layer['mediaType'].endswith('.tar'), 'UNSUPPORTED_LAYER_COMPRESSION')
            digest = hashlib.sha256()
            for chunk in iter(lambda: raw.read(1024 * 1024), b''):
                digest.update(chunk)
            require('sha256:' + digest.hexdigest() == expected, 'ROOTFS_DIFF_ID_MISMATCH')
            raw = blob(layer['digest'])
            mode = 'r|gz' if layer['mediaType'].endswith('+gzip') else 'r|'
            with tarfile.open(fileobj=raw, mode=mode) as expanded:
                for entry in expanded:
                    name = entry.name.removeprefix('./')
                    if secret_path(name) and not (public_ca_certificate_symlink(entry) or empty_ssh_directory_entry(entry)):
                        if len(blocked_paths) < 20:
                            blocked_paths.append({'path': name, 'type': entry.type.decode('ascii', errors='replace'),
                                                  'target': entry.linkname if entry.issym() else None})
        require(not blocked_paths, 'EMBEDDED_SECRET_PATH:' + json.dumps(blocked_paths))
    return proof


def stream_one(stage, service, image, previous_bytes):
    require_efs(stage)
    encoded = base64.b64encode(SOURCE.encode()).decode()
    remote = "python3 -c 'import base64;exec(base64.b64decode(\"" + encoded + "\"))' '" + json.dumps(IMAGES, separators=(',', ':')) + "' '" + image + "'"
    remote = f'timeout --signal=TERM --kill-after=5s {TRANSFER_TIMEOUT_SECONDS}s ' + remote
    partial = stage / (service + '.docker.tar.partial')
    final = stage / (service + '.docker.tar')
    require(not partial.exists() and not final.exists(), 'ARCHIVE_ALREADY_EXISTS')
    try:
        with partial.open('xb'):
            require_efs(partial)
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    try:
        process = subprocess.Popen(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                                    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
                                    'sabalan-prod', remote], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except BaseException:
        partial.unlink()
        raise
    digest = hashlib.sha256()
    size = 0
    stderr_tail = bytearray()
    timed_out = threading.Event()

    def drain_stderr():
        for chunk in iter(lambda: process.stderr.read(8192), b''):
            stderr_tail.extend(chunk)
            if len(stderr_tail) > STDERR_TAIL_BYTES:
                del stderr_tail[:-STDERR_TAIL_BYTES]

    def expire():
        timed_out.set()
        process.kill()

    stderr_reader = threading.Thread(target=drain_stderr, daemon=True)
    stderr_reader.start()
    timer = threading.Timer(TRANSFER_TIMEOUT_SECONDS + 30, expire)
    timer.start()
    try:
        with partial.open('ab') as output:
            require_efs(partial)
            for chunk in iter(lambda: process.stdout.read(1024 * 1024), b''):
                require(size + len(chunk) <= MAX_ARCHIVE_BYTES, 'ARCHIVE_SIZE_LIMIT_EXCEEDED')
                require(previous_bytes + size + len(chunk) <= MAX_TOTAL_BYTES, 'EXPORT_TOTAL_SIZE_LIMIT_EXCEEDED')
                require(shutil.disk_usage(stage).free >= D_RESERVE + len(chunk), 'DESTINATION_FREE_SPACE_EXHAUSTED')
                output.write(chunk)
                digest.update(chunk)
                size += len(chunk)
            output.flush(); os.fsync(output.fileno())
        require_efs(partial)
        process.wait(timeout=30)
        stderr_reader.join(timeout=10)
        timer.cancel()
        require(not stderr_reader.is_alive(), 'SOURCE_STDERR_NOT_CLOSED')
        require(not timed_out.is_set(), 'SOURCE_EXPORT_TIMED_OUT')
        stderr = stderr_tail.decode(errors='replace')
        require(process.returncode == 0, 'SOURCE_EXPORT_FAILED:' + stderr[-500:])
        markers = [line[17:] for line in stderr.splitlines() if line.startswith('SABALAN439_PROOF=')]
        require(len(markers) == 1, 'SOURCE_PROOF_MISSING')
        source = json.loads(markers[0])
        require(source['selected'] == image and source['before'] == source['after'], 'SOURCE_CENSUS_CHANGED')
        require(len(source['before']) == 6 and source['capacity'] >= SOURCE_RESERVE, 'SOURCE_CAPACITY_OR_CENSUS_INVALID')
        require(size > 1024 and full_hash(partial) == digest.hexdigest(), 'DESTINATION_READBACK_MISMATCH')
        proof = oci_proof(partial, image)
        require(proof['rootfsDiffIds'] == source['rootfsDiffIds'], 'ROOTFS_SOURCE_PROOF_MISMATCH')
        durable_rename(partial, final)
        require_efs(final)
        return {'service':service,'image':image,'bytes':size,'sha256':digest.hexdigest(),
                'source':source,'oci':proof,'file':str(DEST / final.name)}
    except BaseException:
        if process.poll() is None:
            process.kill()
            process.wait(timeout=10)
        if partial.exists():
            partial.unlink()
        raise
    finally:
        timer.cancel()
        process.stdout.close()
        process.stderr.close()


def main():
    require(sys.argv[1:] == ['--execute-after-review'], 'REVIEW_REQUIRED')
    require(os.name == 'nt' and Path.cwd().samefile(Path(__file__).resolve().parents[2]), 'WRONG_HOST_OR_DIRECTORY')
    require(not DEST.exists(), 'DESTINATION_ALREADY_EXISTS')
    require(shutil.disk_usage('D:\\').free >= D_ENVELOPE, 'DESTINATION_CAPACITY_PREFLIGHT_FAILED')
    stage = DEST.with_name(DEST.name + '.staging-' + uuid.uuid4().hex)
    try:
        private_destination(stage)
        require_efs(stage)
        backup = backup_preflight()
        results = []
        for service, image in IMAGES.items():
            results.append(stream_one(stage, service, image, sum(row['bytes'] for row in results)))
        require(len(results) == len(IMAGES), 'INCOMPLETE_IMAGE_SET')
        require(all(row['source']['before'] == results[0]['source']['before'] for row in results),
                'SOURCE_CENSUS_CHANGED_BETWEEN_EXPORTS')
        with (stage / 'proof.json').open('x', encoding='utf-8') as output:
            require_efs(stage / 'proof.json')
            json.dump({'format':'sabalan-439-image-export/v1','productionAdmission':False,
                       'backupPreflightAvailableBytes':backup,'images':results,
                       'secretScan':'Common paths and OCI config/history only; content secret absence is not established.'},
                      output, indent=2)
            output.flush(); os.fsync(output.fileno())
        require_efs(stage / 'proof.json')
        for service in IMAGES:
            require_efs(stage / (service + '.docker.tar'))
        durable_rename(stage, DEST)
        require_efs(DEST)
        require_efs(DEST / 'proof.json')
        for service in IMAGES:
            require_efs(DEST / (service + '.docker.tar'))
    except BaseException:
        if stage.exists():
            try:
                discard_incomplete_stage(stage)
            except BaseException:
                quarantine = stage.with_name(stage.name.replace('.staging-', '.failed-'))
                durable_rename(stage, quarantine)
        raise
    print(json.dumps({'directory':str(DEST),'images':[{k:v for k,v in row.items() if k in ('service','image','bytes','sha256')} for row in results]}))


if __name__ == '__main__':
    main()
