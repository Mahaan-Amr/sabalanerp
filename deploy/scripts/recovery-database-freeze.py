#!/usr/bin/env python3
"""A real PostgreSQL write boundary; no installation trigger or extra pool.

Used by the private coherent-capture controller while its native file/Inquiry
gate is exclusively held. SHARE table locks survive a lost client until the
server actually completes the transaction. These locks alone do not fence
application files, native children, DDL owners or SQLite, and grant no release
or healthy-recovery authority.
"""
import json
import hashlib
import os
import re
import select
import stat
import subprocess
import time
import uuid
from urllib.parse import unquote, urlsplit


def fail(code):
    raise RuntimeError(code)


def native_capture_namespace(source_url, gate_fd):
    keys = ('BACKEND_NATIVE_POSTGRES_APPLICATION_NAME', 'BACKEND_NATIVE_AUTHORITY_FILE',
            'BACKEND_NATIVE_CLAIM_SHA256')
    capture_keys = ('BACKEND_CAPTURE_GATE_FD', 'BACKEND_CAPTURE_GATE_FILE',
                    'BACKEND_CAPTURE_GATE_DEVICE', 'BACKEND_CAPTURE_GATE_INODE')
    if not any(key in os.environ for key in keys + capture_keys) and os.environ.get('BACKEND_RUNTIME_ROLE') != 'control':
        return None
    try:
        if (not all(os.environ.get(key) for key in keys) or gate_fd != 10
                or os.environ.get('BACKEND_RUNTIME_ROLE') != 'control'
                or os.environ.get('BACKEND_CONTROL_LOCK_FD') != '9'):
            fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        directory = os.environ['RECOVERY_COORDINATION_DIR']
        file = os.path.join(directory, 'deployment-runtime-native.json')
        parent = os.lstat(directory)
        if (os.environ[keys[1]] != file or os.path.realpath(file) != file
                or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != os.geteuid()
                or parent.st_mode & 0o022):
            fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        try:
            before = os.fstat(fd)
            if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid()
                    or before.st_nlink != 1 or before.st_mode & 0o077 or not 0 < before.st_size <= 16384):
                fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
            raw = os.read(fd, 16385)
            after, named = os.fstat(fd), os.lstat(file)
            if ((before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns)
                    != (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns)
                    or (named.st_dev, named.st_ino) != (before.st_dev, before.st_ino)
                    or hashlib.sha256(raw).hexdigest() != os.environ[keys[2]]):
                fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
            claim = json.loads(raw)
        finally:
            os.close(fd)
        namespace = os.environ[keys[0]]
        if (claim['format'] != 'sabalan-runtime-native/v1' or claim['phase'] != 'ACTIVE'
                or claim['role'] != 'control' or claim['namespace'] != namespace
                or not re.fullmatch(r'sabalan-rt-[a-f0-9]{48}', namespace)
                or claim['captureGate']['descriptor'] != gate_fd
                or claim['guardian']['pidNamespace'] != os.readlink('/proc/self/ns/pid')):
            fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        with open('/proc/sys/kernel/random/boot_id') as source:
            if claim['guardian']['bootId'] != source.read().strip():
                fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        for descriptor, expected in ((9, claim['lock']), (10, claim['captureGate'])):
            value = os.fstat(descriptor)
            named_file = os.readlink('/proc/self/fd/' + str(descriptor))
            named = os.lstat(named_file)
            if (str(value.st_dev) != expected['device'] or str(value.st_ino) != expected['inode']
                    or not stat.S_ISREG(value.st_mode) or value.st_nlink != 1 or value.st_uid != os.geteuid()
                    or value.st_mode & 0o022 or os.path.realpath(named_file) != named_file
                    or (named.st_dev, named.st_ino) != (value.st_dev, value.st_ino)):
                fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
            with open('/proc/self/fdinfo/' + str(descriptor)) as details:
                if not re.search(r'^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
                                 + str(value.st_ino) + r'\s+0\s+EOF\s*$', details.read(), re.M):
                    fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        if (os.readlink('/proc/self/fd/9') != os.path.join(directory, 'deployment-runtime-control.lock')
                or os.readlink('/proc/self/fd/10') != claim['captureGate']['file']):
            fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        pid, found = os.getpid(), False
        for _ in range(32):
            with open('/proc/' + str(pid) + '/stat') as process:
                fields = process.read().rsplit(') ', 1)[1].split()
            if pid == claim['guardian']['pid']:
                found = fields[19] == claim['guardian']['startTicks']
                break
            pid = int(fields[1])
            if pid <= 0:
                break
        source = urlsplit(source_url)
        if (not found or source.hostname != claim['connection']['host']
                or (source.port or 5432) != claim['connection']['port']
                or unquote(source.username or '') != claim['connection']['user']
                or unquote(source.path[1:]) != claim['initialDatabase']['name']):
            fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')
        return namespace
    except Exception:
        fail('RECOVERY_DATABASE_NATIVE_AUTHORITY_UNPROVEN')


def postgres_environment(source_url, namespace):
    parsed = urlsplit(source_url)
    if (parsed.scheme not in ('postgres', 'postgresql') or not parsed.hostname
            or not parsed.path.startswith('/') or len(parsed.path) < 2 or parsed.fragment
            or not re.fullmatch(r'(?:sabalan-freeze-|sabalan-rt-)[a-f0-9]{48}', namespace)):
        fail('RECOVERY_DATABASE_CONNECTION_INVALID')
    # libpq does not accept Prisma's pool/schema query parameters. No inherited
    # PGOPTIONS, service file or PGHOST may silently select another database.
    from urllib.parse import parse_qsl
    if any(key not in ('schema', 'connection_limit', 'pool_timeout', 'application_name')
           for key, _ in parse_qsl(parsed.query, strict_parsing=True)):
        fail('RECOVERY_DATABASE_CONNECTION_INVALID')
    environment = {key: value for key, value in os.environ.items() if not key.startswith('PG')}
    environment.update(PGHOST=parsed.hostname, PGPORT=str(parsed.port or 5432),
                       PGUSER=unquote(parsed.username or ''), PGPASSWORD=unquote(parsed.password or ''),
                       PGDATABASE=unquote(parsed.path[1:]), PGAPPNAME=namespace,
                       PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=10000 -c lock_timeout=250 -c search_path=pg_catalog')
    return environment


class DatabaseFreeze:
    def __init__(self, source_url, gate_fd, assert_gate, diagnostic_fd):
        self.namespace = native_capture_namespace(source_url, gate_fd) or ('sabalan-freeze-' + uuid.uuid4().hex + uuid.uuid4().hex[:16])
        self.environment = postgres_environment(source_url, self.namespace)
        self.assert_gate, self.gate_fd = assert_gate, gate_fd
        assert_gate()
        self.closed, self.frozen = False, False
        self.process = subprocess.Popen(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'],
                                        stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=diagnostic_fd,
                                        env=self.environment, pass_fds=(gate_fd,), bufsize=0)
        self.buffer = b''

    def command(self, sql, seconds=12):
        if self.closed or self.process.poll() is not None:
            fail('RECOVERY_DATABASE_NATIVE_OWNER_ENDED')
        self.assert_gate()
        marker = uuid.uuid4().hex
        statement = sql + "\nSELECT json_build_object('captureFrame','" + marker + "')::text;\n"
        pending = memoryview(statement.encode('utf8'))
        while pending:
            written = self.process.stdin.write(pending)
            if not written:
                fail('RECOVERY_DATABASE_NATIVE_WRITE_INCOMPLETE')
            pending = pending[written:]
        self.process.stdin.flush()
        deadline, rows = time.monotonic() + seconds, []
        while True:
            while b'\n' in self.buffer:
                line, self.buffer = self.buffer.split(b'\n', 1)
                if not line.strip():
                    continue
                try:
                    value = json.loads(line)
                except (ValueError, UnicodeError):
                    fail('RECOVERY_DATABASE_PROTOCOL_INVALID')
                if value == {'captureFrame': marker}:
                    self.assert_gate()
                    return rows
                rows.append(value)
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                fail('RECOVERY_DATABASE_NATIVE_DEADLINE')
            ready, _, _ = select.select([self.process.stdout], [], [], min(remaining, 0.1))
            self.assert_gate()
            if ready:
                chunk = os.read(self.process.stdout.fileno(), 262144)
                if not chunk:
                    fail('RECOVERY_DATABASE_NATIVE_COMMAND_FAILED')
                self.buffer += chunk
                if len(self.buffer) > 4 * 1024 * 1024:
                    fail('RECOVERY_DATABASE_PROTOCOL_CAPACITY')

    def acquire(self, expected_system_identifier, expected_database):
        if self.frozen:
            fail('RECOVERY_DATABASE_ALREADY_FROZEN')
        self.expected = (expected_system_identifier, expected_database)
        rows = self.command('''BEGIN;
SET LOCAL statement_timeout = '10000ms';
SET LOCAL lock_timeout = '250ms';
SET LOCAL idle_in_transaction_session_timeout = '120s';
SELECT json_build_object('database',current_database(),'systemIdentifier',system_identifier::text,
 'pid',pg_backend_pid(),'prepared',(SELECT count(*) FROM pg_prepared_xacts),
 'databaseOid',(SELECT oid::text FROM pg_database WHERE datname=current_database()),
 'transactionId',pg_current_xact_id()::text,'inRecovery',pg_is_in_recovery(),
 'otherSchemaRelations',(SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE c.relkind IN ('r','p','f') AND n.nspname NOT IN ('public','information_schema') AND n.nspname !~ '^pg_'),
 'visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE')
 FROM pg_roles WHERE rolname=current_user))::text FROM pg_control_system();
DO $$ BEGIN PERFORM pg_advisory_xact_lock(741936426::bigint); END $$;
''')
        if (len(rows) != 1 or rows[0]['database'] != expected_database
                or rows[0]['systemIdentifier'] != expected_system_identifier or rows[0]['prepared'] != 0
                or rows[0]['visible'] is not True or rows[0]['inRecovery'] is not False
                or rows[0]['otherSchemaRelations'] != 0):
            fail('RECOVERY_DATABASE_IDENTITY_UNPROVEN')
        self.identity = rows[0]
        inventory = self._inventory()
        if not inventory:
            fail('RECOVERY_DATABASE_INVENTORY_EMPTY')
        # Lock ONLY every actual native relation. Partitions and children appear
        # independently; cross-schema inheritance/foreign tables are refused.
        for item in inventory:
            if (not re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}', item['name'])
                    or item['kind'] not in ('r', 'p') or item['foreignInheritance']):
                fail('RECOVERY_DATABASE_INVENTORY_UNSUPPORTED')
        self.command('LOCK TABLE ' + ','.join('ONLY "public"."' + item['name'] + '"'
                                            for item in inventory) + ' IN SHARE MODE;')
        if self._inventory() != inventory:
            fail('RECOVERY_DATABASE_INVENTORY_CHANGED')
        self.inventory, self.frozen = inventory, True
        self.assert_frozen()
        return dict(self.identity, relations=len(inventory), namespace=self.namespace)

    def assert_frozen(self):
        if not self.frozen:
            fail('RECOVERY_DATABASE_CAPTURE_NOT_OWNED')
        result = self.command('''SELECT json_build_object('database',current_database(),
 'pid',pg_backend_pid(),'transactionId',pg_current_xact_id()::text,
 'namespace',current_setting('application_name'),
 'relations',(SELECT coalesce(json_agg(relation::text ORDER BY relation),'[]'::json) FROM pg_locks
 WHERE pid=pg_backend_pid() AND locktype='relation' AND mode='ShareLock' AND granted
 AND database=(SELECT oid FROM pg_database WHERE datname=current_database())),
 'migrationLock',EXISTS(SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid() AND locktype='advisory'
 AND classid=0 AND objid=741936426 AND objsubid=1 AND mode='ExclusiveLock' AND granted))::text;''')
        if (len(result) != 1 or result[0]['database'] != self.identity['database']
                or result[0]['pid'] != self.identity['pid']
                or result[0]['transactionId'] != self.identity['transactionId']
                or result[0]['namespace'] != self.namespace or result[0]['migrationLock'] is not True
                or not {item['oid'] for item in self.inventory}.issubset(set(result[0]['relations']))):
            fail('RECOVERY_DATABASE_LOCK_OWNERSHIP_UNPROVEN')
        return result[0]

    def _inventory(self):
        rows = self.command('''SELECT coalesce(json_agg(json_build_object(
 'name',c.relname,'kind',c.relkind,'oid',c.oid::text,
 'foreignInheritance',EXISTS(SELECT 1 FROM pg_inherits i JOIN pg_class other
 ON other.oid=CASE WHEN i.inhrelid=c.oid THEN i.inhparent ELSE i.inhrelid END
 JOIN pg_namespace onsp ON onsp.oid=other.relnamespace
 WHERE (i.inhrelid=c.oid OR i.inhparent=c.oid) AND onsp.nspname <> 'public'))
 ORDER BY c.relname COLLATE "C"),'[]'::json)::text
 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relkind IN ('r','p','f');''')
        if len(rows) != 1 or not isinstance(rows[0], list) or len(rows[0]) > 2048:
            fail('RECOVERY_DATABASE_INVENTORY_UNPROVEN')
        return rows[0]

    def restore_point(self, capture_id):
        if not self.frozen or not re.fullmatch(r'[a-f0-9]{48}', capture_id):
            fail('RECOVERY_DATABASE_CAPTURE_NOT_OWNED')
        self.assert_frozen()
        if self._inventory() != self.inventory:
            fail('RECOVERY_DATABASE_INVENTORY_CHANGED')
        name = 'sabalan-' + capture_id
        rows = self.command("SELECT json_build_object('name','" + name + "','lsn',"
                            "pg_create_restore_point('" + name + "')::text)::text;")
        if len(rows) != 1 or rows[0].get('name') != name or not re.fullmatch(r'[0-9A-F]+/[0-9A-F]+', rows[0].get('lsn', '')):
            fail('RECOVERY_DATABASE_RESTORE_POINT_UNPROVEN')
        point = rows[0]
        details = self.command("SELECT json_build_object('walFile',pg_walfile_name('" + point['lsn']
                               + "'::pg_lsn),'segmentBytes',pg_size_bytes(current_setting('wal_segment_size'))," 
                               "'serverVersion',current_setting('server_version_num'))::text;")
        if (len(details) != 1 or not re.fullmatch(r'[0-9A-F]{24}', details[0]['walFile'])
                or not isinstance(details[0]['segmentBytes'], int)
                or not 1024**2 <= details[0]['segmentBytes'] <= 1024**3
                or details[0]['segmentBytes'] & (details[0]['segmentBytes'] - 1)):
            fail('RECOVERY_DATABASE_WAL_IDENTITY_UNPROVEN')
        point.update(details[0])
        required_end = int(point['walFile'][8:16], 16) * 2**32 + (int(point['walFile'][16:], 16) + 1) * point['segmentBytes']
        point['requiredWalEndLsn'] = format(required_end >> 32, 'X') + '/' + format(required_end & 0xffffffff, 'X')
        # Finish and flush the containing WAL segment before advertising its
        # end. Retrieval/encryption/independent replay remain separate gates.
        result = self.command("SELECT json_build_object('switchLsn',pg_switch_wal()::text)::text;"
                              "SELECT json_build_object('flushLsn',pg_current_wal_flush_lsn()::text)::text;")
        lsn = lambda value: int(value.split('/')[0], 16) * 2**32 + int(value.split('/')[1], 16)
        if len(result) != 2 or lsn(result[1]['flushLsn']) < lsn(point['lsn']):
            fail('RECOVERY_DATABASE_WAL_NOT_FLUSHED')
        self.assert_frozen()
        return dict(point, **result[0], **result[1])

    def close(self, commit=False):
        if self.closed:
            fail('RECOVERY_DATABASE_ALREADY_CLOSED')
        command_error = None
        try:
            if self.process.poll() is None:
                try:
                    self.command('COMMIT;' if commit else 'ROLLBACK;')
                except Exception as error:
                    command_error = error
                finally:
                    self.process.stdin.close()
            # Actual native reaping is mandatory; a deadline is not permission
            # to kill the client and declare that server work has completed.
            code = self.process.wait()
            self.closed = True
            self.process.stdout.close()
            if not self.process.stdin.closed:
                self.process.stdin.close()
            # psql exit does not prove that its server transaction has ended.
            # Observe the exact random namespace freshly, with full visibility,
            # until the actual backend has gone. Never terminate another SQL
            # backend or resolve prepared work to manufacture completion.
            self._observe_closed()
            if commit and code != 0:
                fail('RECOVERY_DATABASE_NATIVE_COMMAND_FAILED')
            if command_error is not None:
                raise command_error
            self.assert_gate()
            return code
        finally:
            self.frozen = False

    def _observe_closed(self):
        if not hasattr(self, 'expected'):
            fail('RECOVERY_DATABASE_CLOSE_IDENTITY_UNPROVEN')
        deadline = time.monotonic() + 15
        environment = dict(self.environment, PGAPPNAME='sabalan-freeze-observer-' + uuid.uuid4().hex)
        query = """SELECT json_build_object('database',current_database(),
 'systemIdentifier',system_identifier::text,
 'visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','USAGE')
 FROM pg_roles WHERE rolname=current_user),
 'sessions',(SELECT count(*) FROM pg_stat_activity WHERE application_name='%s'),
 'prepared',(SELECT count(*) FROM pg_prepared_xacts))::text FROM pg_control_system();""" % self.namespace
        while True:
            self.assert_gate()
            observer = subprocess.run(['psql', '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1', '-c', query],
                                      env=environment, pass_fds=(self.gate_fd,),
                                      stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            if observer.returncode != 0:
                fail('RECOVERY_DATABASE_CLOSE_OBSERVER_FAILED')
            try:
                value = json.loads(observer.stdout)
            except (ValueError, UnicodeError):
                fail('RECOVERY_DATABASE_CLOSE_OBSERVER_FAILED')
            if (value.get('database') != self.expected[1] or value.get('systemIdentifier') != self.expected[0]
                    or value.get('visible') is not True or value.get('prepared') != 0):
                fail('RECOVERY_DATABASE_CLOSE_IDENTITY_UNPROVEN')
            if value.get('sessions') == 0:
                self.assert_gate()
                return
            if time.monotonic() >= deadline:
                fail('RECOVERY_DATABASE_SQL_COMPLETION_UNPROVEN')
            time.sleep(0.025)
