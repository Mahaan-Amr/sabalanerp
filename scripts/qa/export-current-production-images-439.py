"""One-use #439 image export. Run only after independent review; no QA import."""
import base64
import ctypes
from dataclasses import dataclass
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
REPOSITORY_ROOT = Path(__file__).resolve().parents[2]


class ExportGuardError(RuntimeError):
    pass


def require(condition, message):
    if not condition:
        raise ExportGuardError(message)


@dataclass(frozen=True)
class ReviewedExport:
    images: dict
    selected: tuple
    destination: Path
    commit: str
    source_reserve: int
    backup_reserve: int
    destination_reserve: int
    maximum_archive_bytes: int
    maximum_total_bytes: int
    plan_sha256: str


def read_reviewed_export_plan(plan_file, expected_sha256):
    require(plan_file.is_absolute() and plan_file.is_file() and not plan_file.is_symlink()
            and plan_file.stat().st_size <= 16384, 'INVALID_EXPORT_PLAN_FILE')
    raw = plan_file.read_bytes()
    require(re.fullmatch(r'[a-f0-9]{64}', expected_sha256)
            and hashlib.sha256(raw).hexdigest() == expected_sha256, 'EXPORT_PLAN_HASH_MISMATCH')
    plan = json.loads(raw)
    require(isinstance(plan, dict) and set(plan) == {
        'format', 'sourceCommit', 'images', 'exportServices', 'destination', 'sourceReserveBytes',
        'backupReserveBytes', 'destinationReserveBytes', 'maximumArchiveBytes', 'maximumTotalBytes',
    }, 'INVALID_EXPORT_PLAN')
    require(plan['format'] == 'sabalan-reviewed-qa-image-export/v1'
            and isinstance(plan['sourceCommit'], str) and re.fullmatch(r'[a-f0-9]{40}', plan['sourceCommit']),
            'INVALID_EXPORT_PLAN_IDENTITY')
    images, selected = plan['images'], plan['exportServices']
    require(isinstance(images, dict) and set(images) == set(IMAGES)
            and all(isinstance(value, str) and re.fullmatch(r'sha256:[a-f0-9]{64}', value)
                    for value in images.values()) and len(set(images.values())) == len(images), 'INVALID_EXPORT_PLAN_IMAGES')
    require(isinstance(selected, list) and selected and all(isinstance(service, str) and service in images
            for service in selected) and len(selected) == len(set(selected)), 'INVALID_EXPORT_PLAN_SELECTION')
    name = plan['destination']
    require(isinstance(name, str) and re.fullmatch(r'sabalanerp-qa-current-images-[a-z0-9-]{8,48}', name),
            'INVALID_EXPORT_DESTINATION')
    for field in ('sourceReserveBytes', 'backupReserveBytes', 'destinationReserveBytes',
                  'maximumArchiveBytes', 'maximumTotalBytes'):
        require(type(plan[field]) is int and 0 < plan[field] < 2**53, 'INVALID_EXPORT_PLAN_CAPACITY')
    require(plan['sourceReserveBytes'] >= SOURCE_RESERVE and plan['backupReserveBytes'] >= BACKUP_RESERVE
            and plan['destinationReserveBytes'] >= D_RESERVE
            and plan['maximumArchiveBytes'] <= plan['maximumTotalBytes'] <= MAX_TOTAL_BYTES, 'INVALID_EXPORT_PLAN_CAPACITY')
    return ReviewedExport(images, tuple(selected), DEST.with_name(name), plan['sourceCommit'],
                          plan['sourceReserveBytes'], plan['backupReserveBytes'], plan['destinationReserveBytes'],
                          plan['maximumArchiveBytes'], plan['maximumTotalBytes'], expected_sha256)

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


def discard_incomplete_stage(stage, destination=None):
    """Free only this invocation's private, unpublished output for a clean rerun."""
    destination = destination or DEST
    require(stage.parent == destination.parent and stage.name.startswith(destination.name + '.staging-'),
            'UNEXPECTED_STAGE_PATH')
    allowed = {'proof.json'} | {service + '.docker.tar' for service in IMAGES}
    allowed |= {service + '.docker.tar.partial' for service in IMAGES}
    for child in stage.iterdir():
        require(child.name in allowed and (child.is_file() or child.is_symlink()), 'UNEXPECTED_STAGE_ENTRY')
        child.unlink()
    stage.rmdir()

# Executed only in the existing production host via `python3 -c`; no source
# file/archive staging. Docker save receives exact immutable IDs, never tags.
READ_ONLY_STORAGE_PLAN = r'''
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dockerStorageAdapter, planStorageCleanup } from './scripts/deployment-storage.mjs';

const [project, lockPath, storageRoot, rootsJson, journalsJson, documentsJson] = process.argv.slice(1);
const assertLock = async () => {
  const file = fs.statSync(lockPath);
  const descriptor = fs.fstatSync(9);
  if (file.dev !== descriptor.dev || file.ino !== descriptor.ino) throw new Error('STORAGE_LOCK_INVALID');
  const stdio = Array(10).fill('ignore');
  stdio[9] = 9;
  execFileSync('flock', ['--nonblock', '9'], { stdio, timeout: 5000 });
};
await assertLock();
const adapter = dockerStorageAdapter({
  project, storageRoot, assertLock, protectedImages: [],
  checkpointRoots: JSON.parse(rootsJson), journalRoots: JSON.parse(journalsJson),
  documents: JSON.parse(documentsJson),
});
const plan = planStorageCleanup(await adapter.snapshot());
console.log(JSON.stringify({ ok: true, plan, availableBytes: await adapter.availableBytes() }));
'''


SOURCE = r'''
import base64, fcntl, hashlib, json, os, subprocess, sys
expected=json.loads(sys.argv[1]); selected=sys.argv[2]
source_reserve=int(sys.argv[3]) if len(sys.argv)>3 else 6461124544
expected_commit=sys.argv[4] if len(sys.argv)>4 else None
read_only_plan=base64.b64decode(sys.argv[5]).decode() if len(sys.argv)>5 else None
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
if expected_commit: require(call(['git','rev-parse','HEAD']).decode().strip()==expected_commit, 'SOURCE_COMMIT_CHANGED')
before=census()
image=json.loads(call(['docker','image','inspect',selected]))[0]
require(image['Id']==selected and image['Os']=='linux' and image['Architecture']=='amd64', 'SOURCE_PLATFORM_MISMATCH')
diff=image['RootFS']['Layers']; require(diff and all(x.startswith('sha256:') for x in diff), 'SOURCE_DIFF_IDS_INVALID')
preflight=['node','deploy/scripts/storage-preflight.mjs','--mode','plan','--project','sabalanerp',
 '--lock-file','.deploy-state/deployment.lock','--lock-fd','9','--storage-root','/var/lib/docker',
 '--required-bytes',str(source_reserve),'--checkpoint-root','/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages',
 '--checkpoint-root','/mnt/sabalanerp-independent-recovery','--journal-root','/opt/sabalanerp/reports/deploy',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/deployment-checkpoint.json',
 '--document','/var/lib/docker/volumes/sabalanerp_recovery_coordination/_data/pending-restore.json',
 '--document','/opt/sabalanerp/reports/deploy/active-deployment-session.json',
 '--audit','/opt/sabalanerp/reports/deploy/storage-cleanup-local.jsonl']
if read_only_plan:
 preflight=['node','--input-type=module','-e',read_only_plan,'sabalanerp','.deploy-state/deployment.lock','/var/lib/docker',
  json.dumps([preflight[preflight.index('--checkpoint-root')+1],'/mnt/sabalanerp-independent-recovery']),
  json.dumps(['/opt/sabalanerp/reports/deploy']),json.dumps([preflight[i+1] for i,arg in enumerate(preflight) if arg=='--document'])]
capacity=json.loads(call(preflight))
require(capacity['ok'] and capacity['availableBytes']>=source_reserve and not capacity['plan']['images'] and not capacity['plan']['containers'], 'SOURCE_CAPACITY_PREFLIGHT_FAILED')
p=subprocess.Popen(['docker','image','save',selected],stdout=sys.stdout.buffer,stderr=subprocess.PIPE)
error=bytearray()
for chunk in iter(lambda: p.stderr.read(8192), b''):
 error.extend(chunk)
 if len(error)>65536: del error[:-65536]
p.wait()
require(p.returncode==0, 'DOCKER_SAVE_FAILED:'+error.decode(errors='replace')[-300:])
sys.stdout.buffer.flush()
after=census(); require(after==before, 'SOURCE_CENSUS_CHANGED')
if expected_commit: require(call(['git','rev-parse','HEAD']).decode().strip()==expected_commit, 'SOURCE_COMMIT_CHANGED')
print('SABALAN439_PROOF='+json.dumps({'selected':selected,'before':before,'after':after,
 'rootfsDiffIds':diff,'capacity':capacity['availableBytes']}),file=sys.stderr,flush=True)
'''


def run(args, timeout):
    return subprocess.run(args, capture_output=True, check=True, timeout=timeout).stdout


def backup_preflight(required_bytes=None):
    reviewed = required_bytes is not None
    required_bytes = BACKUP_RESERVE if required_bytes is None else required_bytes
    cmd = ("exec 9>/run/lock/sabalan-backup-storage.lock; flock -n 9 || exit 75; "
           "node /opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs "
           "--mode plan --project sabalanerp-backup --lock-file /run/lock/sabalan-backup-storage.lock "
           f"--lock-fd 9 --storage-root /srv/sabalanerp-recovery --required-bytes {required_bytes} "
           "--checkpoint-root /srv/sabalanerp-recovery/checkpoints "
           "--audit /var/log/sabalanerp-backup/storage-cleanup.jsonl")
    if reviewed:
        encoded = base64.b64encode(READ_ONLY_STORAGE_PLAN.encode()).decode()
        cmd = ("cd /opt/sabalanerp-recovery || exit 75; exec 9</run/lock/sabalan-backup-storage.lock || exit 75; "
               "flock -n 9 || exit 75; "
               f'node --input-type=module -e "$(printf %s {encoded} | base64 -d)" '
               "sabalanerp-backup /run/lock/sabalan-backup-storage.lock /srv/sabalanerp-recovery "
               "'[\"/srv/sabalanerp-recovery/checkpoints\"]' '[]' '[]'")
    value = json.loads(run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=10',
                            '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3',
                            'sabalan-backup', cmd], timeout=180))
    require(value['ok'] and value['availableBytes'] >= required_bytes, 'BACKUP_CAPACITY_PREFLIGHT_FAILED')
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


def public_inquiry_env_example(entry, expanded):
    """Match only the tracked, public Inquiry sample; never accept arbitrary env files."""
    if entry.name.removeprefix('./') != 'app/.env.example' or not entry.isfile() or entry.size != 160:
        return False
    return hashlib.sha256(expanded.extractfile(entry).read()).hexdigest() == \
        '7559e1a51bd57102d70c79faddc066576518c8ef8f8db0f14a448cc1427a8bf2'


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
                    if secret_path(name) and not (public_ca_certificate_symlink(entry) or
                                                  empty_ssh_directory_entry(entry) or
                                                  public_inquiry_env_example(entry, expanded)):
                        if len(blocked_paths) < 20:
                            blocked_paths.append({'path': name, 'type': entry.type.decode('ascii', errors='replace'),
                                                  'target': entry.linkname if entry.issym() else None})
        require(not blocked_paths, 'EMBEDDED_SECRET_PATH:' + json.dumps(blocked_paths))
    return proof


def stream_one(stage, service, image, previous_bytes, plan=None):
    images = plan.images if plan else IMAGES
    destination = plan.destination if plan else DEST
    source_reserve = plan.source_reserve if plan else SOURCE_RESERVE
    destination_reserve = plan.destination_reserve if plan else D_RESERVE
    maximum_archive = plan.maximum_archive_bytes if plan else MAX_ARCHIVE_BYTES
    maximum_total = plan.maximum_total_bytes if plan else MAX_TOTAL_BYTES
    require_efs(stage)
    encoded = base64.b64encode(SOURCE.encode()).decode()
    remote = "python3 -c 'import base64;exec(base64.b64decode(\"" + encoded + "\"))' '" + json.dumps(images, separators=(',', ':')) + "' '" + image + "'"
    if plan:
        read_only_plan = base64.b64encode(READ_ONLY_STORAGE_PLAN.encode()).decode()
        remote += f' {source_reserve} {plan.commit} {read_only_plan}'
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
                require(size + len(chunk) <= maximum_archive, 'ARCHIVE_SIZE_LIMIT_EXCEEDED')
                require(previous_bytes + size + len(chunk) <= maximum_total, 'EXPORT_TOTAL_SIZE_LIMIT_EXCEEDED')
                require(shutil.disk_usage(stage).free >= destination_reserve + len(chunk), 'DESTINATION_FREE_SPACE_EXHAUSTED')
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
        require(process.returncode == 0, 'SOURCE_EXPORT_FAILED')
        markers = [line[17:] for line in stderr.splitlines() if line.startswith('SABALAN439_PROOF=')]
        require(len(markers) == 1, 'SOURCE_PROOF_MISSING')
        source = json.loads(markers[0])
        require(source['selected'] == image and source['before'] == source['after'], 'SOURCE_CENSUS_CHANGED')
        require(len(source['before']) == 6 and source['capacity'] >= source_reserve, 'SOURCE_CAPACITY_OR_CENSUS_INVALID')
        require(size > 1024 and full_hash(partial) == digest.hexdigest(), 'DESTINATION_READBACK_MISMATCH')
        proof = oci_proof(partial, image)
        require(proof['rootfsDiffIds'] == source['rootfsDiffIds'], 'ROOTFS_SOURCE_PROOF_MISMATCH')
        durable_rename(partial, final)
        require_efs(final)
        return {'service':service,'image':image,'bytes':size,'sha256':digest.hexdigest(),
                'source':source,'oci':proof,'file':str(destination / final.name)}
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
    args = sys.argv[1:]
    plan = None
    if len(args) == 3 and args[0] == '--execute-reviewed-plan':
        plan = read_reviewed_export_plan(Path(args[1]), args[2])
    else:
        require(args == ['--execute-after-review'], 'REVIEW_REQUIRED')
    require(os.name == 'nt' and Path.cwd().samefile(REPOSITORY_ROOT), 'WRONG_HOST_OR_DIRECTORY')
    destination = plan.destination if plan else DEST
    images = plan.images if plan else IMAGES
    selected = plan.selected if plan else tuple(images)
    envelope = (plan.destination_reserve + plan.maximum_total_bytes) if plan else D_ENVELOPE
    require(not destination.exists(), 'DESTINATION_ALREADY_EXISTS')
    require(shutil.disk_usage(destination.parent).free >= envelope, 'DESTINATION_CAPACITY_PREFLIGHT_FAILED')
    stage = destination.with_name(destination.name + '.staging-' + uuid.uuid4().hex)
    try:
        private_destination(stage)
        require_efs(stage)
        backup = backup_preflight(plan.backup_reserve) if plan else backup_preflight()
        results = []
        for service in selected:
            previous_bytes = sum(row['bytes'] for row in results)
            result = (stream_one(stage, service, images[service], previous_bytes, plan) if plan
                      else stream_one(stage, service, images[service], previous_bytes))
            results.append(result)
        require(len(results) == len(selected), 'INCOMPLETE_IMAGE_SET')
        require(all(row['source']['before'] == results[0]['source']['before'] for row in results),
                'SOURCE_CENSUS_CHANGED_BETWEEN_EXPORTS')
        receipt = {'format':'sabalan-439-image-export/v1','productionAdmission':False,
                   'backupPreflightAvailableBytes':backup,'images':results,
                   'secretScan':'Common paths and OCI config/history only; content secret absence is not established.'}
        if plan:
            receipt.update(sourceCommit=plan.commit, reviewedPlanSha256=plan.plan_sha256)
        with (stage / 'proof.json').open('x', encoding='utf-8') as output:
            require_efs(stage / 'proof.json')
            json.dump(receipt, output, indent=2)
            output.flush(); os.fsync(output.fileno())
        require_efs(stage / 'proof.json')
        for service in selected:
            require_efs(stage / (service + '.docker.tar'))
        durable_rename(stage, destination)
        require_efs(destination)
        require_efs(destination / 'proof.json')
        for service in selected:
            require_efs(destination / (service + '.docker.tar'))
    except BaseException:
        if stage.exists():
            try:
                if plan:
                    discard_incomplete_stage(stage, destination)
                else:
                    discard_incomplete_stage(stage)
            except BaseException:
                quarantine = stage.with_name(stage.name.replace('.staging-', '.failed-'))
                durable_rename(stage, quarantine)
        raise
    print(json.dumps({'directory':str(destination),'images':[
        {key: value for key, value in row.items() if key in ('service','image','bytes','sha256')} for row in results]}))


if __name__ == '__main__':
    main()
