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
    assert 'CURRENT_BACKEND_COMPILE_FAILED' not in pending
    assert 'BACKEND_TYPECHECK_FAILED' not in pending
    assert plan['sourceBuildReady'] is True and plan['backendCompilerReady'] is True and plan['backendMaterialReady'] is True
    assert plan['typecheck']['exitCode'] == 0 and plan['typecheck']['diagnostics'] == 0
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
    assert compiler['pass'] is True and compiler['originalChildren']['allOriginalChildrenClosed'] is True
    assert len(compiler['commands']) == 2 and all(row['code'] == 0 and row['naturalChildClosure'] for row in compiler['commands'])
    assert compiler['sourceUnchanged'] is True and not compiler['originalChildren']['interrupted']
    for name, row in compiler['outputs'].items():
        file = pathlib.Path(compiler['root'])/name
        assert file.stat().st_size == row['bytes'] and sha_file(file) == row['sha256']
    material_ref = plan['backendMaterial']
    assert sha_file(material_ref['file']) == material_ref['sha256']
    material = json.loads(pathlib.Path(material_ref['file']).read_bytes())
    assert material['materialized'] and material['sourceUnchanged'] and not material['imageBuilt']
    assert material['compiledReceiptSha256'] == ref['sha256']
    actual = {p.relative_to(material['context']).as_posix() for p in pathlib.Path(material['context']).rglob('*') if p.is_file()}
    assert actual == {row['path'] for row in material['files']}
    for row in material['files']:
        file = pathlib.Path(material['context'])/row['path']
        assert file.stat().st_size == row['bytes'] and sha_file(file) == row['sha256']
    archive_ref = plan['backendMaterialArchive']
    assert sha_file(archive_ref['file']) == archive_ref['sha256'] and archive_ref['image'] is False
    rows = {row['path']: row for row in material['files']}
    seen = set()
    with tarfile.open(archive_ref['file']) as archive:
        for member in archive:
            assert member.isfile() and member.name not in seen and member.mode == 0o400
            raw = archive.extractfile(member).read()
            assert len(raw) == rows[member.name]['bytes'] and hashlib.sha256(raw).hexdigest() == rows[member.name]['sha256']
            seen.add(member.name)
    assert seen == set(rows) and archive_ref['files'] == len(rows)
    assert plan['backendCompilation']['pass'] is True
    return dict(operationsFiles=len(names), hostOutputs=len(host['outputs']), sourceCommit=plan['sourceCommit'],
                executable=False, productionAdmission=False)



if __name__ == '__main__':
    import copy, sys
    file = pathlib.Path(sys.argv[1])
    assert sha_file(file) == sys.argv[2]
    plan = json.loads(file.read_bytes())
    root = pathlib.Path(__file__).resolve().parents[3]
    result = verify(plan, root)
    mutations = [lambda p: p.update(executable=True),
                 lambda p: p.update(sourceCommit=p['sourceBundle']['prerequisiteCommits'][0]),
                 lambda p: p['operationsArchive'].update(sha256='0'*64),
                 lambda p: p['committedSourceFiles'].pop(next(iter(p['committedSourceFiles']))),
                 lambda p: p['backendCompilation'].update({'pass': False}),
                 lambda p: p['backendMaterial'].update(sha256='0'*64),
                 lambda p: p['typecheck'].update(exitCode=2),
                 lambda p: p['backendMaterialArchive'].update(sha256='0'*64)]
    for mutate in mutations:
        candidate = copy.deepcopy(plan); mutate(candidate)
        try: verify(candidate, root)
        except (AssertionError, KeyError, subprocess.CalledProcessError): pass
        else: raise AssertionError('MUTATION_ACCEPTED')
    print(json.dumps(dict(result=result, positive=1, rejectedMutations=len(mutations))))
