#!/usr/bin/env python3
"""Checkpoint one pinned Mac development incident; never grants runtime admission."""
import hashlib
import json
import os
from pathlib import Path
import secrets
import subprocess
import tarfile

PROJECT = 'sabalanerp-local'
CONTAINER = 'c3ebceb803fdbdb1d41a3c4dc93d911d408a03bea3021cc8778b39d2c63985d1'
ACTIVE = 'bf714032489da8a47d2a0b741ed4236bcdd09d2aedbac193c836b4d5ae7dcd0a'
BOOT = 'b11f2794-d50a-40b9-beb5-26e49d60e672'
COMPOSE = ['compose', '-f', 'docker-compose.local.yml']


def require(condition, message='LOCAL_MACOS_RECOVERY_PREFLIGHT_FAILED'):
    if not condition:
        raise RuntimeError(message)


def docker(args, **kwargs):
    status = subprocess.check_output(['docker', *COMPOSE, 'ps', '--format', 'json'], text=True)
    rows = [json.loads(line) for line in status.splitlines() if line.strip()]
    require(rows and all(row['Project'] == PROJECT for row in rows))
    return subprocess.run(['docker', *args], check=True, **kwargs)


def output(args):
    return docker(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE).stdout


def sha(file):
    digest = hashlib.sha256()
    with file.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def capture():
    os.umask(0o077)
    parent = Path.home() / 'Documents' / 'SabalanERP-local-recovery'
    parent.mkdir(mode=0o700, exist_ok=True)
    require(not parent.is_symlink() and parent.resolve() == parent)
    root = parent / ('20261118-macos-' + secrets.token_hex(6))
    root.mkdir(mode=0o700)
    names = ['backend', 'frontend', 'inquiry', 'postgres', 'redis']
    inventory = json.loads(output(['inspect', *[PROJECT + '-' + name + '-1' for name in names]]))
    by_name = {row['Name'].split('-')[-2]: row for row in inventory}
    backend = by_name['backend']
    require(backend['Id'] == CONTAINER and backend['State']['Restarting'])
    require(all(row['Config']['Labels']['com.docker.compose.project'] == PROJECT for row in inventory))
    env = dict(entry.split('=', 1) for entry in backend['Config']['Env'] if '=' in entry)
    require(env['NODE_ENV'] == 'development' and env['SMS_IR_ENVIRONMENT'] == 'sandbox')
    require(not any(env.get(key) for key in ['SMS_IR_API_KEY', 'WEB_PUSH_VAPID_PRIVATE_KEY',
        'TAXPAYER_DELIVERY_BROKER_ENDPOINT', 'TAXPAYER_BROKER_URL', 'TAXPAYER_BROKER_TOKEN',
        'TAXPAYER_API_KEY', 'ACCOUNTING_RECONCILIATION_URL']))
    for row in inventory:
        for bindings in (row['HostConfig'].get('PortBindings') or {}).values():
            require(all(binding['HostIp'] == '127.0.0.1' for binding in bindings or []))
    active = output(['exec', PROJECT + '-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-native.json'])
    require(hashlib.sha256(active).hexdigest() == ACTIVE)
    require(output(['exec', PROJECT + '-inquiry-1', 'cat', '/proc/sys/kernel/random/boot_id']).decode().strip() == BOOT)
    sql = "SELECT system_identifier::text, (SELECT oid FROM pg_database WHERE datname='sabalanerp'), (SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sabalan-rt-%'), (SELECT count(*) FROM pg_prepared_xacts) FROM pg_control_system()"
    observation = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'postgres', '-c', sql]).decode().strip()
    require(observation == '7675633270579748899|407395|0|0')
    disk = os.statvfs(root)
    require(disk.f_bavail * disk.f_frsize > 8 * 1024 ** 3)
    entries = []

    def record(name, args=None, raw=None):
        file = root / name
        with file.open('xb') as stream:
            if raw is not None:
                stream.write(raw)
            else:
                docker(args, stdout=stream, stderr=subprocess.PIPE)
            stream.flush()
            os.fsync(stream.fileno())
        require(file.stat().st_size > 0)
        entries.append(dict(name=name, bytes=file.stat().st_size, sha256=sha(file)))
        print(name, file.stat().st_size, flush=True)
        return file

    record('original-active.json', raw=active)
    record('container-inspect.private.json', raw=json.dumps(inventory).encode())
    record('backend-old-rootfs.tar', ['export', CONTAINER])
    dump = record('postgres-sabalanerp.dump', ['exec', PROJECT + '-postgres-1', 'pg_dump', '-U', 'postgres', '-d', 'sabalanerp', '-Fc'])
    mounts = {}
    for service in ['backend', 'inquiry', 'redis']:
        for mount in by_name[service]['Mounts']:
            if mount['Type'] == 'volume':
                mounts.setdefault(mount['Name'], (by_name[service]['Id'], mount['Destination']))
    for name, (container, directory) in sorted(mounts.items()):
        archive = record('volume-' + name + '.tar', ['cp', container + ':' + directory, '-'])
        with tarfile.open(archive) as stream:
            for member in stream:
                if member.isfile():
                    body = stream.extractfile(member)
                    while body.read(1024 * 1024):
                        pass
    nonce = secrets.token_hex(8)
    sqlite_path, redis_path = '/tmp/checkpoint-' + nonce + '.db', '/tmp/checkpoint-' + nonce + '.rdb'
    staged_dump = '/tmp/checkpoint-' + nonce + '.dump'
    restored = 'sabalanerp_recovery_verify_' + nonce
    restored_created = False
    try:
        output(['exec', PROJECT + '-inquiry-1', 'sqlite3', '/data/inquiry.db', '.backup ' + sqlite_path])
        require(output(['exec', PROJECT + '-inquiry-1', 'sqlite3', sqlite_path, 'PRAGMA integrity_check;']).strip() == b'ok')
        record('inquiry-consistent.db', ['exec', PROJECT + '-inquiry-1', 'cat', sqlite_path])
        output(['exec', PROJECT + '-redis-1', 'redis-cli', '--rdb', redis_path])
        require(b'RDB looks OK' in output(['exec', PROJECT + '-redis-1', 'redis-check-rdb', redis_path]))
        record('redis-consistent.rdb', ['exec', PROJECT + '-redis-1', 'cat', redis_path])
        output(['cp', str(dump), PROJECT + '-postgres-1:' + staged_dump])
        require(output(['exec', PROJECT + '-postgres-1', 'sha256sum', staged_dump]).decode().split()[0] == sha(dump))
        output(['exec', PROJECT + '-postgres-1', 'pg_restore', '--list', staged_dump])
        output(['exec', PROJECT + '-postgres-1', 'createdb', '-U', 'postgres', restored])
        restored_created = True
        # This development database already contains orphan fixture rows. Restore
        # its exact state, including existing constraints, without repairing or
        # deleting source data. Trigger suspension is confined to this disposable
        # restore database; all constraints/triggers are enabled again afterwards.
        for section in ['pre-data', 'post-data', 'data']:
            output(['exec', PROJECT + '-postgres-1', 'pg_restore', '--exit-on-error', '--no-owner',
                '--section=' + section, *(['--disable-triggers'] if section == 'data' else []),
                '-U', 'postgres', '-d', restored, staged_dump])
        tables_sql = "SELECT json_build_object('tables',(SELECT count(*) FROM information_schema.tables WHERE table_schema='public'),'contracts',(SELECT count(*) FROM sales_contracts),'financialRecords',(SELECT count(*) FROM accounting_financial_records),'audit',(SELECT count(*) FROM accounting_audit_logs))"
        original_counts = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', tables_sql])
        restored_counts = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', restored, '-c', tables_sql])
        require(original_counts == restored_counts)
        fingerprints = {}
        for table in ['sales_contracts', 'accounting_financial_records', 'accounting_audit_logs',
                'accounting_receivables', 'accounting_payment_statuses', 'accounting_tax_records',
                'partner_sale_cases', 'partner_case_revisions', 'crm_customer_cards', 'crm_customers']:
            sql = 'SELECT count(*), md5(coalesce(string_agg(row_hash,\'\' ORDER BY row_hash),\'\')) FROM (SELECT md5(to_jsonb(t)::text) row_hash FROM "' + table + '" t) rows'
            source_hash = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', sql]).decode().strip()
            restore_hash = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', restored, '-c', sql]).decode().strip()
            require(source_hash == restore_hash, table)
            fingerprints[table] = source_hash
        orphan_sql = 'SELECT count(*) FROM crm_customer_cards c LEFT JOIN crm_customers p ON p.id=c."customerId" WHERE p.id IS NULL'
        orphans = output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', orphan_sql]).decode().strip()
        require(orphans == output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', restored, '-c', orphan_sql]).decode().strip())
        trigger_sql = "SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgenabled='D'"
        require(output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', 'sabalanerp', '-c', trigger_sql]) == output(['exec', PROJECT + '-postgres-1', 'psql', '-XqtA', '-U', 'postgres', '-d', restored, '-c', trigger_sql]))
        record('restore-verification.json', raw=json.dumps(dict(counts=json.loads(original_counts),
            fingerprints=fingerprints, existingCrmOrphans=int(orphans), sourceRepaired=False,
            restoreMethod='schema-and-constraints-before-data', triggersReenabled=True)).encode())
    finally:
        if restored_created:
            output(['exec', PROJECT + '-postgres-1', 'dropdb', '-U', 'postgres', restored])
        for service, file in [('postgres', staged_dump), ('inquiry', sqlite_path), ('redis', redis_path)]:
            output(['exec', PROJECT + '-' + service + '-1', 'rm', '-f', '--', file])
    require(output(['exec', PROJECT + '-inquiry-1', 'cat', '/app/recovery-coordination/deployment-runtime-native.json']) == active)
    manifest = dict(format='sabalan-macos-local-incident-checkpoint/v1', project=PROJECT,
        activeSha256=ACTIVE, backendContainerId=CONTAINER, oldImageId=backend['Image'], observedBootId=BOOT,
        clusterIdentifier='7675633270579748899', databaseOid='407395', checkpointPurpose='LOCAL_DEVELOPMENT_RECOVERY',
        independentBackup=False, productionAdmission=False, databaseRestoreVerified=True,
        sqliteIntegrityVerified=True, redisIntegrityVerified=True, volumeNames=sorted(mounts), entries=entries)
    manifest_path = root / 'manifest.json'
    manifest_path.write_text(json.dumps(manifest, sort_keys=True, separators=(',', ':')) + '\n')
    for entry in entries:
        require(sha(root / entry['name']) == entry['sha256'])
    descriptor = os.open(root, os.O_RDONLY)
    os.fsync(descriptor)
    os.close(descriptor)
    print(json.dumps(dict(checkpoint=str(root), manifestSha256=sha(manifest_path), restoreVerified=True)), flush=True)


if __name__ == '__main__':
    capture()
