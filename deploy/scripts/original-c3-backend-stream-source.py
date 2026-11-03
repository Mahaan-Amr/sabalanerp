"""File-only C3 backend stream renderer. No entry point or admission authority.

The serving producer is authenticated by the existing current-baseline guards.
It supplies keys and streaming crypto, not the deployment image. Only the fixed
#413 archive is encrypted; accepted frontend/Inquiry crypto is untouched.
"""
import ast
import hashlib
import json
import pathlib
import re
import runpy
import shlex

Q = pathlib.Path('D:/sabalanerp-online-qa')
REVIEW = Q / 'C30-source-a-fixed-existing-gzip-stream-source-r7-typed-component-rsa-projection-20261025'
REVIEW_SHA = 'ad4abcdfc79a7ce2c6a7dd4ca9b40087952d00e498b6390938c315a28a722cc7'
PLAN = Q / 'ticket413-artifact-ready-d4948dcb6fd54d31bf2ce76513030432/install-plan-final.json'
PLAN_SHA = '0b9cba26b9975abbc6893cb988d4571a3b49a8d1c6719215f61aad6c336ec238'
TARGET = 'sha256:380b765fc645cf2597c2fdd537cd67f74692344f2e3c489078ec459be3baa6f9'
PRODUCER = 'sha256:e407ff125c6fb0b441f6fa782101a4ec5159e928a5ebae7ddc32faef869afed3'
CORE = Q / 'C30-source-a-no-workspace-stream-codec-source-r2-close-faults-20261025'
CORE_SHA = '791a38cc41dabd82b4f42c75616fe971e517dbdd334c77f48adbf2703063f6a9'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def pinned(file, digest):
    raw = pathlib.Path(file).read_bytes()
    assert sha(raw) == digest, 'C3_STREAM_SOURCE_PIN_CHANGED'
    return raw


def replace_once(source, old, new):
    assert source.count(old) == 1, 'C3_STREAM_FRAGMENT_CONTRACT_CHANGED'
    return source.replace(old, new)


def captured_sources(directory, digest):
    review = json.loads(pinned(directory / 'source-review.json', digest))
    rows = review['files']
    if isinstance(rows, list):
        rows = {pathlib.Path(row['file']).name: row for row in rows}
    return {name: pinned(row['file'], row['sha256']) for name, row in rows.items()}


def execute_source(raw, file, name):
    scope = dict(__file__=str(file), __name__=name)
    exec(compile(raw, str(file), 'exec'), scope)
    return scope


def preflight_validator_source():
    parent = Q / 'C30-production81-source-preparer-r2-production-only-capacity-20261025'
    captured = captured_sources(parent, '18fa39f5c94fd7710baae9c49f200fa578c4627b3a6b5a3cf3d51c006261acd9')
    text = captured['source-a-preflight.py'].decode()
    return replace_once(text, "ns=runpy.run_path(str(PARENT),run_name='unchanged_full_original_preflight_source')", "ns={'__file__':str(PARENT),'__name__':'unchanged_full_original_preflight_source'};exec(compile(raw,str(PARENT),'exec'),ns)").encode()


def component():
    plan = json.loads(pinned(PLAN, PLAN_SHA))
    assert plan['sourceCommit'] == 'c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14'
    assert plan['artifactContentReadyFor419'] is True and plan['productionAdmission'] is False
    image = plan['backendImage']
    graph = image['archiveGraph']
    assert graph['index'] == TARGET
    assert graph['platform'] == 'sha256:7db189b34a985564876306f31435978ab719dbcbb0befd6f05aebb00bcfae418'
    assert graph['config'] == 'sha256:9114a9a5cd69426f8c9ae2dd74940ec311e222eab87d9e9070768b5722f2acdb'
    assert graph['archiveSha256'] == image['rawArchive']['sha256']
    assert graph['archiveBytes'] == image['rawArchive']['bytes']
    return dict(service='backend', image=TARGET, gzip=image['compressedArchive'],
                raw=image['rawArchive'], archiveGraph=graph, rootfsDiffIds=graph['rootfsDiffIds'],
                historicalContentOnly=True, productionAdmission=False)


def render_guard_artifacts(spec, operation, output, preflight):
    """Pure reviewed guard generation, not execution/admission."""
    assert re.fullmatch('[a-f0-9]{32}', operation)
    backend = [row for row in spec['expectedEight'] if row['service'] == 'backend']
    assert len(backend) == 1 and backend[0]['image'] == PRODUCER
    parent_file = Q / 'C30-production81-source-preparer-r3-observed-backend-restart-20261025/backend_export.py'
    parent_captured = captured_sources(parent_file.parent, 'da6a892f6841d21230894d5a0e43ce7b1a3d6158047743cb532cf69813eb6d86')
    parent_text = pinned(parent_file, '47ddc1e8bafc766f9edb50b8563e0b4653adac312875d157f6ced646806756a4').decode()
    for name, expression in [('backend-export-remote.py', "(HERE/'backend-export-remote.py').read_text(encoding='utf-8-sig')"),
                              ('backend-encrypt.cjs', "(HERE/'backend-encrypt.cjs').read_text()"),
                              ('recipient-only.cjs', "(HERE/'recipient-only.cjs').read_text()")]:
        parent_text = replace_once(parent_text, expression, repr(parent_captured[name].decode('utf-8-sig')))
    parent = execute_source(parent_text.encode(), parent_file, 'c3_stream_guard_dependency')
    return parent['render'](spec, operation, output, preflight)


def render(spec, operation, output, preflight, phase, expected_cipher=None):
    assert re.fullmatch('[a-f0-9]{32}', operation)
    assert phase in ['encrypt-existing', 'local-decrypt']
    if phase == 'encrypt-existing':
        assert expected_cipher is None
    else:
        assert set(expected_cipher) == {'bytes', 'sha256'}
        assert type(expected_cipher['bytes']) is int and 0 < expected_cipher['bytes'] <= 2**31
        assert re.fullmatch('[a-f0-9]{64}', expected_cipher['sha256'])
    captured_sources(CORE, CORE_SHA)
    validator = execute_source(preflight_validator_source(), Q / 'C30-production81-source-preparer-r2-production-only-capacity-20261025/source-a-preflight.py', 'c3_stream_preflight_validator')
    fresh = validator['validate'](preflight)
    artifacts = render_guard_artifacts(spec, operation, output, {'sha256': preflight['sha256'], 'observedAt': fresh['observedAt']})
    return compile_phase(artifacts['remote.py'], operation, phase, expected_cipher)


def compile_phase(raw_remote, operation, phase, expected_cipher):
    """Pure packaging seam; its output is source, never live admission."""
    assert re.fullmatch('[a-f0-9]{32}', operation)
    assert phase in ['encrypt-existing', 'local-decrypt']
    captured = captured_sources(REVIEW, REVIEW_SHA)
    core = captured_sources(CORE, CORE_SHA)
    remote = raw_remote.decode()
    base = remote[:remote.index('def observe(h):')]
    assignments = [n for n in ast.parse(base).body if isinstance(n, ast.Assign)
                   and any(isinstance(t, ast.Name) and t.id == 'IMAGE' for t in n.targets)]
    assert len(assignments) == 1 and ast.literal_eval(assignments[0].value) == PRODUCER
    selected = component()
    functions = captured['remote-phase.py'].decode()
    functions = replace_once(functions, "'canonicalReserveBytes':int(capacity[0]),", "'canonicalReserveBytes':int(capacity[0]),'backupCanonicalReserveBytes':int(capacity[1]),")
    # IMAGE remains the actual serving producer for every host/boundary guard.
    functions = replace_once(functions, "native['image']==IMAGE", "native['image']==COMPONENT['image']")
    functions = replace_once(functions, "'image':IMAGE,'rootfsDiffIds':selected['RootFS']['Layers']", "'image':COMPONENT['image'],'rootfsDiffIds':COMPONENT['rootfsDiffIds'],'producerImage':IMAGE,'producerRootfsDiffIds':selected['RootFS']['Layers']")
    functions = replace_once(functions, "'image':IMAGE,'imageBytes':selected['Size'],'rootfsDiffIds':selected['RootFS']['Layers']", "'image':COMPONENT['image'],'rootfsDiffIds':COMPONENT['rootfsDiffIds'],'producerImage':IMAGE,'producerImageBytes':selected['Size'],'producerRootfsDiffIds':selected['RootFS']['Layers']")
    for name in ['stream-source-stage', 'stream-source-stage-negative', 'stream-native',
                 'closed-stream-phase', 'closed-local-hash-phase', 'closed-stream-phase-negative']:
        functions = functions.replace('sabalan-source-a-' + name + '/v1', 'sabalan-c3-backend-' + name + '/v1')
    pipeline = captured['pipeline.cjs'].decode().replace('sabalan-source-a-', 'sabalan-c3-backend-')
    root = '/root/sabalan-recovery-private/c3-backend-' + phase + '-' + operation
    constants = '\n'.join(name + '=' + repr(value) for name, value in [
        ('PHASE', phase), ('COMPONENT', selected), ('REMOTE_ROOT', root),
        ('MAXIMUM_OUTPUT', 2**31), ('EXPECTED_CIPHER', expected_cipher),
        ('SOURCE_WORKSPACE_BOUND', 2*1024**2),
        ('STREAM_CODEC', core['stream-codec.cjs'].decode()),
        ('PIPELINE', pipeline), ('COLLECTOR', captured['stream-native.py'].decode())]) + '\n'
    runtime = base + constants + functions + '\nif __name__=="__main__":sys.exit(stream())\n'
    stage = base + constants + 'RUNTIME=' + repr(runtime) + '\n' + functions + '\nif __name__=="__main__":sys.exit(stage())\n'
    compile(runtime, 'c3-backend-stream-runtime', 'exec')
    compile(stage, 'c3-backend-stream-stage', 'exec')
    assert len(runtime.encode()) + len(pipeline.encode()) + len(core['stream-codec.cjs']) < 2*1024**2
    command = 'python3 -I -B -c ' + shlex.quote("import hashlib,os,stat;p=" + repr(root+'/runtime.py') + ";s=os.lstat(p);assert stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o077;f=os.open(p,os.O_RDONLY|os.O_NOFOLLOW);r=os.read(f,2097153);assert len(r)<=2097152 and hashlib.sha256(r).hexdigest()==" + repr(sha(runtime.encode())) + ";os.close(f);exec(compile(r,p,'exec'),{'__name__':'__main__'})")
    assert len(command) < 32700
    return dict(stageSource=stage.encode(), runtimeSource=runtime.encode(), remoteCommand=command,
                phase=phase, operation=operation, root=root,
                runtimeSourceSha256=sha(runtime.encode()),
                component=selected, producerImage=PRODUCER, productionAdmission=False)


def render_capacity(spec, operation, output, preflight):
    """Fresh canonical measurement under the existing production FD9 only."""
    material = render(spec, operation, output, preflight, 'encrypt-existing')
    runtime = material['runtimeSource'].decode()
    runtime = replace_once(runtime, '\nif __name__=="__main__":sys.exit(stream())\n', '')
    capacity = '''
def capacity_only():
 h=k['NativeHost'](SPEC,SPEC_SHA);h.baseline=SPEC['expectedEight']
 try:
  h.acquire();boundary(h);node=current_node();selected,secret,capacity=parent_guard(h)
  boundary(h);assert current_node()==node
  assert not h.interrupted and all(c['code']==0 and c['pipesClosed'] and c['observationFault'] is None for c in h.children)
  print(json.dumps({'format':'sabalan-c3-image-capacity-original/v1','operation':OPERATION,'runtimeSpecSha256':SPEC_SHA,'capacity':capacity,'producerImage':IMAGE,'children':h.children,'allOriginalChildrenClosed':True,'sourceWorkspaceCreated':False,'privateKeyRead':False,'productionAdmission':False}),flush=True)
  return 0
 finally:h.close()
if __name__=="__main__":sys.exit(capacity_only())
'''
    raw = (runtime + capacity).encode()
    compile(raw, 'c3-image-capacity-readonly-source', 'exec')
    return raw
