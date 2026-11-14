"""Pure policy for the second, exactly pinned local Docker VM reboot.

This receipt describes abandonment, never completion. Its caller must acquire
the existing FD9 lock and make fresh PostgreSQL observations before publication.
"""
import copy
import hashlib
import json
import re


HEX = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')
HISTORY = re.compile(r'deployment-runtime-native\.preserved-[a-f0-9]{64}\.json\Z')
INCIDENT_FILE = re.compile(r'local-(?:forced-recovery|reboot)-incident-[a-zA-Z0-9_.-]+\.json\Z')
INCIDENT = dict(activeSha256='b820bfa60ec642b87c17a34fcbc527021164708a33df1227d7e19c39c4f8be8a',
                namespace='sabalan-rt-d2d1b01b543eae810dd2d5b32d6b18537651363748b84d96',
                oldBootId='db891a29-1343-421d-9df8-28b3b495cf08',
                newBootId='d4568d2d-96ec-4bc3-94ab-4ba62defe9eb',
                pidNamespace='pid:[4026532751]', guardianPid=1, startTicks='1829736',
                systemIdentifier='7703877635514671138', databaseOid='57567',
                oldContainerId='00ac2640632a76be3d6bff5378511a14dc8c3b7834bf7754a5d70a0c169c671a',
                oldImageId='sha256:ab17d2c1380b2c70352af3d1cff8c2d301624346637ea5ecb7480fe1a0f21ab9')
VOLUMES = sorted([
    'sabalanerp-local_recovery_coordination', 'sabalanerp-local_backend_uploads',
    'sabalanerp-local_inquiry_data', 'sabalanerp-local_backend_storage_accounting_contracts',
    'sabalanerp-local_backend_storage_contracts', 'sabalanerp-local_backend_storage_hr_hiring',
    'sabalanerp-local_backend_recovery', 'sabalanerp-local_backend_storage_sepidar_backups',
    'sabalanerp-local_backend_storage_support_tickets',
    'sabalanerp-local_backend_storage_dispatch_documents',
])
PRIOR_RECEIPT_SHA = '44c60ad9d492eab6997fa32f3c44c0370f3d9020bd046b5e5ced3664bc44e6a3'
PRIOR_PROOF_SHA = 'da0ac9ca538c3f6b7506affd83a73e69482a0e606e6675efc29e74d539e95841'
PRIOR_MANIFEST_SHA = 'ac45cb21320c484cb71fac2e812cb1463eb85d6480c381164af750e1594f773b'
PRESERVED = [
    '23f4614a94022f620734db73518c133cc9a611a6ec34c39b20a3964cf249a209',
    '6822650bc17ebfa79eb752bc0e82855bb6364cb03a96b5cb43a686a1a80a8d99',
    '6b444749ec4f4a088b7872b6f129f6b624a86569a3467dd9fbb2bf4a51cea867',
    '89c6e30fce2656fe1dea63aa223cf5c4cfdad09157893dd19d91ca3fb15b9dec',
    'a9bb0fe72d69b3937277a1367bb9ca2feaedb9821898fbe20f0e85b6ab0231f0',
    'c5a4d5b2a61e52362cca587d6a122048dabc943f9384f7cc882cad46766b220d',
]
INCIDENT_EVIDENCE = [
    ('local-forced-recovery-incident-57b31bd0b37eb5396ef575c42ba5cf5d2ef09dedb7ee054e22caa91676fe8eaf.json',
     '57b31bd0b37eb5396ef575c42ba5cf5d2ef09dedb7ee054e22caa91676fe8eaf'),
    ('local-reboot-incident-ce0b4189717428b1788c24c2353dab93daf29fafd604330e4d93e7d1c4b0783d.json',
     'ce0b4189717428b1788c24c2353dab93daf29fafd604330e4d93e7d1c4b0783d'),
]


def require(condition):
    if not condition:
        raise RuntimeError('LOCAL_NATIVE_REBOOT_AUTHORITY_UNPROVEN')


def reconcile(active, active_sha, observed):
    require(isinstance(active, dict) and active.get('format') == 'sabalan-runtime-native/v1'
            and active.get('phase') == 'ACTIVE' and active.get('role') == 'standalone'
            and re.fullmatch(r'[a-f0-9]{48}', active.get('instanceId', ''))
            and active.get('namespace') == 'sabalan-rt-' + active['instanceId']
            and isinstance(active.get('guardian'), dict)
            and isinstance(active['guardian'].get('pid'), int) and active['guardian']['pid'] > 0
            and re.fullmatch(r'[1-9][0-9]*', active['guardian'].get('startTicks', ''))
            and active['guardian'].get('bootId') and active['guardian'].get('pidNamespace')
            and HEX.fullmatch(active_sha) and active_sha == INCIDENT['activeSha256']
            and active['namespace'] == INCIDENT['namespace']
            and active['guardian']['bootId'] == INCIDENT['oldBootId']
            and active['guardian']['pidNamespace'] == INCIDENT['pidNamespace']
            and active['guardian']['pid'] == INCIDENT['guardianPid']
            and active['guardian']['startTicks'] == INCIDENT['startTicks']
            and active.get('clusterIdentifier') == INCIDENT['systemIdentifier']
            and active.get('initialDatabase', {}).get('oid') == INCIDENT['databaseOid']
            and active.get('previousSha256') == 'a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42'
            and active.get('localAbandonmentSha256') == PRIOR_RECEIPT_SHA)
    require(observed.get('project') == 'sabalanerp-local' and observed.get('nodeEnv') == 'development'
            and observed.get('role') == 'standalone' and IMAGE.fullmatch(observed.get('imageId', ''))
            and observed.get('bootId') == INCIDENT['newBootId']
            and observed['bootId'] != active['guardian']['bootId']
            and observed.get('systemIdentifier') == active.get('clusterIdentifier')
            and observed.get('databaseOid') == active.get('initialDatabase', {}).get('oid')
            and active.get('initialDatabase', {}).get('name') == 'sabalanerp'
            and observed.get('oldSessions') == 0 and observed.get('allTaggedSessions') == 0
            and observed.get('prepared') == 0 and observed.get('publicIngress') is False
            and observed.get('externalCredentials') is False)
    require(observed.get('priorReceiptSha256') == PRIOR_RECEIPT_SHA
            and observed.get('priorHostProofSha256') == PRIOR_PROOF_SHA)
    historical = observed.get('historicalActive')
    require(isinstance(historical, list) and len(historical) == len(PRESERVED) and all(
        isinstance(item, dict) and HISTORY.fullmatch(item.get('name', ''))
        and HEX.fullmatch(item.get('sha256', '')) for item in historical))
    require(historical == [dict(name='deployment-runtime-native.preserved-' + sha + '.json', sha256=sha)
                           for sha in PRESERVED])
    incidents = observed.get('historicalIncidentEvidence')
    require(isinstance(incidents, list) and len(incidents) == len(INCIDENT_EVIDENCE) and all(
        isinstance(item, dict) and INCIDENT_FILE.fullmatch(item.get('name', ''))
        and HEX.fullmatch(item.get('sha256', '')) for item in incidents))
    require(incidents == [dict(name=name, sha256=sha) for name, sha in INCIDENT_EVIDENCE])
    proof = observed.get('hostProof')
    require(isinstance(proof, dict) and HEX.fullmatch(observed.get('hostProofSha256', ''))
            and proof.get('format') == 'sabalan-local-native-reboot-host-proof/v1'
            and proof.get('project') == 'sabalanerp-local'
            and proof.get('activeSha256') == active_sha
            and proof.get('backendContainerId') == INCIDENT['oldContainerId']
            and proof.get('oldImageId') == INCIDENT['oldImageId']
            and proof.get('retainedOldImageTag') == 'sabalanerp-local-backend:pre-reboot-20261114'
            and proof.get('priorReceiptSha256') == PRIOR_RECEIPT_SHA
            and proof.get('priorHostProofSha256') == PRIOR_PROOF_SHA
            and proof.get('priorCheckpointManifestSha256') == PRIOR_MANIFEST_SHA
            and proof.get('candidateImageId') == observed['imageId']
            and proof.get('bootId') == observed['bootId']
            and proof.get('publicIngress') is False
            and proof.get('historicalActive') == historical
            and proof.get('historicalIncidentEvidence') == incidents)
    database = proof.get('database')
    require(isinstance(database, dict) and database.get('system') == INCIDENT['systemIdentifier']
            and database.get('oid') == INCIDENT['databaseOid']
            and database.get('oldSessions') == 0 and database.get('allTagged') == 0
            and database.get('prepared') == 0)
    checkpoint = proof.get('checkpoint')
    require(isinstance(checkpoint, dict) and HEX.fullmatch(checkpoint.get('manifestSha256', ''))
            and HEX.fullmatch(checkpoint.get('independentManifestSha256', ''))
            and checkpoint.get('manifestSha256') == checkpoint.get('independentManifestSha256')
            and checkpoint.get('primaryPath') and checkpoint.get('independentPath')
            and checkpoint['primaryPath'] != checkpoint['independentPath']
            and checkpoint.get('primaryReadbackVerified') is True
            and checkpoint.get('independentReadbackVerified') is True
            and re.match(r'^C:[\\/]', checkpoint['primaryPath'], re.IGNORECASE)
            and re.match(r'^D:[\\/]', checkpoint['independentPath'], re.IGNORECASE))
    manifest = checkpoint.get('manifest')
    require(isinstance(manifest, dict)
            and manifest.get('format') == 'sabalan-local-native-reboot-checkpoint/v1'
            and manifest.get('activeSha256') == active_sha
            and manifest.get('postgresSystemIdentifier') == INCIDENT['systemIdentifier']
            and manifest.get('databaseOid') == INCIDENT['databaseOid']
            and manifest.get('inquiryDatabase') == 'consistent-sqlite-backup'
            and manifest.get('redis') == 'consistent-rdb-snapshot'
            and manifest.get('clamavSignatures') == 'regenerable-service-untouched'
            and manifest.get('absentBeforeReconciliation') == []
            and manifest.get('volumeArchives') == 'file-copy-only'
            and isinstance(manifest.get('entries'), list))
    entries = manifest['entries']
    require(hashlib.sha256((json.dumps(manifest, separators=(',', ':')) + '\n').encode()).hexdigest()
            == checkpoint['manifestSha256'])
    require(sorted(item.get('name') for item in entries if isinstance(item, dict)) ==
            sorted(['backend-old-container-inspect.json', 'backend-old-rootfs.tar',
                    'postgres-sabalanerp.dump', 'inquiry-consistent.db', 'redis-consistent.rdb'] +
                   ['volume-' + name + '.tar' for name in VOLUMES]))
    require(all(isinstance(item.get('bytes'), int) and item['bytes'] > 0
                and HEX.fullmatch(item.get('sha256', '')) for item in entries))
    return dict(format='sabalan-local-native-reboot/v1', phase='ABANDONED_ON_VM_REBOOT',
                nativeReaped=False, externalEffectsCompleted=False, productionAdmission=False,
                activeSha256=active_sha, instanceId=active['instanceId'], namespace=active['namespace'],
                guardian=copy.deepcopy(active['guardian']), project='sabalanerp-local',
                imageId=observed['imageId'], observedBootId=observed['bootId'],
                clusterIdentifier=observed['systemIdentifier'], databaseOid=observed['databaseOid'],
                historicalActive=copy.deepcopy(historical),
                historicalIncidentEvidence=copy.deepcopy(incidents),
                priorReceiptSha256=PRIOR_RECEIPT_SHA,
                priorHostProofSha256=PRIOR_PROOF_SHA,
                priorCheckpointManifestSha256=PRIOR_MANIFEST_SHA,
                hostProofSha256=observed['hostProofSha256'],
                checkpointManifestSha256=checkpoint['manifestSha256'])


def valid_receipt(active, active_sha, receipt, observed):
    try:
        return receipt == reconcile(active, active_sha, observed)
    except (RuntimeError, TypeError, KeyError, AttributeError):
        return False
