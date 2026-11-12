"""Pure policy for one explicitly witnessed local Docker VM reboot.

This receipt describes abandonment, never completion. Its caller must acquire
the existing FD9 lock and make fresh PostgreSQL observations before publication.
"""
import copy
import re


HEX = re.compile(r'[a-f0-9]{64}\Z')
IMAGE = re.compile(r'sha256:[a-f0-9]{64}\Z')
HISTORY = re.compile(r'deployment-runtime-native\.preserved-[a-f0-9]{64}\.json\Z')
INCIDENT_FILE = re.compile(r'local-(?:forced-recovery|reboot)-incident-[a-zA-Z0-9_.-]+\.json\Z')
INCIDENT = dict(activeSha256='a22e3874e7af624bc804ef91bb792026f13e49ce4d3247082c164848547b3a42',
                namespace='sabalan-rt-280d8c76b5fbdcdabe9fcd65764a8d08efbdc2f5d9ecf373',
                oldBootId='f0aa7f6f-1563-4d9f-98b1-322a428f5e0f',
                newBootId='db891a29-1343-421d-9df8-28b3b495cf08',
                pidNamespace='pid:[4026532749]', guardianPid=1, startTicks='83032',
                systemIdentifier='7703877635514671138', databaseOid='57567')


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
            and active.get('initialDatabase', {}).get('oid') == INCIDENT['databaseOid'])
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
    historical = observed.get('historicalActive')
    require(isinstance(historical, list) and len(historical) == 7 and all(
        isinstance(item, dict) and HISTORY.fullmatch(item.get('name', ''))
        and HEX.fullmatch(item.get('sha256', '')) for item in historical))
    require(len({item['name'] for item in historical}) == len(historical))
    incidents = observed.get('historicalIncidentEvidence')
    require(isinstance(incidents, list) and len(incidents) >= 2 and all(
        isinstance(item, dict) and INCIDENT_FILE.fullmatch(item.get('name', ''))
        and HEX.fullmatch(item.get('sha256', '')) for item in incidents))
    require(len({item['name'] for item in incidents}) == len(incidents))
    return dict(format='sabalan-local-native-reboot/v1', phase='ABANDONED_ON_VM_REBOOT',
                nativeReaped=False, externalEffectsCompleted=False, productionAdmission=False,
                activeSha256=active_sha, instanceId=active['instanceId'], namespace=active['namespace'],
                guardian=copy.deepcopy(active['guardian']), project='sabalanerp-local',
                imageId=observed['imageId'], observedBootId=observed['bootId'],
                clusterIdentifier=observed['systemIdentifier'], databaseOid=observed['databaseOid'],
                historicalActive=copy.deepcopy(historical),
                historicalIncidentEvidence=copy.deepcopy(incidents))


def valid_receipt(active, active_sha, receipt, observed):
    try:
        return receipt == reconcile(active, active_sha, observed)
    except (RuntimeError, TypeError, KeyError, AttributeError):
        return False
