"""Read-only acceptance of the frozen, explicitly blocked package and plan."""
import hashlib
import json
import pathlib
import subprocess
import tarfile


def sha_file(file):
    value = hashlib.sha256()
    with pathlib.Path(file).open('rb') as stream:
        while raw := stream.read(1024*1024):
            value.update(raw)
    return value.hexdigest()


def verify(plan, repository):
    assert plan['format'] == 'sabalan-frozen-inert-install-plan/v1'
    assert plan['executable'] is False and plan['productionAdmission'] is False and plan['finalPackagingReady'] is False
    pending = {row['code'] for row in plan['pending']}
    assert 'SOURCE_A_412_NATIVE_ACCEPTANCE_PENDING' in pending
    assert 'CURRENT_BACKEND_COMPILE_FAILED' in pending
    git = lambda *args: subprocess.check_output(['git', '-C', str(repository), *args]).decode().strip()
    assert git('rev-parse', plan['sourceCommit']+'^{tree}') == plan['sourceTree']
    for entry in plan['acceptedInputs']:
        subprocess.run(['git', '-C', str(repository), 'merge-base', '--is-ancestor', entry['evidenceCommit'], plan['sourceCommit']], check=True)
    raw_tree = subprocess.check_output(['git', '-C', str(repository), 'ls-tree', '-rz', '--full-tree', plan['sourceCommit']])
    actual_tree = {}
    for row in raw_tree.split(b'\0'):
        if row:
            header, name = row.split(b'\t', 1)
            mode, kind, oid = header.decode().split()
            if kind == 'blob':
                actual_tree[name.decode()] = dict(gitBlob=oid, gitMode=mode)
    assert actual_tree == plan['committedSourceFiles'], 'SOURCE_GIT_MAP_CHANGED'
    for key in ['sourceArchive', 'sourceBundle', 'operationsArchive', 'hostPackReceipt']:
        ref = plan[key]
        assert pathlib.Path(ref['file']).stat().st_size == ref['bytes']
        assert sha_file(ref['file']) == ref['sha256']
    assert git('bundle', 'list-heads', plan['sourceBundle']['file']) == plan['sourceCommit']+' HEAD'
    source_names = set()
    with tarfile.open(plan['sourceArchive']['file']) as source:
        assert source.pax_headers.get('comment') == plan['sourceCommit']
        for member in source:
            if member.isdir():
                continue
            assert member.isfile() and member.name in actual_tree and member.name not in source_names
            source_names.add(member.name)
            raw = source.extractfile(member).read()
            expected = actual_tree[member.name]
            assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == expected['gitBlob'], 'SOURCE_ARCHIVE_BLOB_CHANGED'
            assert member.mode == (0o775 if expected['gitMode'] == '100755' else 0o664)
    assert source_names == set(actual_tree), 'SOURCE_ARCHIVE_MAP_INCOMPLETE'
    host = json.loads(pathlib.Path(plan['hostPackReceipt']['file']).read_bytes())
    assert host['packagingComplete'] is True and host['productionAdmission'] is False
    names = set()
    with tarfile.open(plan['operationsArchive']['file'], 'r:gz') as archive:
        for member in archive:
            assert member.isfile() and member.name not in names
            name = member.name
            names.add(name)
            expected = plan['operationsFiles'][name]
            raw = archive.extractfile(member).read()
            assert len(raw) == expected['bytes'] and hashlib.sha256(raw).hexdigest() == expected['sha256']
            assert member.mode == expected['mode']
            if name in host['outputs']:
                assert expected['sha256'] == host['outputs'][name]['sha256']
            elif name != 'host-pack-receipt.json':
                original = plan['committedSourceFiles'][name]
                assert hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest() == original['gitBlob']
    assert names == set(plan['operationsFiles'])
    assert set(host['outputs']).issubset(names)
    ref = plan['backendCompilation']['receipt']
    assert sha_file(ref['file']) == ref['sha256']
    compiler = json.loads(pathlib.Path(ref['file']).read_bytes())
    assert compiler['pass'] is False and compiler['originalChildren']['allOriginalChildrenClosed'] is True
    assert any(row['code'] != 0 for row in compiler['commands'])
    assert plan['backendCompilation']['pass'] is False
    return dict(operationsFiles=len(names), hostOutputs=len(host['outputs']), sourceCommit=plan['sourceCommit'],
                executable=False, productionAdmission=False)


if __name__ == '__main__':
    import copy
    import sys
    plan_file = pathlib.Path(sys.argv[1])
    expected = sys.argv[2]
    assert sha_file(plan_file) == expected
    plan = json.loads(plan_file.read_bytes())
    root = pathlib.Path(__file__).resolve().parents[3]
    result = verify(plan, root)
    mutations = [lambda p: p.update(executable=True),
                 lambda p: p.update(sourceCommit=p['sourceBundle']['prerequisiteCommits'][0]),
                 lambda p: p['operationsArchive'].update(sha256='0'*64),
                 lambda p: p['operationsFiles'].pop(next(iter(p['operationsFiles']))),
                 lambda p: p.update(pending=[x for x in p['pending'] if x['code'] != 'SOURCE_A_412_NATIVE_ACCEPTANCE_PENDING']),
                 lambda p: p['backendCompilation'].update({'pass': True})]
    for mutate in mutations:
        value = copy.deepcopy(plan)
        mutate(value)
        try:
            verify(value, root)
        except (AssertionError, KeyError):
            continue
        raise AssertionError('INVALID_PLAN_ACCEPTED')
    # A stale archive must refuse even if only a host-overlaid source changed
    # and the caller recomputes its ordinary file checksum.
    import tempfile
    with tempfile.TemporaryDirectory(prefix='sabalan-package-mutant-') as temp:
        changed_tar = pathlib.Path(temp)/'source.tar'
        replaced = False
        with tarfile.open(plan['sourceArchive']['file']) as source, tarfile.open(changed_tar, 'w', format=tarfile.PAX_FORMAT,
                pax_headers={'comment': plan['sourceCommit']}) as changed:
            for member in source:
                raw = source.extractfile(member).read() if member.isfile() else None
                if member.name == 'deploy/scripts/online-owner-install-guard.mjs':
                    raw += b'\n// substituted source\n'
                    member.size = len(raw)
                    replaced = True
                import io
                changed.addfile(member, io.BytesIO(raw) if raw is not None else None)
        assert replaced
        value = copy.deepcopy(plan)
        value['sourceArchive'] = dict(file=str(changed_tar), bytes=changed_tar.stat().st_size, sha256=sha_file(changed_tar))
        try:
            verify(value, root)
        except AssertionError as error:
            assert 'SOURCE_ARCHIVE_BLOB_CHANGED' in str(error)
        else:
            raise AssertionError('SWAPPED_OVERLAY_SOURCE_ACCEPTED')
    held = [pathlib.Path(plan[x]['file']) for x in ['sourceArchive', 'sourceBundle', 'operationsArchive']]
    held.append(plan_file.parent/'install-plan.json')
    before = {str(file): sha_file(file) for file in held}
    rerun = subprocess.run([sys.executable, '-I', '-B', str(pathlib.Path(__file__).with_name('package-frozen-source.py'))],
                           stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    assert rerun.returncode != 0 and b'PACKAGE_OUTPUT_ALREADY_EXISTS' in rerun.stderr
    assert before == {str(file): sha_file(file) for file in held}, 'SUCCESSFUL_OUTPUT_CHANGED_ON_RERUN'
    print(json.dumps(dict(result, positiveChecks=1, rejectedMutants=len(mutations)+1, rerunPreservedArtifacts=len(held))))
