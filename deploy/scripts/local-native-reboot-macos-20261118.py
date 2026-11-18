"""One Mac development VM incident. Abandonment is never native completion."""
import base64
import copy
import hashlib
import json
import re

INCIDENT = dict(activeSha256='bf714032489da8a47d2a0b741ed4236bcdd09d2aedbac193c836b4d5ae7dcd0a',
    oldBootId='a4a9f385-52d1-431e-b60c-15d152248b53', newBootId='b11f2794-d50a-40b9-beb5-26e49d60e672',
    instanceId='4e68eebbcc90884f387030e5e993a83d90036696d9ce7186',
    pidNamespace='pid:[4026532573]', startTicks='2300169', systemIdentifier='7675633270579748899', databaseOid='407395',
    oldContainerId='c3ebceb803fdbdb1d41a3c4dc93d911d408a03bea3021cc8778b39d2c63985d1',
    oldImageId='sha256:ae3561ca040a1eeea89e9ad3263ba3bd1da9d6289cb0afa6e787c39fc90b07e8')
# Set only after checkpoint capture and actual restoration in the existing PG service.
MANIFEST_SHA = '29175a67537c6bece2c56c71c5401a2bf62e7cf57747c7d6658833584012d6af'
HEX = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')


def require(value):
    if not value:
        raise RuntimeError('LOCAL_MACOS_REBOOT_AUTHORITY_UNPROVEN')


def reconcile(active, active_sha, observed):
    require(active_sha == INCIDENT['activeSha256'] and active.get('format') == 'sabalan-runtime-native/v1'
        and active.get('phase') == 'ACTIVE' and active.get('role') == 'standalone'
        and active.get('instanceId') == INCIDENT['instanceId']
        and active.get('namespace') == 'sabalan-rt-' + INCIDENT['instanceId']
        and active.get('previousSha256') is None and 'localAbandonmentSha256' not in active
        and active.get('guardian') == dict(bootId=INCIDENT['oldBootId'], pid=1,
            pidNamespace=INCIDENT['pidNamespace'], startTicks=INCIDENT['startTicks'])
        and active.get('clusterIdentifier') == INCIDENT['systemIdentifier']
        and active.get('initialDatabase') == dict(name='sabalanerp', oid=INCIDENT['databaseOid']))
    require(observed.get('project') == 'sabalanerp-local' and observed.get('nodeEnv') == 'development'
        and observed.get('role') == 'standalone' and observed.get('bootId') == INCIDENT['newBootId']
        and observed['bootId'] != INCIDENT['oldBootId']
        and observed.get('systemIdentifier') == INCIDENT['systemIdentifier']
        and observed.get('databaseOid') == INCIDENT['databaseOid']
        and observed.get('oldSessions') == observed.get('allTaggedSessions') == observed.get('prepared') == 0
        and observed.get('publicIngress') is False and observed.get('externalCredentials') is False
        and observed.get('historicalActive') == [] and observed.get('historicalIncidentEvidence') == []
        and all(observed.get(key) is None for key in ['priorReceiptSha256', 'priorHostProofSha256', 'failedHostProofSha256'])
        and IMAGE.fullmatch(observed.get('imageId', '')) and observed['imageId'] != INCIDENT['oldImageId'])
    proof = observed.get('hostProof')
    require(isinstance(proof, dict) and HEX.fullmatch(observed.get('hostProofSha256', ''))
        and proof.get('format') == 'sabalan-macos-local-recovery-host-proof/v1'
        and proof.get('project') == 'sabalanerp-local' and proof.get('hostPlatform') == 'darwin'
        and proof.get('purpose') == 'LOCAL_DEVELOPMENT_RECOVERY' and proof.get('productionAdmission') is False
        and proof.get('backendContainerId') == INCIDENT['oldContainerId']
        and proof.get('oldImageId') == INCIDENT['oldImageId']
        and proof.get('candidateImageId') == observed['imageId']
        and proof.get('activeSha256') == active_sha and proof.get('bootId') == observed['bootId']
        and proof.get('publicIngress') is False and proof.get('hostPort') == 5001
        and proof.get('database') == dict(system=INCIDENT['systemIdentifier'], oid=INCIDENT['databaseOid'],
            oldSessions=0, allTagged=0, prepared=0))
    checkpoint = proof.get('checkpoint')
    require(isinstance(checkpoint, dict) and checkpoint.get('readbackVerified') is True
        and checkpoint.get('databaseRestoreVerified') is True and checkpoint.get('independentBackup') is False
        and checkpoint.get('manifestSha256') == MANIFEST_SHA and HEX.fullmatch(MANIFEST_SHA)
        and isinstance(checkpoint.get('path'), str) and checkpoint['path'].startswith('/Users/ferferi/Documents/SabalanERP-local-recovery/20261118-macos-'))
    raw = base64.b64decode(checkpoint.get('manifestRawBase64', ''), validate=True)
    require(hashlib.sha256(raw).hexdigest() == MANIFEST_SHA)
    manifest = json.loads(raw)
    require(manifest.get('format') == 'sabalan-macos-local-incident-checkpoint/v1'
        and manifest.get('project') == 'sabalanerp-local' and manifest.get('activeSha256') == active_sha
        and manifest.get('backendContainerId') == INCIDENT['oldContainerId']
        and manifest.get('oldImageId') == INCIDENT['oldImageId'] and manifest.get('observedBootId') == observed['bootId']
        and manifest.get('clusterIdentifier') == observed['systemIdentifier'] and manifest.get('databaseOid') == observed['databaseOid']
        and manifest.get('checkpointPurpose') == 'LOCAL_DEVELOPMENT_RECOVERY'
        and manifest.get('independentBackup') is False and manifest.get('productionAdmission') is False
        and manifest.get('databaseRestoreVerified') is True and manifest.get('sqliteIntegrityVerified') is True
        and manifest.get('redisIntegrityVerified') is True)
    volumes = ['backend_recovery', 'backend_storage_accounting_contracts', 'backend_storage_contracts',
        'backend_storage_dispatch_documents', 'backend_storage_hr_hiring', 'backend_storage_sepidar_backups',
        'backend_storage_support_tickets', 'backend_uploads', 'inquiry_data', 'recovery_coordination', 'redis_data']
    names = ['original-active.json', 'container-inspect.private.json', 'backend-old-rootfs.tar',
        'postgres-sabalanerp.dump', 'inquiry-consistent.db', 'redis-consistent.rdb', 'restore-verification.json']
    require(manifest.get('volumeNames') == sorted('sabalanerp-local_' + name for name in volumes))
    names += ['volume-sabalanerp-local_' + name + '.tar' for name in volumes]
    entries = manifest.get('entries', [])
    require(sorted(row.get('name', '') for row in entries) == sorted(names)
        and all(isinstance(row.get('bytes'), int) and row['bytes'] > 0 and HEX.fullmatch(row.get('sha256', '')) for row in entries)
        and next(row for row in entries if row['name'] == 'original-active.json')['sha256'] == active_sha)
    return dict(format='sabalan-local-native-reboot/v1', phase='ABANDONED_ON_VM_REBOOT',
        nativeReaped=False, externalEffectsCompleted=False, productionAdmission=False,
        activeSha256=active_sha, instanceId=active['instanceId'], namespace=active['namespace'],
        guardian=copy.deepcopy(active['guardian']), project='sabalanerp-local', imageId=observed['imageId'],
        observedBootId=observed['bootId'], clusterIdentifier=observed['systemIdentifier'], databaseOid=observed['databaseOid'],
        hostProofSha256=observed['hostProofSha256'], checkpointManifestSha256=MANIFEST_SHA,
        checkpointPurpose='LOCAL_DEVELOPMENT_RECOVERY', independentBackup=False)


def valid_receipt(active, active_sha, receipt, observed):
    try:
        return receipt == reconcile(active, active_sha, observed)
    except (RuntimeError, ValueError, TypeError, KeyError, AttributeError):
        return False
