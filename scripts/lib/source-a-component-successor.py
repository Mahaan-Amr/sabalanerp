"""SourceA publisher-input successor for the fixed frontend and Inquiry images.

Planning only: no payload reads, native work, credentials or admission. The
coordinator must authenticate material/original receipts and hash all held
objects before publishing. Parsed receipt models are never publication proof.
"""
import argparse
import copy
import hashlib
import json
import os
import pathlib
import re
import stat

IMAGES = {
    'frontend': 'sha256:008388c7f0188170b46b7466f534398f91894f12770a96c9af96a4f6cc90e040',
    'inquiry': 'sha256:7b029f245af9ad80ca85d92df38996ac268821b62732b9b325901d697295e1b9',
}
SPKI = '455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
Q = pathlib.Path('D:/sabalanerp-online-qa')
REVIEWS = {
    'C30-source-a-fixed-existing-gzip-stream-source-r4-second-restart-20261025': '89e914e7d635044d3ce48c06c6e722d3449bc40435f27ba7bf0bff2b79f3b50f',
    'C30-source-a-fixed-existing-gzip-stream-source-r6-frontend-owner-component-selector-20261025': '136c9ad10e0d8b88b03aa9a4953793061088caad264362095de2cd801d8b3378',
    'C30-source-a-fixed-existing-gzip-stream-source-r7-typed-component-rsa-projection-20261025': 'ad4abcdfc79a7ce2c6a7dd4ca9b40087952d00e498b6390938c315a28a722cc7',
}


def original(row):
    assert type(row['originalPid']) is int and row['originalPid'] > 0
    assert row['code'] == 0 and row['signal'] is None
    assert row['stdoutEof'] is True and row['stderrEof'] is True
    assert row['observationFaults'] == [] and row['observationFaultCounts'] == {}
    assert row['observationFaultTotal'] == 0 and row['observationFaultLogOverflow'] is False
    assert row['localInterrupted'] is False and row['cancellations'] == []
    assert row['stdinBodyStored'] is False and row['stdinSecretStored'] is False
    assert row['productionAdmission'] is False


def children(rows):
    assert isinstance(rows, list) and rows
    for row in rows:
        assert type(row['pid']) is int and row['pid'] > 0
        assert row['code'] == 0 and row['pipesClosed'] is True
        assert row['observationFault'] is None


def object_ref(row):
    assert pathlib.Path(row['file']).is_absolute()
    assert type(row['bytes']) is int and 0 < row['bytes'] <= 2**31
    assert re.fullmatch('[a-f0-9]{64}', row['sha256'])
    return copy.deepcopy(row)


def compile_publication_plan(values, refs):
    """Join parsed evidence into retrieval requirements, never a final receipt.

    The fixed R6 actual-owner selector and R7 validated_inputs remain mandatory
    coordinator checks. This seam additionally rejects mismatched raw OCI graphs,
    independent closure, and cipher/plaintext identities before held-file hashing.
    """
    encryption, local, independent = (values[k] for k in ['encryption', 'local', 'independent'])
    service = local['service']
    image = IMAGES[service]
    component = local['component']
    assert component['service'] == service and component['image'] == image
    typed = encryption['format'] == 'sabalan-source-a-closed-native-existing-gzip-encryption-component/v1'
    assert encryption['service'] == service and encryption['component'] == component
    if typed:
        assert service == 'frontend'
        assert encryption['negativeParentQualified'] is False
        assert encryption['fullOuterPhaseSucceeded'] is False
        assert encryption['healthyApplicationPoint'] is False
        children([encryption['nativeOriginal']])
        cipher = encryption['cipher']
        encrypted = encryption['native']['result']
    else:
        assert encryption['format'] == 'sabalan-source-a-original-closed-stream-phase/v1'
        assert encryption['phase'] == 'encrypt-existing'
        assert encryption['allOriginalChildrenClosed'] is True
        assert encryption['inputKind'] == 'FIXED_EXISTING_GZIP'
        assert encryption['imageExported'] is False and encryption['regzipped'] is False
        for key in ['stageOriginal', 'binaryOriginal']:
            original(encryption[key])
        children(encryption['remote']['children'])
        assert encryption['remote']['image'] == image
        cipher = encryption['streamOutput']
        encrypted = encryption['remote']['native']['result']
    assert encryption['productionAdmission'] is False
    assert local['format'] == 'sabalan-source-a-original-closed-local-hash-phase/v1'
    assert local['phase'] == 'local-decrypt' and local['allOriginalChildrenClosed'] is True
    assert local['productionAdmission'] is False and local['healthyPointClaimed'] is False
    assert local['inputKind'] == 'FIXED_EXISTING_GZIP'
    assert local['imageExported'] is False and local['regzipped'] is False
    assert local['encryptionPhase'] == refs['encryption']
    for key in ['stageOriginal', 'binaryOriginal']:
        original(local[key])
        assert local[key]['installedSshHeldAcrossSameOriginal'] is True
    remote = local['remote']
    assert remote['format'] == 'sabalan-source-a-closed-local-hash-phase/v1'
    assert remote['image'] == image and remote['allOriginalChildrenClosed'] is True
    assert remote['plaintextReturned'] is False and remote['plaintextTransportBytes'] == 0
    children(remote['children'])
    assert local['binaryOriginal']['stderrBytes'] == 0
    assert local['hashProofPacket'] == {**local['binaryOriginal']['stdout'], 'bytes': local['binaryOriginal']['stdoutBytes']}
    plain = remote['native']['result']
    assert plain['gcmAuthenticated'] is True
    for key in ['cipherBytes', 'cipherSha256', 'plainBytes', 'plainSha256', 'header']:
        assert plain[key] == encrypted[key]
    assert plain['cipherBytes'] == cipher['bytes'] and plain['cipherSha256'] == cipher['sha256']
    assert plain['plainBytes'] == component['gzip']['bytes']
    assert plain['plainSha256'] == component['gzip']['sha256']
    assert plain['header']['version'] == 2
    assert [r['keyId'] for r in plain['header']['recipients']] == ['local-rollback', 'independent-recovery']
    decoded = local['canonicalLocalArchiveValidation']
    assert decoded['format'] == 'sabalan-source-a-private-local-gzip-oci/v1'
    assert decoded['productionAdmission'] is False and decoded['healthyPointClaimed'] is False
    assert decoded['compressed'] == local['reusedPlaintextRef'] == component['gzip']
    assert decoded['raw'] == component['raw']
    graph = decoded['archiveGraph']
    assert graph == component['archiveGraph'] and graph['index'] == image
    assert graph['rootfsDiffIds'] == component['rootfsDiffIds'] == remote['rootfsDiffIds']
    assert graph['archiveBytes'] == component['raw']['bytes']
    assert graph['archiveSha256'] == component['raw']['sha256']
    assert independent['format'] == 'sabalan-source-a-independent-image-stream-verified/v1'
    assert independent['service'] == service and independent['component'] == component
    assert independent['encryptionPhase'] == refs['encryption'] and independent['localPhase'] == refs['local']
    assert independent['allOriginalChildrenClosed'] is True and independent['independentDecryptVerified'] is True
    assert independent['productionAdmission'] is False and independent['healthyApplicationPoint'] is False
    for key in ['stageOriginal', 'verifyOriginal']:
        original(independent[key])
    closure = independent['remoteOriginalClosure']
    assert closure['format'] == 'sabalan-source-a-independent-image-original-closed/v1'
    assert closure['operation'] == independent['operation'] and closure['allOriginalChildrenClosed'] is True
    children(closure['children'])
    assert all(closure[k] is False for k in ['productionAdmission', 'FD9Acquired', 'privateRsaExported', 'cipherStored', 'plaintextStored'])
    native = independent['native']
    assert native['format'] == 'sabalan-source-a-independent-image-stream-gcm/v1'
    assert native['image'] == image and native['gcmAuthenticated'] is True
    assert native['independentPublicKeySha256'] == SPKI
    assert all(native[k] is False for k in ['privateRsaExported', 'plaintextPersisted', 'cipherPersisted', 'productionAdmission', 'healthyPointClaimed'])
    for key in ['cipherBytes', 'cipherSha256', 'plainBytes', 'plainSha256', 'header']:
        assert native[key] == plain[key]
    retrieval = {'ciphertext': object_ref(cipher), 'gzip': object_ref(component['gzip']), 'rawTar': object_ref(component['raw'])}
    assert len({r['file'] for r in retrieval.values()}) == 3
    assert len({r['sha256'] for r in retrieval.values()}) == 3
    return {
        'format': 'sabalan-source-a-component-publication-plan/v1', 'service': service,
        'sourceImageId': image, 'closedPhaseReferences': copy.deepcopy(refs),
        'archiveGraph': copy.deepcopy(graph), 'retrieval': retrieval,
        'staging': {'allHeldBytes': sum(r['bytes'] for r in retrieval.values()),
                    'remoteCipherPersisted': False, 'remotePlaintextPersisted': False},
        'requiredBeforePublication': 'held-file-sha256-readback',
        'coordinatorChecks': ['fixed-R6-owner-selector', 'fixed-R7-RSA-projection',
                              'source-material-original-joins', 'private-credential-finally-closure'],
        'negativeParentQualified': False, 'published': False, 'productionAdmission': False,
        'healthyApplicationPoint': False, 'publicOnlineAdmission': False,
    }


def identity(value):
    return tuple(getattr(value, key) for key in ['st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_mode', 'st_nlink'])


def bounded_bytes(file, maximum=8 * 1024**2):
    path = pathlib.Path(file)
    before = path.lstat()
    assert path.is_absolute() and path.resolve(strict=True) == path
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and 0 < before.st_size <= maximum
    with path.open('rb') as stream:
        held = os.fstat(stream.fileno())
        portable = lambda s: (s.st_ino, s.st_size, s.st_mtime_ns, s.st_mode, s.st_nlink)
        assert portable(before) == portable(held)
        if os.name != 'nt':
            assert identity(before) == identity(held)
        raw = stream.read(maximum + 1)
        assert len(raw) == before.st_size and len(raw) <= maximum
        assert identity(held) == identity(os.fstat(stream.fileno()))
    assert identity(before) == identity(path.lstat())
    return raw


def read_receipt(ref):
    """Bounded public receipt read; never follows aliases or opens payloads."""
    raw = bounded_bytes(ref['file'])
    assert hashlib.sha256(raw).hexdigest() == ref['sha256']
    return json.loads(raw)


def authenticate_material(ref, value, independent):
    """Join generated source to its fixed review and saved original byte streams."""
    service, operation = value['service'], value['operation']
    assert re.fullmatch('[a-f0-9]{32}', operation)
    if independent:
        output = Q / ('C30-source-a-existing-independent-runtime-' + service + '-' + operation)
        material = Q / ('C30-source-a-existing-independent-material-' + service + '-' + operation) / 'material.json'
        assert pathlib.Path(ref['file']) == output / 'verification-complete.json'
        fmt = 'sabalan-source-a-independent-image-stream-material/v1'
    else:
        phase = value['phase']
        output = Q / ('C30-source-a-existing-' + service + '-' + phase + '-' + operation)
        material = Q / ('C30-source-a-existing-material-' + service + '-' + phase + '-' + operation) / 'material.json'
        assert pathlib.Path(ref['file']) == output / 'phase-complete.json'
        fmt = 'sabalan-source-a-stream-phase-material/v1'
    material_ref = {'file': str(material), 'sha256': hashlib.sha256(bounded_bytes(material)).hexdigest()}
    source = read_receipt(material_ref)
    assert source['format'] == fmt and source['operation'] == operation
    assert source['productionAdmission'] is False
    review_ref = source['sourceReview']
    allowed = [{'file': str(Q / name / 'source-review.json'), 'sha256': digest} for name, digest in REVIEWS.items()]
    assert review_ref in allowed
    review = read_receipt(review_ref)
    for row in [*review['files'].values(), *source['files'].values()]:
        raw = bounded_bytes(row['file'], 2 * 1024**2)
        assert hashlib.sha256(raw).hexdigest() == row['sha256']
    rows = [read_receipt(r) for r in value['originalClosures']]
    for row in rows:
        original(row)
    for key in (['stageOriginal', 'verifyOriginal'] if independent else ['stageOriginal', 'binaryOriginal']):
        compared = copy.deepcopy(value[key])
        compared.pop('installedSshHeldAcrossSameOriginal', None)
        assert sum(row == compared for row in rows) == 1
    if independent:
        assert read_receipt(value['verifyOriginal']['stdout']) == value['native']
        assert read_receipt(value['verifyOriginal']['stderr']) == value['remoteOriginalClosure']
    else:
        assert read_receipt(value['binaryOriginal']['stdout' if value['phase'] == 'local-decrypt' else 'stderr']) == value['remote']
        stage = read_receipt(value['stageOriginal']['stdout'])
        assert stage['operation'] == operation and stage['phase'] == value['phase']
        assert stage['runtimeSpecSha256'] == value['remote']['runtimeSpecSha256']
        assert stage['allOriginalChildrenClosed'] is True and stage['archiveCreated'] is False
        children(stage['children'])
        if value['phase'] == 'local-decrypt':
            validators = [r for r in rows if r['phase'] == 'validateArchive']
            assert len(validators) == 1 and validators[0]['stderrBytes'] == 0
            assert read_receipt(validators[0]['stdout']) == value['canonicalLocalArchiveValidation']
    return material_ref


def prepare_publication_plan(refs):
    """Read actual bounded evidence; no source-selected commands are executed."""
    values = {k: read_receipt(r) for k, r in refs.items()}
    plan = compile_publication_plan(values, refs)
    materials = {}
    for key, value in values.items():
        if key == 'encryption' and value['format'] == 'sabalan-source-a-closed-native-existing-gzip-encryption-component/v1':
            # Exact already-published native component. R6 authenticate/metadata
            # remains the mandatory coordinator check for its negative parent.
            assert refs[key] == {'file': str(Q / 'C30-source-a-frontend-encryption-component-c0739bb539e448e38400c4ab405b9e8c/component.json'),
                                 'sha256': 'f4e29e91de9f73ece3de1468fb6bba90feddb3d3a9dce5bffbdd9b016b93334d'}
            materials[key] = copy.deepcopy(value['negativeParentReferences']['material'])
        else:
            materials[key] = authenticate_material(refs[key], value, key == 'independent')
    plan['materialReferences'] = materials
    plan['sourceMaterialOriginalJoinsVerified'] = True
    return plan


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ['encryption', 'local', 'independent']:
        parser.add_argument('--' + name, required=True)
        parser.add_argument('--' + name + '-sha256', required=True)
    args = parser.parse_args()
    refs = {name: {'file': str(pathlib.Path(getattr(args, name)).absolute()),
                   'sha256': getattr(args, name + '_sha256')}
            for name in ['encryption', 'local', 'independent']}
    print(json.dumps(prepare_publication_plan(refs), indent=2))


if __name__ == '__main__':
    main()
