"""File-only packaging of the exact accepted source and approved host outputs.

Produces inert artifacts, never image builds, installation or runtime authority.
The receipt deliberately retains pending acceptance and producer failures.
"""
import gzip
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

ROOT = pathlib.Path(__file__).resolve().parents[3]
SOURCE = 'c54445cb7e4c75369dd47b03cbfb33f1dadbb029'
BASE = 'ae056d6036c62499171f0d91691e1287942e75f7'
OUTPUT = pathlib.Path(json.loads((ROOT/'.scratch/final-package-location.json').read_bytes())['directory'])
HOST = pathlib.Path('D:/sabalanerp-online-qa/ticket413-final-host-pack-c54445cb-20261025')
CHILDREN = []


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def canonical(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)+'\n').encode()


def reference(file):
    raw = file.read_bytes()
    return dict(file=str(file), bytes=len(raw), sha256=sha(raw))


def run(root, *args):
    child = subprocess.Popen(['git', '-C', str(root), *args], stdin=subprocess.DEVNULL,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = child.communicate()
    CHILDREN.append(dict(pid=child.pid, argv=list(args), code=child.returncode,
                         stdoutEof=True, stderrEof=True, stdoutSha256=sha(out), stderrSha256=sha(err)))
    assert child.returncode == 0, ('ORIGINAL_GIT_FAILED', args, err[:300])
    return out


def safe(name):
    p = pathlib.PurePosixPath(name)
    assert name and not p.is_absolute() and p.as_posix() == name and '\\' not in name
    assert '..' not in p.parts and '.' not in p.parts
    assert not any(x == '.git' for x in p.parts)
    assert p.name != '.env' and not (p.name.startswith('.env.') and not p.name.endswith(('.example', '.template')))
    assert not p.name.endswith(('.key', '.p12', '.pfx'))
    return name


def tree_entries():
    raw = run(ROOT, 'ls-tree', '-rz', '--full-tree', SOURCE)
    files, gitlinks = {}, {}
    for entry in raw.split(b'\0'):
        if not entry:
            continue
        header, name = entry.split(b'\t', 1)
        mode, kind, oid = header.decode().split()
        name = safe(name.decode())
        if kind == 'commit':
            assert mode == '160000'
            gitlinks[name] = oid
        else:
            assert kind == 'blob' and mode in ('100644', '100755')
            files[name] = dict(gitBlob=oid, gitMode=mode)
    return files, gitlinks


def build():
    # Check every immutable destination before producing even the first output.
    for name in ['integrated-source.bundle', 'frozen-operations.tar.gz', 'install-plan.json']:
        assert not (OUTPUT/name).exists(), 'PACKAGE_OUTPUT_ALREADY_EXISTS:'+name
    assert run(ROOT, 'rev-parse', 'HEAD').decode().strip() == SOURCE
    assert not run(ROOT, 'diff', '--name-only').strip() and not run(ROOT, 'diff', '--cached', '--name-only').strip()
    source_tree = run(ROOT, 'rev-parse', SOURCE+'^{tree}').decode().strip()
    inputs = json.loads((ROOT/'.scratch/final-input-verification.json').read_bytes())
    for value in inputs['inputs']:
        run(ROOT, 'merge-base', '--is-ancestor', value['evidenceCommit'], SOURCE)
    files, gitlinks = tree_entries()
    source_tar = OUTPUT/'integrated-source.git.tar'
    if not source_tar.exists():
        run(ROOT, '-c', 'tar.umask=0002', 'archive', '--format=tar', '--output', str(source_tar), SOURCE)
    # A successful source component from an interrupted preparation can be
    # reused only after ALL original entries have been bound to the Git tree.
    verified_source = set()
    with tarfile.open(source_tar) as original:
        assert original.pax_headers.get('comment') == SOURCE
        for member in original:
            name = safe(member.name.rstrip('/'))
            if member.isdir():
                continue
            assert member.isfile() and name in files and name not in verified_source
            raw = original.extractfile(member).read()
            assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == files[name]['gitBlob']
            assert member.mode == (0o775 if files[name]['gitMode'] == '100755' else 0o664)
            verified_source.add(name)
    assert verified_source == set(files), 'SOURCE_ARCHIVE_MAP_INCOMPLETE'
    source_bundle = OUTPUT/'integrated-source.bundle'
    run(ROOT, 'bundle', 'create', str(source_bundle), 'HEAD', '^'+BASE)
    run(ROOT, 'bundle', 'verify', str(source_bundle))
    pack_file = HOST/'host-pack-receipt.json'
    host = json.loads(pack_file.read_bytes())
    assert host['packagingComplete'] is True and host['productionAdmission'] is False
    actual = {p.relative_to(HOST).as_posix() for p in HOST.rglob('*') if p.is_file()}
    assert actual == set(host['outputs']) | {'host-pack-receipt.json'}
    overlay = {}
    for name, pin in host['outputs'].items():
        safe(name)
        raw = (HOST/name).read_bytes()
        assert len(raw) == pin['bytes'] and sha(raw) == pin['sha256']
        overlay[name] = raw
    overlay['host-pack-receipt.json'] = pack_file.read_bytes()
    archive = OUTPUT/'frozen-operations.tar.gz'
    manifest = {}
    with archive.open('xb') as target, gzip.GzipFile(fileobj=target, mode='wb', filename='', mtime=0) as gz, \
            tarfile.open(fileobj=gz, mode='w|', format=tarfile.PAX_FORMAT) as result, tarfile.open(source_tar) as source:
        seen = set()
        for member in source:
            name = safe(member.name.rstrip('/'))
            if member.isdir():
                continue
            assert member.isfile() and name in files and name not in seen
            seen.add(name)
            original_raw = source.extractfile(member).read()
            assert hashlib.sha1(b'blob '+str(len(original_raw)).encode()+b'\0'+original_raw).hexdigest() == files[name]['gitBlob']
            assert member.mode == (0o775 if files[name]['gitMode'] == '100755' else 0o664)
            if name in overlay:
                raw = overlay.pop(name)
                origin = 'APPROVED_HOST_PACK_OVERLAY'
            else:
                raw = original_raw
                origin = 'COMMITTED_SOURCE'
                assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == files[name]['gitBlob']
            mode = 0o500 if name == 'deploy/scripts/native-process-owner' else 0o400
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(raw), mode, 0
            item.uid = item.gid = 0
            result.addfile(item, io.BytesIO(raw))
            manifest[name] = dict(bytes=len(raw), sha256=sha(raw), mode=mode, provenance=origin)
        assert seen == set(files), 'TRACKED_SOURCE_MAP_INCOMPLETE'
        for name, raw in sorted(overlay.items()):
            assert name not in manifest
            mode = 0o500 if name == 'deploy/scripts/native-process-owner' else 0o400
            item = tarfile.TarInfo(name)
            item.size, item.mode, item.mtime = len(raw), mode, 0
            item.uid = item.gid = 0
            result.addfile(item, io.BytesIO(raw))
            manifest[name] = dict(bytes=len(raw), sha256=sha(raw), mode=mode, provenance='APPROVED_HOST_PACK_OUTPUT')
    frontend_pending = json.loads((ROOT/'reports/qa/source-a-components-412/frontend-pending-native.json').read_bytes())
    inquiry_plan = json.loads((ROOT/'reports/qa/source-a-components-412/inquiry-publication-plan.json').read_bytes())
    for value in [frontend_pending['encryptionComponent'], *inquiry_plan['closedPhaseReferences'].values()]:
        assert sha(pathlib.Path(value['file']).read_bytes()) == value['sha256']
    impact = json.loads((ROOT/'.scratch/input-impact.json').read_bytes())
    pending = [
        dict(code='SOURCE_A_412_NATIVE_ACCEPTANCE_PENDING', issue=412, missing=frontend_pending['missing']),
        dict(code='CURRENT_BACKEND_IMAGE_AND_ARCHIVE_REQUIRED', reason='Changed accepted backend source must not reuse or relabel the earlier image.'),
        dict(code='FRESH_COMPLETE_RESOURCE_BINDING_REQUIRED', reason='No used transfer, old image, session, database identity or old namespace may be rebound from reports.'),
        dict(code='FRESH_ORIGINAL_INSTALL_OBSERVATION_REQUIRED', reason='Creation-only configuration/protected-files/cron/lease/source observation remains coordinator-owned.'),
        dict(code='BACKEND_TYPECHECK_FAILED', exitCode=2, diagnostics=252),
        dict(code='REMOTE_BUNDLE_PREREQUISITES_UNOBSERVED', prerequisite=BASE),
    ]
    plan = dict(format='sabalan-frozen-inert-install-plan/v1', sourceCommit=SOURCE, sourceTree=source_tree,
                gitlinks=gitlinks, acceptedInputs=inputs['inputs'],
                sourceArchive=reference(source_tar), sourceBundle={**reference(source_bundle), 'prerequisiteCommits': [BASE]},
                operationsArchive=reference(archive), hostPackReceipt=reference(pack_file),
                operationsFiles=manifest, committedSourceFiles=files,
                preservedRecoverySourceA=dict(frontend=frontend_pending, inquiry=inquiry_plan),
                sourceOnly=True, executable=False, finalPackagingReady=False, productionAdmission=False,
                pending=pending, inputImpact=impact, originalGitChildren=CHILDREN)
    with (OUTPUT/'install-plan.json').open('xb') as stream:
        stream.write(canonical(plan))
    return plan


if __name__ == '__main__':
    result = build()
    print(json.dumps(dict(sourceCommit=result['sourceCommit'], sourceTree=result['sourceTree'],
                          operationsFiles=len(result['operationsFiles']), plan=reference(OUTPUT/'install-plan.json'),
                          executable=False, productionAdmission=False)))
