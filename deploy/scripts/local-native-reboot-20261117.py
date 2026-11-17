"""Local-only abandonment policy for the exact November 17 Docker VM reboot."""
import base64
import binascii
import copy
from datetime import datetime
import hashlib
import json
import re


ACTIVE_SHA = '334255f21ce1dc1eed916c26e47cc70c535cb81654552b760743e0e1cec997fd'
INCIDENT = dict(activeSha256=ACTIVE_SHA)
OLD_IMAGE = 'sha256:86899cc48ba087f22ee2385c20b6ca7cf2f568ff15d51fd44f1b6e57f021d4af'
OLD_CONTAINER = '054134c71149589d36eeaec7d80b9f0932e92a675a2f5e91147fbd47748e1cbf'
INQUIRY_IMAGE = 'sha256:861da55794e7dac1e98c972c3f8f3bbb2ec3b3289df10d27e1556d246b2c32c8'
NAMESPACE = 'sabalan-rt-a21c30608612fd8d9a6c0b41f799c542c9391a8203d6ba5e'
PREVIOUS_ACTIVE_SHA = '2cfea161077b52a2313177be2e2ce0ee9cb15682b7dd2d83c0df6539e30898a9'
PREVIOUS_RECEIPT_SHA = '109bc44da8d00b93e99266c759c134c3570b67330c0b8fb1ddb6125cb16e5235'
OLD_BOOT = 'ecdfd6df-b536-4161-9bef-a97e7a69f788'
NEW_BOOT = 'e758296d-c127-49c1-94d4-636136f61d1b'
SYSTEM = '7703877635514671138'
DATABASE_OID = '57567'
HEX = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')
MANIFEST_SHA = '19de038260f188e42b26c7178f75577193423ba8564d024e4adccf732f6460ad'
PRIMARY_PATH = r'D:\sabalanerp-local-recovery-20261117'
INDEPENDENT_PATH = r'C:\Users\PC\Documents\Codex\sabalanerp-local-recovery-20261117'
VOLUMES = ['backend_recovery', 'backend_storage_accounting_contracts',
           'backend_storage_contracts', 'backend_storage_dispatch_documents',
           'backend_storage_hr_hiring', 'backend_storage_sepidar_backups',
           'backend_storage_support_tickets', 'backend_uploads', 'inquiry_data',
           'recovery_coordination', 'redis_data']
FILES = {name + '.tar' for name in VOLUMES} | {
    'postgres.dump', 'backend-image.tar', 'inquiry-image.tar', 'inquiry-consistent.db', 'redis-consistent.rdb'}


def require(condition):
    if not condition:
        raise RuntimeError('LOCAL_NATIVE_REBOOT_20261117_AUTHORITY_UNPROVEN')


def verify_checkpoint(checkpoint, inquiry_image):
    require(isinstance(checkpoint, dict)
            and checkpoint.get('primaryPath') == PRIMARY_PATH
            and checkpoint.get('independentPath') == INDEPENDENT_PATH
            and checkpoint.get('primaryReadbackVerified') is True
            and checkpoint.get('independentReadbackVerified') is True)
    digest = checkpoint.get('manifestSha256', '')
    require(digest == MANIFEST_SHA and checkpoint.get('independentManifestSha256') == MANIFEST_SHA)
    raw = base64.b64decode(checkpoint.get('manifestRawBase64', ''), validate=True)
    require(hashlib.sha256(raw).hexdigest() == digest)
    manifest = json.loads(raw)
    require(isinstance(manifest, dict)
            and manifest.get('format') == 'sabalan-local-dual-checkpoint/v1'
            and manifest.get('sourceProject') == 'sabalanerp-local'
            and manifest.get('activeSha256') == ACTIVE_SHA
            and manifest.get('backendContainerId') == OLD_CONTAINER
            and manifest.get('backendImage') == OLD_IMAGE
            and manifest.get('inquiryImage') == inquiry_image
            and manifest.get('observedBootId') == NEW_BOOT
            and manifest.get('clusterIdentifier') == SYSTEM
            and manifest.get('databaseOid') == DATABASE_OID)
    captured = manifest.get('captureStartedAt', '')
    require(re.fullmatch(r'2026-11-17T\d{2}:\d{2}:\d{2}\.\d{3}Z', captured))
    datetime.strptime(captured, '%Y-%m-%dT%H:%M:%S.%fZ')
    entries = manifest.get('entries', [])
    require(isinstance(entries, list) and len(entries) == len(FILES))
    require(all(isinstance(item, dict) and item.get('name') in FILES
                and type(item.get('bytes')) is int and 0 < item['bytes'] <= 2 ** 53 - 1
                and HEX.fullmatch(item.get('sha256', '')) for item in entries))
    require({item['name'] for item in entries} == FILES)
    return digest


def reconcile(active, active_sha, observed):
    require(isinstance(active, dict) and active.get('format') == 'sabalan-runtime-native/v1'
            and active.get('phase') == 'ACTIVE' and active.get('role') == 'standalone'
            and active_sha == ACTIVE_SHA
            and active.get('namespace') == NAMESPACE
            and active.get('instanceId') == NAMESPACE.removeprefix('sabalan-rt-')
            and active.get('clusterIdentifier') == SYSTEM
            and active.get('initialDatabase') == dict(name='sabalanerp', oid=DATABASE_OID))
    guardian = active.get('guardian', {})
    require(guardian.get('bootId') == OLD_BOOT and guardian.get('pid') == 1
            and guardian.get('pidNamespace') == 'pid:[4026532757]'
            and guardian.get('startTicks') == '2758265')
    require(observed.get('project') == 'sabalanerp-local'
            and observed.get('nodeEnv') == 'development'
            and observed.get('role') == 'standalone'
            and IMAGE.fullmatch(observed.get('imageId', ''))
            and observed['imageId'] != OLD_IMAGE
            and observed.get('bootId') == NEW_BOOT
            and observed.get('systemIdentifier') == SYSTEM
            and observed.get('databaseOid') == DATABASE_OID
            and observed.get('oldSessions') == 0
            and observed.get('allTaggedSessions') == 0
            and observed.get('prepared') == 0
            and observed.get('publicIngress') is False
            and observed.get('externalCredentials') is False)
    proof = observed.get('hostProof')
    require(isinstance(proof, dict) and HEX.fullmatch(observed.get('hostProofSha256', ''))
            and proof.get('format') == 'sabalan-local-native-reboot-host-proof/v1'
            and proof.get('project') == 'sabalanerp-local'
            and proof.get('activeSha256') == ACTIVE_SHA
            and proof.get('backendContainerId') == OLD_CONTAINER
            and proof.get('oldImageId') == OLD_IMAGE
            and proof.get('inquiryImageId') == INQUIRY_IMAGE
            and proof.get('candidateImageId') == observed['imageId']
            and proof.get('bootId') == NEW_BOOT
            and proof.get('publicIngress') is False
            and active.get('previousSha256') == PREVIOUS_ACTIVE_SHA
            and active.get('localAbandonmentSha256') == PREVIOUS_RECEIPT_SHA
            and proof.get('previousActiveSha256') == observed.get('previousActiveSha256') == active['previousSha256']
            and proof.get('previousReceiptSha256') == observed.get('previousReceiptSha256') == active['localAbandonmentSha256'])
    require(proof.get('database') == dict(system=SYSTEM, oid=DATABASE_OID, oldSessions=0, allTagged=0, prepared=0))
    digest = verify_checkpoint(proof.get('checkpoint'), proof['inquiryImageId'])
    return dict(format='sabalan-local-native-reboot/v1', phase='ABANDONED_ON_VM_REBOOT',
                nativeReaped=False, externalEffectsCompleted=False, productionAdmission=False,
                activeSha256=ACTIVE_SHA, instanceId=active['instanceId'], namespace=active['namespace'],
                guardian=copy.deepcopy(guardian), project='sabalanerp-local', imageId=observed['imageId'],
                observedBootId=NEW_BOOT, clusterIdentifier=SYSTEM, databaseOid=DATABASE_OID,
                previousActiveSha256=active['previousSha256'], previousReceiptSha256=active['localAbandonmentSha256'],
                hostProofSha256=observed['hostProofSha256'], checkpointManifestSha256=digest)


def valid_receipt(active, active_sha, receipt, observed):
    try:
        return receipt == reconcile(active, active_sha, observed)
    except (RuntimeError, TypeError, KeyError, ValueError, AttributeError, binascii.Error):
        return False
