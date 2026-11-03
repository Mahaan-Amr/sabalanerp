"""Materialize changed backend crypto only, inside the genuine image parent.

The caller supplies fresh SAME-Root inputs over its live request/ACK channel;
this module's files and receipts grant no runtime/admission capability.
"""
import hashlib
import json
import pathlib
import re
import runpy

HERE = pathlib.Path(__file__).resolve().parent
Q = pathlib.Path('D:/sabalanerp-online-qa')


def materialize(inputs, operation, phase, parent_custody, source, owner_builder, source_raw, encryption=None):
    parent_custody.assert_current()
    pin = source['pinned']
    assert re.fullmatch('[a-f0-9]{32}', operation)
    assert inputs['format'] == 'sabalan-original-complete-production-inputs/v1'
    assert inputs['beforeLocal'] is False and inputs['productionAdmission'] is False
    assert inputs['originalChildren']['allOriginalChildrenClosed'] is True
    spec = json.loads(pin(inputs['runtime']['file'], inputs['runtime']['sha256']))
    review = json.loads(pin(inputs['producerReview']['file'], inputs['producerReview']['sha256']))
    admission = inputs['admission']
    assert review['files']['current-admission.py']['sha256'] == admission['sha256']
    source['execute_source'](pin(admission['file'], admission['sha256']), admission['file'], 'c3_image_current_admission')['validate_spec'](spec)
    component = source['component']()
    cipher = None
    if phase == 'local-decrypt':
        assert encryption and set(encryption) == {'file', 'sha256'}
        previous = json.loads(pin(encryption['file'], encryption['sha256']))
        assert previous['format'] == 'sabalan-c3-backend-original-closed-stream-phase/v1'
        assert previous['phase'] == 'encrypt-existing' and previous['component'] == component
        assert previous['allOriginalChildrenClosed'] is True and previous['productionAdmission'] is False
        for name in ['stageOriginal', 'binaryOriginal']:
            row = previous[name]
            assert row['code'] == 0 and row['signal'] is None and row['stdoutEof'] and row['stderrEof']
            assert not row['observationFaults'] and not row['localInterrupted']
        remote = previous['remote']
        assert remote['image'] == component['image'] and remote['producerImage'] == source['PRODUCER']
        assert remote['allOriginalChildrenClosed'] is True and remote['productionAdmission'] is False
        cipher = previous['streamOutput']
        assert cipher['bytes'] == remote['native']['result']['cipherBytes']
        assert cipher['sha256'] == remote['native']['result']['cipherSha256']
    else:
        assert phase in ['encrypt-existing','capacity-only'] and encryption is None
    directory = Q / ('419-image-backend-material-' + phase + '-' + operation)
    output = Q / ('419-image-backend-' + phase + '-' + operation)
    assert not directory.exists() and not output.exists()
    if phase=='capacity-only':
        capacity_source=source['render_capacity'](spec,operation,directory,inputs['preflight'])
        material=dict(stageSource=capacity_source,runtimeSource=capacity_source,runtimeSourceSha256=source['sha'](capacity_source),remoteCommand='')
    else:
        material = source['render'](spec, operation, directory, inputs['preflight'], phase,
                                   None if cipher is None else dict(bytes=cipher['bytes'], sha256=cipher['sha256']))
    private_file = Q / 'C30-strict-complete-actual-plan-source-r6-observed-renewal-20261025/prepare.py'
    private = source['execute_source'](pin(private_file, '0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb'), private_file, 'c3_image_private_output')
    captured = source['captured_sources'](source['REVIEW'], source['REVIEW_SHA'])
    original = source['execute_source'](captured['build-original.py'], source['REVIEW'] / 'build-original.py', 'c3_image_original_collector')['build']()
    validator = captured['validate-gzip.cjs'].decode()
    validator = source['replace_once'](validator, 'const COMPONENT=null;', 'const COMPONENT=' + json.dumps(component, sort_keys=True) + ';')
    validator = source['replace_once'](validator, "['frontend','inquiry'].includes(COMPONENT.service)", "COMPONENT.service==='backend'")
    parent_custody.assert_current()
    acl = private['private_output'](directory)
    files = {}
    for name, raw in [('components.py', source_raw),
                      ('stage.py', material['stageSource']), ('runtime.py', material['runtimeSource']),
                      ('runtime-spec.json', json.dumps(spec, sort_keys=True, separators=(',', ':')).encode()),
                      ('original.py', original), ('validate-gzip.cjs', validator.encode()),
                      ('preflight-validator.py', source['preflight_validator_source']())]:
        files[name] = private['write'](directory / name, raw)
    def reference(file, expected):
        raw = pin(file, expected)
        return dict(file=str(file), sha256=hashlib.sha256(raw).hexdigest())
    binding = dict(format='sabalan-c3-backend-finite-original-stream-input/v1', phase=phase,
                   service='backend', component=component, operation=operation, sourceFiles=files,
                   runtimeSpec=files['runtime-spec.json'], runtimeSourceSha256=material['runtimeSourceSha256'],
                   remoteCommand=material['remoteCommand'], output=str(output), admission=admission,
                   preflightValidator=files['preflight-validator.py'],
                   preflight=inputs['preflight'],
                   profile=reference(Q / 'fixed-production-openssh-profile-20261020.json', '71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298'),
                   custody=reference(Q / 'C30-postcheckpoint-terminal-context-source-r2-current-original-pins-20261024/custody.py', 'a6ab3ec32561ef0865100485ff5a1ab566a5225c95a5831382a305cd8080f2d1'),
                   sshOwner=reference(Q / 'C30-production-control-image-import-source-r4-exact-six-service-census-20261024/owner.py', '62236fe988dff14e21fa62016fea000e9830599771acfaf7d9e01f26b5c6db04'),
                   privateOutputProducer=reference(private_file, '0e11fddceb398d90eced7650f59b6be92a223277c7bdd971376ccbd4f8ba28cb'),
                   windowsNode=private['NODE'], encryptionPhase=encryption, cipherInput=cipher,
                   producerReview=inputs['producerReview'], productionAdmission=False)
    owner_source = owner_builder['build'](binding, source)
    files['owned-function.py'] = private['write'](directory / 'owned-function.py', owner_source)
    parent_custody.assert_current()
    return dict(binding=binding, ownedFunction=files['owned-function.py'], privateAcl=acl,
                runtimeExecuted=False, productionAdmission=False)
