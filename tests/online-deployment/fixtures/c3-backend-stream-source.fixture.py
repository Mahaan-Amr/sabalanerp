"""Source-only packaging check; historical data is never live admission."""
import ast
import json
import pathlib
import runpy
import sys

root = pathlib.Path(sys.argv[1])
adapter = runpy.run_path(str(root / 'deploy/scripts/original-c3-backend-stream-source.py'))
q = pathlib.Path('D:/sabalanerp-online-qa')
inputs = json.loads((q / '419-safe-rollback-36b9f5bf09bf2a9fcf2c30644de47ee5/fresh-pre-up-production-inputs.json').read_bytes())
spec = json.loads(pathlib.Path(inputs['runtime']['file']).read_bytes())
parent_file = q / 'C30-production81-source-preparer-r3-observed-backend-restart-20261025/backend_export.py'
adapter['pinned'](parent_file, '47ddc1e8bafc766f9edb50b8563e0b4653adac312875d157f6ced646806756a4')
parent = runpy.run_path(str(parent_file))
operation = 'a' * 32
raw = parent['render'](spec, operation, q / ('source-only-not-created-' + operation),
                       {'sha256': inputs['preflight']['sha256'], 'observedAt': inputs['observedAt']})['remote.py']
core = q / 'C30-source-a-no-workspace-stream-codec-source-r2-close-faults-20261025'
for phase, cipher in [('encrypt-existing', None), ('local-decrypt', {'bytes': 559315264, 'sha256': 'b'*64})]:
    result = adapter['compile_phase'](raw, operation, phase, cipher)
    tree = ast.parse(result['runtimeSource'])
    constants = {t.id: ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                 for t in n.targets if isinstance(t, ast.Name)
                 and t.id in ['IMAGE', 'COMPONENT', 'PHASE', 'EXPECTED_CIPHER']}
    assert constants['IMAGE'] == adapter['PRODUCER']
    assert constants['COMPONENT']['image'] == adapter['TARGET']
    assert constants['PHASE'] == phase and constants['EXPECTED_CIPHER'] == cipher
    functions = {n.name: ast.get_source_segment(result['runtimeSource'].decode(), n)
                 for n in tree.body if isinstance(n, ast.FunctionDef)}
    assert "['docker','image','inspect',IMAGE]" in functions['parent_guard']
    assert "recipient['format']=='sabalan-source-a-recipient-spki/v1'" in functions['parent_guard']
    assert "native['image']==COMPONENT['image']" in functions['stream']
    assert "'producerRootfsDiffIds':selected['RootFS']['Layers']" in functions['stream']
    assert "'rootfsDiffIds':COMPONENT['rootfsDiffIds']" in functions['stream']
    assert 'CANONICAL_CODE_ONLY_WORKSPACE_CAPACITY_REFUSED' in functions['stage']
    assert 'boundary(h)' in functions['stream'] and 'boundary(h)' in functions['stage']
    assert result['productionAdmission'] is False
    assert not (q / ('source-only-not-created-' + operation)).exists()
try:
    adapter['compile_phase'](raw.replace(adapter['PRODUCER'].encode(), adapter['TARGET'].encode()), operation,
                             'encrypt-existing', None)
    raise RuntimeError('wrong producer accepted')
except AssertionError:
    pass
original_read = pathlib.Path.read_bytes
def changed_read(file):
    value = original_read(file)
    return value + b'\n# changed between metadata check and consumption' if file == adapter['REVIEW'] / 'pipeline.cjs' else value
try:
    pathlib.Path.read_bytes = changed_read
    try:
        adapter['compile_phase'](raw, operation, 'encrypt-existing', None)
        raise RuntimeError('changed dependency accepted')
    except AssertionError:
        pass
finally:
    pathlib.Path.read_bytes = original_read
owner_builder = runpy.run_path(str(root / 'deploy/scripts/original-c3-backend-stream-owner.py'))
owned_source = owner_builder['build'](dict(service='backend', component=adapter['component']()), adapter)
owned_tree = ast.parse(owned_source)
assert any(isinstance(n, ast.FunctionDef) and n.name == 'run' for n in owned_tree.body)
assert b'parent_custody.assert_current()' in owned_source
assert b"if __name__=='__main__'" not in owned_source
validator_source = adapter['preflight_validator_source']()
assert b'ns=runpy.run_path' not in validator_source
validator = adapter['execute_source'](validator_source, 'captured-preflight.py', 'packaging_fixture')
try:
    validator['validate'](inputs['preflight'])
    raise RuntimeError('historical preflight unexpectedly admitted')
except AssertionError:
    pass
print(json.dumps({'sourceOnly': True, 'phasesCompiled': 2, 'producerTargetSeparated': True,
                  'wrongProducerRefused': True, 'nativeExecuted': False, 'productionAdmission': False}))
