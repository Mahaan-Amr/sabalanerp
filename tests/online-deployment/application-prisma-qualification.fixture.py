import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
from urllib.parse import urlsplit, urlunsplit, unquote

os.umask(0o077)
root = Path(sys.argv[1])
assert re.fullmatch(r'/app/online-runtime-acceptance/application-prisma-[a-f0-9]{32}', str(root)) and root.resolve(strict=True) == root


def check(value, message):
    if not value:
        raise RuntimeError(message)


def write(file, data, mode=0o400):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        os.fchmod(fd, mode)
        with os.fdopen(os.dup(fd), 'wb') as out:
            out.write(data); out.flush()
        os.fsync(fd)
    finally:
        os.close(fd)
    fd = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


source = urlsplit(os.environ['DATABASE_URL'])
check(source.hostname == 'postgres' and source.path == '/sabalanerp', 'PRIVATE_PRISMA_SOURCE_UNSAFE')
pg = dict(os.environ, PGHOST='postgres', PGPORT=str(source.port or 5432), PGUSER=unquote(source.username),
          PGPASSWORD=unquote(source.password), PGDATABASE='postgres', PGAPPNAME='private-prisma-qualification',
          PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000', PGTZ='UTC')


def sql(query, database='postgres'):
    value = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], env=dict(pg, PGDATABASE=database), capture_output=True)
    check(value.returncode == 0, 'PRIVATE_PRISMA_OBSERVER_FAILED')
    return value.stdout.decode().strip()


spec = importlib.util.spec_from_file_location('private_native_prisma', root / 'application-native-prisma.fixture.py')
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
shared_before = module.inventory(Path('/app/node_modules/.prisma/client'), check)
check(os.environ.get('PRISMA_PRIVATE_CAPSULE_INSTALLED') == '1', 'PRIVATE_PRISMA_CAPSULE_REQUIRED')
generated = json.loads((root / 'generated-prisma-proof.json').read_bytes())
check(generated['schemaSha256'] == hashlib.sha256((root / 'prisma-schema-source.prisma').read_bytes()).hexdigest(), 'PRIVATE_PRISMA_CAPSULE_SOURCE_MISMATCH')
check(module.inventory(root / 'node_modules/@prisma/client', check) == generated['capsule'], 'PRIVATE_PRISMA_CAPSULE_CHANGED')
identity = json.loads((root / 'database-identity.json').read_bytes())
database, oid = identity['database'], identity['oid']
check(re.fullmatch(r'qa_application_prisma_[a-f0-9]{32}', database)
      and sql("SELECT oid FROM pg_database WHERE datname='" + database + "'") == oid, 'PRIVATE_PRISMA_DATABASE_CHANGED')
environment = dict(os.environ, DATABASE_URL=urlunsplit(source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')))
module.migrate(root, database, environment, write, encoded, check)
source_inventory = json.loads((root / 'prisma-source-inventory.json').read_bytes())
actual = json.loads(sql("SELECT json_agg(json_build_object('name',migration_name,'checksum',checksum,'complete',finished_at IS NOT NULL AND rolled_back_at IS NULL) ORDER BY migration_name)::text FROM _prisma_migrations", database))
check(actual == [dict(name=row['name'], checksum=row['sha256'], complete=True) for row in source_inventory['migrations']], 'PRIVATE_PRISMA_HISTORY_NOT_EXACT')
shared_after = module.inventory(Path('/app/node_modules/.prisma/client'), check)
check(shared_after == shared_before, 'PRIVATE_PRISMA_SHARED_CLIENT_CHANGED')
check(module.inventory(root / 'node_modules/@prisma/client', check) == generated['capsule'], 'PRIVATE_PRISMA_CAPSULE_CHANGED')
check(sql("SELECT count(*) FROM pg_stat_activity WHERE datname='" + database + "'") == '0'
      and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='" + database + "'") == '0'
      and sql("SELECT oid FROM pg_database WHERE datname='" + database + "'") == oid, 'PRIVATE_PRISMA_DATABASE_NOT_QUIET')
sql('DROP DATABASE "' + database + '"')
check(sql("SELECT count(*) FROM pg_database WHERE datname='" + database + "'") == '0', 'PRIVATE_PRISMA_DATABASE_NOT_RETIRED')
print(json.dumps(dict(**{'pass': True}, productionAdmission=False, generated=generated, migrationCount=len(actual),
    nativeClosure=json.loads((root / 'initial-migration-closure.json').read_bytes()), databaseRetiredWithoutForce=True,
    originalDatabaseOid=oid, sharedClientUnchanged=True, sharedClientInventory=shared_after)))
