#!/usr/bin/env python3
"""Execute only the checkpoint-bound Mac incident on the existing local service."""
import base64
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import tarfile
from hashlib import sha256

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ['compose', '-f', str(ROOT / 'docker-compose.local.yml')]


def require(condition, message='LOCAL_MACOS_RECOVERY_PREFLIGHT_FAILED'):
    if not condition:
        raise RuntimeError(message)


def docker(args, **kwargs):
    rows = [json.loads(line) for line in subprocess.check_output(['docker', *COMPOSE, 'ps', '--format', 'json'], text=True).splitlines() if line.strip()]
    require(rows and all(row['Project'] == 'sabalanerp-local' for row in rows))
    return subprocess.check_output(['docker', *args], cwd=ROOT, **kwargs)


def digest(file):
    result = sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            result.update(chunk)
    return result.hexdigest()


def image_migrations(archive, candidate):
    """Read migrations only through the verified immutable OCI descriptor graph."""
    with tarfile.open(archive) as outer:
        def blob(descriptor):
            identity = descriptor['digest']
            require(re.fullmatch(r'sha256:[a-f0-9]{64}', identity))
            member = outer.getmember('blobs/sha256/' + identity[7:])
            require(member.isfile() and member.size == descriptor['size'])
            stream = outer.extractfile(member)
            checksum = sha256()
            for chunk in iter(lambda: stream.read(1024 * 1024), b''):
                checksum.update(chunk)
            require(checksum.hexdigest() == identity[7:], 'IMAGE_BLOB_CHECKSUM_MISMATCH')
            return member
        index = json.load(outer.extractfile('index.json'))
        roots = [d for d in index['manifests'] if d['digest'] == candidate]
        require(len(roots) == 1)
        image_index = json.load(outer.extractfile(blob(roots[0])))
        platforms = [d for d in image_index['manifests'] if d.get('platform') == dict(architecture='arm64', os='linux')]
        require(len(platforms) == 1)
        manifest = json.load(outer.extractfile(blob(platforms[0])))
        blob(manifest['config'])
        result = {}
        for descriptor in manifest['layers']:
            member = blob(descriptor)
            with tarfile.open(fileobj=outer.extractfile(member), mode='r|*') as layer:
                for entry in layer:
                    name = entry.name.removeprefix('./')
                    # Refuse ambiguous overlay deletion rather than infer a catalog.
                    parts = name.split('/')
                    for offset, part in enumerate(parts):
                        if part.startswith('.wh.'):
                            parent = '/'.join(parts[:offset])
                            hidden = parent if part == '.wh..wh..opq' else '/'.join(parts[:offset] + [part[4:]])
                            relevant = hidden in ('', 'app', 'app/prisma', 'app/prisma/migrations') or hidden.startswith('app/prisma/migrations/')
                            require(not relevant, 'MIGRATION_WHITEOUT_UNSUPPORTED')
                    if name in ('app', 'app/prisma', 'app/prisma/migrations') or (re.fullmatch(r'app/prisma/migrations/[^/]+', name) and name not in ('app/prisma/migrations/migration_lock.toml', 'app/prisma/migrations/.DS_Store')):
                        require(entry.isdir(), 'MIGRATION_ANCESTOR_NOT_DIRECTORY')
                    if name.startswith('app/prisma/migrations/'):
                        require(entry.isfile() or entry.isdir(), 'MIGRATION_LINK_UNSUPPORTED')
                    match = re.fullmatch(r'app/prisma/migrations/([^/]+)/migration.sql', name)
                    if match:
                        require(entry.isfile(), 'MIGRATION_SQL_NOT_REGULAR_FILE')
                    if match and entry.isfile():
                        result[match[1]] = sha256(layer.extractfile(entry).read()).hexdigest()
        require(result, 'EMPTY_IMAGE_MIGRATION_CATALOG')
        return result


def original_migrations(rootfs):
    result = {}
    with tarfile.open(rootfs) as archive:
        for entry in archive:
            match = re.fullmatch(r'app/prisma/migrations/([^/]+)/migration.sql', entry.name.removeprefix('./'))
            if match and entry.isfile():
                result[match[1]] = sha256(archive.extractfile(entry).read()).hexdigest()
    require(result)
    return result


def verify_migration_history(checkpoint):
    with (checkpoint / 'postgres-sabalanerp.dump').open('rb') as source:
        restored = docker(['exec', '-i', 'sabalanerp-local-postgres-1', 'pg_restore',
            '--data-only', '--table=_prisma_migrations', '--no-owner', '--no-privileges', '--file=-'], stdin=source).decode()
    match = re.search(r'COPY public\._prisma_migrations \(([^\n]+)\) FROM stdin;\n(.*?)\n\\\.\n', restored, re.S)
    require(match is not None, 'CHECKPOINT_MIGRATION_HISTORY_MISSING')
    columns, rows = match.groups()
    current = docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp',
        '-c', 'COPY (SELECT ' + columns + ' FROM public._prisma_migrations) TO STDOUT']).decode()
    require(sorted(current.splitlines()) == sorted(rows.splitlines()), 'MIGRATION_HISTORY_CHANGED_SINCE_CHECKPOINT')


def business_fingerprints():
    result = {}
    for table in ['sales_contracts', 'accounting_financial_records', 'accounting_audit_logs',
            'accounting_receivables', 'accounting_payment_statuses', 'accounting_tax_records',
            'partner_sale_cases', 'partner_case_revisions', 'crm_customer_cards', 'crm_customers']:
        sql = 'SELECT count(*), md5(coalesce(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) FROM (SELECT md5(to_jsonb(t)::text) row_hash FROM "' + table + '" t) rows'
        result[table] = docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', sql]).decode().strip()
    return result


def execute(checkpoint, candidate):
    require(sys.platform == 'darwin' and re.fullmatch(r'sha256:[a-f0-9]{64}', candidate))
    spec = importlib.util.spec_from_file_location('policy', ROOT / 'deploy/scripts/local-native-reboot-macos-20261118.py')
    policy = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(policy)
    i = policy.INCIDENT
    checkpoint = Path(checkpoint)
    require(checkpoint.is_absolute() and checkpoint.resolve() == checkpoint and not checkpoint.is_symlink())
    require(digest(checkpoint / 'manifest.json') == policy.MANIFEST_SHA)
    raw = (checkpoint / 'manifest.json').read_bytes()
    manifest = json.loads(raw)
    for row in manifest['entries']:
        file = checkpoint / row['name']
        require(file.is_file() and not file.is_symlink() and file.stat().st_size == row['bytes'] and digest(file) == row['sha256'])
    inventory = json.loads(docker(['inspect', *['sabalanerp-local-' + name + '-1' for name in ['backend', 'frontend', 'inquiry', 'postgres', 'redis']]]))
    backend = inventory[0]
    require(backend['Id'] == i['oldContainerId'] and backend['Image'] == i['oldImageId'] and backend['State']['Restarting'])
    for row in inventory:
        require(row['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-local')
        for bindings in (row['HostConfig'].get('PortBindings') or {}).values():
            require(all(binding['HostIp'] == '127.0.0.1' for binding in bindings or []))
    env = dict(value.split('=', 1) for value in backend['Config']['Env'] if '=' in value)
    require(env['NODE_ENV'] == 'development' and env['SMS_IR_ENVIRONMENT'] == 'sandbox')
    require(not any(env.get(key) for key in ['SMS_IR_API_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY', 'TAXPAYER_DELIVERY_BROKER_ENDPOINT',
        'TAXPAYER_BROKER_URL', 'TAXPAYER_BROKER_TOKEN', 'TAXPAYER_API_KEY', 'ACCOUNTING_RECONCILIATION_URL']))
    original = docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-native.json'])
    require(sha256(original).hexdigest() == i['activeSha256'])
    require(docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/proc/sys/kernel/random/boot_id']).decode().strip() == i['newBootId'])
    sql = "SELECT system_identifier::text,(SELECT oid FROM pg_database WHERE datname='sabalanerp'),(SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'),(SELECT count(*) FROM pg_prepared_xacts) FROM pg_control_system()"
    require(docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'postgres', '-c', sql]).decode().strip() == i['systemIdentifier'] + '|' + i['databaseOid'] + '|0|0')
    require(docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp',
        '-c', 'SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL']).strip() == b'0', 'UNRESOLVED_MIGRATION')
    applied_rows = docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp',
        '-c', 'SELECT migration_name,checksum FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL']).decode().splitlines()
    applied = dict(row.split('|', 1) for row in applied_rows)
    migrations = image_migrations(checkpoint / 'candidate-image.tar', candidate)
    require(not migrations.keys() - applied.keys(), 'PENDING_MIGRATIONS_PREVENT_PRESERVATION')
    require(migrations == original_migrations(checkpoint / 'backend-old-rootfs.tar'), 'MIGRATION_SQL_CHANGED_SINCE_CHECKPOINT')
    verify_migration_history(checkpoint)
    legacy_drift = sorted(name for name, checksum in migrations.items() if applied[name] != checksum)
    print(json.dumps(dict(preservedHistoricalChecksumDrift=legacy_drift)), flush=True)
    due_sql = '''SELECT (SELECT count(*) FROM sales_contracts WHERE "commercialFlowVersion"=1 AND "partnerKind" IS NULL AND "partnerCaseId" IS NULL AND "firstFinancialRecordAt" IS NULL AND "commercialExpiresAt" <= now()+interval '1 hour' AND status NOT IN ('CANCELLED','EXPIRED') AND NOT "isInactive") + (SELECT count(*) FROM hr_duties WHERE status='OPEN' AND "sourceType"='SALES_CONTRACT_CORRECTION' AND "sourceActionCode"='SALES_EDIT_CONTRACT_CORRECTION' AND "dueAt" <= now()+interval '1 hour')'''
    require(docker(['exec', 'sabalanerp-local-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', due_sql]).strip() == b'0',
        'DUE_BUSINESS_MUTATIONS_PREVENT_PRESERVATION')
    before = business_fingerprints()
    require(before == json.loads((checkpoint / 'restore-verification.json').read_text())['fingerprints'],
        'SOURCE_CHANGED_SINCE_CHECKPOINT')
    proof = dict(format='sabalan-macos-local-recovery-host-proof/v1', project='sabalanerp-local', hostPlatform='darwin',
        purpose='LOCAL_DEVELOPMENT_RECOVERY', productionAdmission=False, backendContainerId=i['oldContainerId'],
        oldImageId=i['oldImageId'], candidateImageId=candidate, activeSha256=i['activeSha256'], bootId=i['newBootId'],
        publicIngress=False, hostPort=5001, database=dict(system=i['systemIdentifier'], oid=i['databaseOid'], oldSessions=0, allTagged=0, prepared=0),
        checkpoint=dict(path=str(checkpoint), readbackVerified=True, databaseRestoreVerified=True, independentBackup=False,
            manifestSha256=policy.MANIFEST_SHA, manifestRawBase64=base64.b64encode(raw).decode()))
    proof_raw = (json.dumps(proof, sort_keys=True, separators=(',', ':')) + '\n').encode()
    require(len(proof_raw) <= 16384)
    observed = dict(project='sabalanerp-local', nodeEnv='development', role='standalone', imageId=candidate,
        bootId=i['newBootId'], systemIdentifier=i['systemIdentifier'], databaseOid=i['databaseOid'], oldSessions=0,
        allTaggedSessions=0, prepared=0, publicIngress=False, externalCredentials=False, historicalActive=[], historicalIncidentEvidence=[],
        hostProof=proof, hostProofSha256=sha256(proof_raw).hexdigest())
    expected_receipt = policy.reconcile(json.loads(original), i['activeSha256'], observed)
    vars = dict(LOCAL_NATIVE_REBOOT_IMAGE_ID=candidate, LOCAL_NATIVE_REBOOT_EXPECTED_ACTIVE_SHA256=i['activeSha256'],
        LOCAL_NATIVE_REBOOT_EXPECTED_OLD_BOOT_ID=i['oldBootId'], LOCAL_NATIVE_REBOOT_HOST_PROOF_SHA256=sha256(proof_raw).hexdigest(),
        LOCAL_NATIVE_MACOS_20261118_HOST_PROOF_BASE64=base64.b64encode(proof_raw).decode())
    # JSON is valid YAML. !override is required so port 5000 is not retained.
    def overlay(file, command):
        content = 'name: sabalanerp-local\nservices:\n  backend:\n    image: ' + candidate + '\n    restart: "no"\n    ports: !override\n      - "127.0.0.1:5001:5000"\n    command: ' + json.dumps(command) + '\n    environment: ' + json.dumps(vars) + '\n'
        file.write_text(content)
        file.chmod(0o600)
    one_shot = checkpoint / 'reconcile.compose.yml'
    normal = checkpoint / 'normal.compose.yml'
    overlay(one_shot, ['sh', 'scripts/with-backend-control-ownership.sh', '--reconcile-local-reboot-macos-20261118'])
    overlay(normal, backend['Config']['Cmd'])
    # Verify the merged target before the first container replacement.
    merged = json.loads(docker([*COMPOSE, '-f', str(one_shot), 'config', '--format', 'json']))
    target = merged['services']['backend']
    require(merged['name'] == 'sabalanerp-local' and target['image'] == candidate)
    require(target['ports'] == [dict(mode='ingress', host_ip='127.0.0.1', target=5000, published='5001', protocol='tcp')])
    print('CHECKPOINT_AND_TARGET_VERIFIED', flush=True)
    docker([*COMPOSE, '-f', str(one_shot), 'up', '-d', '--no-deps', '--no-build', 'backend'], stderr=subprocess.STDOUT)
    deadline = time.monotonic() + 45
    while True:
        current = json.loads(docker(['inspect', 'sabalanerp-local-backend-1']))[0]
        require(current['Image'] == candidate)
        if current['State']['Status'] == 'exited':
            require(current['State']['ExitCode'] == 0, 'one-shot did not publish a valid receipt')
            break
        require(time.monotonic() < deadline)
        time.sleep(0.5)
    receipt_raw = docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-abandonment-macos-20261118.json'])
    require(json.loads(receipt_raw) == expected_receipt)
    require(docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-native.json']) == original)
    require(docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-history/' + i['activeSha256'] + '.json']) == original)
    try:
        docker([*COMPOSE, '-f', str(normal), 'up', '-d', '--no-deps', '--no-build', 'backend'], stderr=subprocess.STDOUT)
        deadline = time.monotonic() + 180
        while True:
            current = json.loads(docker(['inspect', 'sabalanerp-local-backend-1']))[0]
            require(current['Image'] == candidate and not current['State']['Restarting'] and current['State']['Status'] != 'exited')
            if current['State'].get('Health', {}).get('Status') == 'healthy':
                break
            require(time.monotonic() < deadline, 'backend did not become healthy; preserve checkpoint and receipts')
            time.sleep(1)
        for previous in inventory[1:]:
            require(json.loads(docker(['inspect', previous['Name']]))[0]['Id'] == previous['Id'])
        require(sorted(row['Name'] for row in current['Mounts'] if row['Type'] == 'volume') == sorted(row['Name'] for row in backend['Mounts'] if row['Type'] == 'volume'))
        require(business_fingerprints() == before, 'BUSINESS_DATA_CHANGED_DURING_STARTUP')
        verify_migration_history(checkpoint)
    except Exception as error:
        # Request the exact candidate's ordinary drain, never SIGKILL/reset/data rollback.
        failed = json.loads(docker(['inspect', 'sabalanerp-local-backend-1']))[0]
        require(failed['Image'] == candidate and failed['Config']['Labels']['com.docker.compose.project'] == 'sabalanerp-local')
        failure = dict(outcome='FAILED_CLOSED', reason=type(error).__name__, candidateId=failed['Id'], forcedTermination=False)
        (checkpoint / 'failure-held.json').write_text(json.dumps(failure, indent=2))
        if failed['State']['Running']:
            docker(['kill', '--signal=SIGTERM', failed['Id']])
        deadline = time.monotonic() + 90
        while time.monotonic() < deadline:
            current = json.loads(docker(['inspect', failed['Id']]))[0]
            if not current['State']['Running']:
                break
            time.sleep(1)
        boundary = json.loads(docker(['exec', 'sabalanerp-local-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-native.json']))
        failure.update(runtimeRunning=current['State']['Running'], nativeClosureVerified=bool(
            boundary.get('phase') == 'QUIESCENT' and boundary.get('nativeReaped') is True and boundary.get('databaseQuiet') is True))
        (checkpoint / 'failure-held.json').write_text(json.dumps(failure, indent=2))
        raise RuntimeError('LOCAL_RECOVERY_FAILED_CLOSED_RETAIN_EVIDENCE') from error
    result = dict(outcome='LOCAL_MACOS_RECONCILED', checkpoint=str(checkpoint), image=candidate,
        nativeReaped=False, externalEffectsCompleted=False, productionAdmission=False, backendHealthy=True, hostPort=5001,
        businessDataAndHistoryUnchanged=True, pendingMigrations=0, dueBusinessMutations=0)
    (checkpoint / 'execution-result.json').write_text(json.dumps(result, indent=2))
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    require(len(sys.argv) == 4 and sys.argv[1] == '--execute-local-incident')
    execute(sys.argv[2], sys.argv[3])
