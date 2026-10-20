"""Own a fresh empty diagnostic database and pure private client generation."""
import fcntl
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from urllib.parse import unquote, urlsplit, urlunsplit

root = Path(sys.argv[1]); os.umask(0o077); os.chdir(root)
assert re.fullmatch(r'/tmp/application-prisma-[a-f0-9]{32}', str(root))
database = 'qa_application_prisma_' + root.name.rsplit('-', 1)[1]
source = urlsplit(os.environ['DATABASE_URL'])
assert source.hostname == 'postgres' and source.path == '/sabalanerp'
pg = dict(PATH=os.environ['PATH'], PGHOST='postgres', PGPORT=str(source.port or 5432),
          PGUSER=unquote(source.username), PGPASSWORD=unquote(source.password), PGDATABASE='postgres',
          PGAPPNAME='private-prisma-generation-setup', PGCONNECT_TIMEOUT='5',
          PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=1000')
def sql(query):
    value = subprocess.run(['psql', '-X', '-qAt', '-v', 'ON_ERROR_STOP=1', '-c', query], env=pg, capture_output=True)
    assert value.returncode == 0, 'PRIVATE_DATABASE_SETUP_FAILED'
    return value.stdout.decode().strip()
def write(file, value):
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o400)
    try: os.write(fd, (json.dumps(value, sort_keys=True) + '\n').encode()); os.fsync(fd)
    finally: os.close(fd)
    fd = os.open(file.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(fd)
    finally: os.close(fd)
sql('CREATE DATABASE "' + database + '"')
write(root / 'database-identity.json', dict(database=database, oid=sql("SELECT oid FROM pg_database WHERE datname='" + database + "'")))
coordination = root / 'generation-coordination'; coordination.mkdir(mode=0o700)
lock = coordination / 'deployment-runtime-control.lock'
fd = os.open(lock, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
retained = fcntl.fcntl(fd, fcntl.F_DUPFD_CLOEXEC, 16)
os.dup2(retained, 9, inheritable=True); os.close(retained)
if fd != 9: os.close(fd)
environment = dict(PATH=os.environ['PATH'], HOME=str(root), NODE_PATH='/app/node_modules', NODE_OPTIONS='--max-old-space-size=512',
    PRISMA_PRIVATE_HOST_ARTIFACT='1',
    DATABASE_URL=urlunsplit(source._replace(path='/' + database, query='connection_limit=2&pool_timeout=10')),
    RECOVERY_COORDINATION_DIR=str(coordination), BACKEND_RUNTIME_ROLE='control',
    BACKEND_CONTROL_LOCK_FD='9', BACKEND_CONTROL_LOCK_FILE=str(lock))
os.execvpe('python3', ['python3', '-I', '-B', str(root / 'backend-runtime-owner.py'),
    'python3', '-I', '-B', str(root / 'generate.py'), str(root)], environment)
