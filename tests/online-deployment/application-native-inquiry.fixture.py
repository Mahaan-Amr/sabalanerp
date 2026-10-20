"""Real compiled Inquiry actors joined to the enclosing native backend cohort.

The caller provisions immutable v2 grants in the original source/restored
cohorts. This helper never issues a scope, replaces an admission record, invokes
a PostgreSQL client or declares a recovery point healthy.
"""
import base64
import hashlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import sqlite3
import stat
import subprocess
import tarfile
import time
import urllib.request


class InquiryActors:
    def __init__(self, root, index, environment, write, check):
        self.outer = Path(root)
        check(re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}', str(self.outer)), 'INQUIRY_PARENT_ROOT_INVALID')
        self.root = self.outer / 'inquiry'
        self.index, self.base_env, self.write, self.check = index, environment, write, check
        self.grants = index['inquiryGrants']
        check(set(self.grants) == {'source', 'restored'}, 'INQUIRY_GRANTS_INCOMPLETE')
        for grant in self.grants.values():
            scope = grant['scope']
            check(scope['format'] == 'sabalan-online-runtime-scope/v2' and scope['purpose'] == 'http'
                  and scope['role'] == 'serving' and scope['worker'] is None and 'admission' in scope, 'INQUIRY_SCOPE_INVALID')
        source_scope = self.grants['source']['scope']
        capture = next(grant['scope'] for grant in index['grants'] if grant['scope']['purpose'] == 'capture')
        for field in ['coordinationDirectory', 'gate', 'interlock', 'database', 'admission']:
            check(source_scope[field] == capture[field], 'INQUIRY_NOT_IN_SOURCE_COHORT')
        restored_scope = index['restoredGrant']['scope']
        check(restored_scope['format'] == 'sabalan-online-runtime-scope/v2', 'INQUIRY_RESTORED_BACKEND_COHORT_NOT_V2')
        for field in ['coordinationDirectory', 'gate', 'interlock', 'database', 'admission']:
            check(self.grants['restored']['scope'][field] == restored_scope[field], 'INQUIRY_NOT_IN_RESTORED_COHORT')
        self.actors, self.clients, self.closures = {}, {}, {}

    def wait(self, predicate, message, seconds=60):
        end = time.monotonic() + seconds
        while not predicate():
            self.check(time.monotonic() < end, message)
            time.sleep(0.02)

    def native(self, name):
        file = Path(self.grants[name]['scope']['nativeDirectory']) / 'deployment-runtime-native.json'
        raw = file.read_bytes()
        return raw, json.loads(raw)

    def work(self, name):
        return json.loads((Path(self.grants[name]['scope']['boundaryDirectory']) / 'state.json').read_bytes())

    def inventory(self):
        result = subprocess.run(['/usr/local/bin/node', '-e', (self.outer / 'inquiry-dependency-inventory.cjs').read_text(),
                                 self.custody['dependency']['retainedDependencies']], stdin=subprocess.DEVNULL, capture_output=True)
        self.check(result.returncode == 0, 'INQUIRY_DEPENDENCY_INVENTORY_FAILED')
        observed = json.loads(result.stdout)
        expected = {key: self.custody['dependency'][key] for key in ['entries', 'bytes', 'inventorySha256']}
        self.check(observed == expected, 'INQUIRY_DEPENDENCY_CHANGED')
        return observed

    def prepare_source(self):
        self.custody = json.loads((self.outer / 'inquiry-custody.json').read_bytes())
        for name, expected in self.custody['sourceHashes'].items():
            self.check(hashlib.sha256((self.outer / name).read_bytes()).hexdigest() == expected, 'INQUIRY_CAPTURED_SOURCE_CHANGED')
        closure = self.custody['originalDependencyClosure']
        old_root = Path(closure['directory'])
        self.check(str(old_root) == '/app/online-runtime-acceptance/inquiry-coherent-7878c93646acd9ac37cef95e27a4029d', 'INQUIRY_DEPENDENCY_OWNER_ROOT_CHANGED')
        old_config = json.loads((old_root / 'prepared.json').read_bytes())
        locks = []
        try:
            for name in ['deployment-online-worker.lock', 'deployment-runtime-control.lock', 'deployment-write-admission.lock']:
                descriptor = os.open(old_root / 'coordination' / name, os.O_RDONLY | os.O_NOFOLLOW)
                locks.append(descriptor)
                fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
            for name, expected in closure['nativeSha256'].items():
                raw = (Path(old_config[name]['nativeDirectory']) / 'deployment-runtime-native.json').read_bytes()
                native = json.loads(raw)
                self.check(hashlib.sha256(raw).hexdigest() == expected and native['phase'] == 'QUIESCENT'
                    and native['nativeReaped'] is True and not Path('/proc/' + str(native['guardian']['pid'])).exists(), 'INQUIRY_DEPENDENCY_OWNER_NOT_CLOSED')
                self.check(native.get('databaseQuiet') is True if name == 'capture' else native.get('sqliteNativeClosed') is True,
                           'INQUIRY_DEPENDENCY_NATIVE_CLOSURE_UNPROVEN')
            self.inventory()
        finally:
            for descriptor in locks:
                os.close(descriptor)
        space = os.statvfs(self.outer)
        self.check(space.f_bavail * space.f_frsize >= 2 * 256*1024**2 + 512*1024**2, 'INQUIRY_CODE_EXTRACTION_CAPACITY')
        self.root.mkdir(mode=0o700)
        app = self.root / 'app'
        app.mkdir(mode=0o700)
        os.symlink(self.custody['dependency']['retainedDependencies'], app / 'node_modules')
        runtime = app / 'online-runtime'
        runtime.mkdir(mode=0o700)
        (runtime / 'services').mkdir(mode=0o700)
        for file in self.outer.glob('inquiry-runtime-*.js'):
            self.write(runtime / 'services' / file.name.removeprefix('inquiry-runtime-'), file.read_bytes())
        self.write(runtime / 'services/online-runtime-scope.py', (self.outer / 'online-runtime-scope.py').read_bytes())
        self.write(runtime / 'entry.cjs', b"'use strict';const {loadOnlineRuntimeScope}=require('./services/onlineRuntimeScope');const {createScopedInquiryWork}=require('./services/onlineInquiryWork');exports.initialize=async generation=>{const input=loadOnlineRuntimeScope();if(!input)throw Error('INQUIRY_NATIVE_OWNERSHIP_UNPROVEN');return createScopedInquiryWork({registrySha256:input.scope.manifestSha256,generation});};\n")
        archive_file = self.outer / 'inquiry-code.tar.gz'
        self.check(hashlib.sha256(archive_file.read_bytes()).hexdigest() == self.custody['codeArchiveSha256'], 'INQUIRY_CODE_ARCHIVE_CHANGED')
        with tarfile.open(archive_file, 'r:gz') as archive:
            members = archive.getmembers()
            self.check(1 < len(members) < 20000 and sum(member.size for member in members) < 256*1024**2, 'INQUIRY_CODE_BOUNDS')
            for member in members:
                name = member.name
                self.check(not name.startswith('/') and '..' not in name.split('/') and (member.isdir() or member.isfile()
                    or (member.issym() and name == '.next/node_modules/@prisma/client-2c3a283f134fdcb6'
                        and member.linkname == '../../../node_modules/@prisma/client')), 'INQUIRY_CODE_MEMBER_UNSAFE')
            for member in members:
                destination = app / member.name
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True, mode=0o700)
                elif member.issym():
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    os.symlink(member.linkname, destination)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                    with archive.extractfile(member) as source:
                        self.write(destination, source.read())
        for name in ['client.cjs', 'observer.cjs']:
            self.write(self.root / name, (self.outer / ('inquiry-' + name)).read_bytes())
        self.write(self.root / 'dependency-retention-reference.json', json.dumps(self.custody, sort_keys=True).encode())
        self.write(self.root / 'session-secret', os.urandom(32).hex().encode())
        self.log = os.open(self.root / 'native.log', os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        spec = importlib.util.spec_from_file_location('joined_inquiry_requested_stop', self.outer / 'inquiry-requested-stop.py')
        self.stop_policy = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.stop_policy)
        env = self.environment('source', online=False)
        schema = subprocess.run(['/usr/local/bin/node', str(app / 'node_modules/prisma/build/index.js'), 'db', 'push', '--skip-generate',
                                 '--schema', str(app / 'prisma/schema.prisma')], cwd=app, env=env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        self.check(schema.returncode == 0, 'INQUIRY_SCHEMA_FAILED')
        os.chmod(self.root / 'source.db', 0o600)
        seed = "const {PrismaClient}=require('./node_modules/@prisma/client'),bcrypt=require('./node_modules/bcryptjs');const db=new PrismaClient();(async()=>{try{if(await db.admin.count()||await db.product.count())throw Error('NOT_EMPTY');await db.admin.create({data:{id:'private-coherent-admin',email:'coherent@example.invalid',passwordHash:await bcrypt.hash('private-coherent-only',4)}});}finally{await db.$disconnect();}})().catch(()=>{process.exitCode=1;});"
        result = subprocess.run(['/usr/local/bin/node', '-e', seed], cwd=app, env=env, stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        self.check(result.returncode == 0, 'INQUIRY_SEED_FAILED')
        value = (self.root / 'source.db').stat()
        self.source_identity = dict(path=str(self.root / 'source.db'), device=str(value.st_dev), inode=str(value.st_ino))
        return self.source_identity

    def environment(self, name, online=True):
        env = {key: value for key, value in self.base_env.items() if not key.startswith(('PG', 'BACKEND_', 'INQUIRY_NATIVE_')) and key != 'DATABASE_URL'}
        env.update(DATABASE_URL='file:' + str(self.root / ('restored.db' if name == 'online-point' else name + '.db')) + '?connection_limit=2&pool_timeout=5',
                   SESSION_SECRET=(self.root / 'session-secret').read_text(), NODE_ENV='production', NEXT_TELEMETRY_DISABLED='1')
        for key in ['SMS_IR_API_KEY', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'RESEND_API_KEY', 'SENDGRID_API_KEY', 'NODE_OPTIONS']:
            env.pop(key, None)
        if online:
            grant = self.grants[name]
            env.update(BACKEND_RUNTIME_ROLE='serving', BACKEND_ONLINE_SCOPE_FILE=grant['file'],
                       BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'], RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],
                       INQUIRY_RUNTIME_GENERATION='1', INQUIRY_COHERENT_ROOT=str(self.root), NODE_OPTIONS='--require=' + str(self.root / 'observer.cjs'))
        return env

    def start(self, name):
        self.check(name not in self.actors, 'INQUIRY_ACTOR_ALREADY_STARTED')
        argv = ['/usr/bin/python3', '-I', '-B', str(self.outer / 'online-inquiry-owner.py'), '/usr/local/bin/node',
                str(self.root / 'app/node_modules/next/dist/bin/next'), 'start', '--hostname', '127.0.0.1', '--port', '3287']
        if name == 'online-point':
            actor = self.spawn_point_native(argv, self.environment(name), str(self.root / 'app'))
        else:
            actor = subprocess.Popen(argv, cwd=self.root / 'app', env=self.environment(name), stdin=subprocess.DEVNULL, stdout=self.log, stderr=self.log)
        self.actors[name] = actor
        def healthy():
            self.check(actor.poll() is None, 'INQUIRY_ACTOR_EXITED_BEFORE_READY')
            try:
                with urllib.request.urlopen('http://127.0.0.1:3287/admin/login', timeout=1) as response:
                    return response.status == 200
            except Exception:
                return False
        self.wait(healthy, 'INQUIRY_NEXT_NOT_READY')
        self.check(self.native(name)[1]['phase'] == 'ACTIVE', 'INQUIRY_NATIVE_NOT_ACTIVE')

    def client(self, mode, asynchronous=False):
        actor = subprocess.Popen(['/usr/local/bin/node', str(self.root / 'client.cjs'), str(self.root), mode], cwd=self.root / 'app', stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=self.log)
        if asynchronous:
            self.clients[mode] = actor
            return actor
        output = actor.communicate()[0]
        self.check(actor.returncode == 0, 'INQUIRY_HTTP_CLIENT_FAILED_' + mode)
        return output

    def start_source(self):
        self.start('source')
        self.check(b'LOGIN_OK' in self.client('login'), 'INQUIRY_LOGIN_FAILED')
        self.check(b'QUEUED_NATIVE_FORM_PREPARED' in self.client('prepare-queued'), 'INQUIRY_QUEUED_FORM_FAILED')

    def begin_lost_ack(self):
        actor = self.client('ambiguous', asynchronous=True)
        self.wait(lambda: (self.root / 'action-delayed').exists(), 'INQUIRY_ADMITTED_ACTION_NOT_OBSERVED')
        output = actor.communicate()[0]
        self.check(actor.returncode == 0 and b'ACK_LOST_NO_REPLAY' in output, 'INQUIRY_ACK_NOT_LOST')

    def release_lost_ack(self):
        self.write(self.root / 'release-action', b'release\n', 0o600)
        self.wait(lambda: self.work('source')['phase'] == 'QUIESCENT', 'INQUIRY_LOST_ACK_WORK_NOT_QUIET')
        self.check(self.rows(self.root / 'source.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)], 'INQUIRY_LOST_ACK_COMMIT_CHANGED')

    def queue_during_capture(self):
        self.queued = self.client('queued', asynchronous=True)
        self.wait(lambda: (self.root / 'queued-acquire').exists(), 'INQUIRY_QUEUED_ACQUIRE_NOT_OBSERVED')
        self.check((self.root / 'queued-arrived').exists() and self.queued.poll() is None, 'INQUIRY_QUEUE_FINISHED_INSIDE_CAPTURE')
        # The first callback is deliberately still held before its action body.
        # Its exact commit is proved by release_lost_ack() after this check.
        self.check(not any(row[0] == 'COHERENT-QUEUED' for row in self.rows(self.root / 'source.db')),
                   'INQUIRY_QUEUE_MUTATED_INSIDE_CAPTURE')

    def source_after_open(self):
        output = self.queued.communicate()[0]
        self.check(self.queued.returncode == 0 and b'QUEUED_COMMITTED' in output, 'INQUIRY_QUEUED_COMMIT_FAILED')
        self.wait(lambda: self.work('source')['phase'] == 'QUIESCENT', 'INQUIRY_QUEUE_WORK_NOT_QUIET')
        self.check(self.rows(self.root / 'source.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0), ('COHERENT-QUEUED', 1234567.0, 2345678.0)], 'INQUIRY_SOURCE_ROWS_CHANGED')

    @staticmethod
    def rows(file):
        with sqlite3.connect('file:' + str(file) + '?mode=ro', uri=True) as database:
            return database.execute('SELECT rowNumber,listPrice,finalPrice FROM Product ORDER BY rowNumber').fetchall()

    def stop(self, name):
        actor = self.actors[name]
        self.check(actor.poll() is None and self.work(name)['phase'] == 'QUIESCENT', 'INQUIRY_STOP_WORK_NOT_QUIET')
        raw, initial = self.native(name)
        self.check(initial['phase'] == 'ACTIVE' and initial['guardian']['pid'] == actor.pid, 'INQUIRY_STOP_ORIGINAL_GUARDIAN_CHANGED')
        request = dict(format='sabalan-private-inquiry-requested-stop/v1', guardian=initial['guardian'],
                       activeClaimSha256=hashlib.sha256(raw).hexdigest(), signal='SIGTERM', expectedNativeStatus=143,
                       naturalExitZeroExpected=False)
        self.write(self.root / (name + '-requested-stop.json'), json.dumps(request, sort_keys=True).encode())
        actor.send_signal(signal.SIGTERM)
        actor.wait()
        final_raw, final = self.native(name)
        self.stop_policy.qualify_requested_stop(request, initial, final, actor.returncode)
        self.closures[name] = dict(nativeStatus=143, nativeSha256=hashlib.sha256(final_raw).hexdigest(),
                                   activeClaimSha256=request['activeClaimSha256'], requestedSigterm=True,
                                   nativeReaped=True, sqliteNativeClosed=True, naturalExitZero=False)
        return self.closures[name]

    def stop_source(self):
        return self.stop('source')

    def start_restored(self, captured_sqlite, expected_sha256):
        self.check('source' in self.closures, 'INQUIRY_SOURCE_CLOSURE_REQUIRED')
        source = Path(captured_sqlite)
        self.check(source.resolve(strict=True) == source and source.is_file(), 'INQUIRY_CAPTURE_PATH_INVALID')
        digest = hashlib.sha256()
        with source.open('rb') as incoming, (self.root / 'restored.db').open('xb') as output:
            while chunk := incoming.read(262144):
                digest.update(chunk); output.write(chunk)
            output.flush(); os.fsync(output.fileno())
        self.check(digest.hexdigest() == expected_sha256, 'INQUIRY_CAPTURE_SHA_CHANGED')
        os.chmod(self.root / 'restored.db', 0o600)
        self.check(self.rows(self.root / 'restored.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)], 'INQUIRY_CAPTURE_ROWS_CHANGED')
        self.start('restored')

    def verify_restored_and_retry(self):
        self.check(b'RESTORED_NEXT_READ_OK' in self.client('restored'), 'INQUIRY_RESTORED_READ_FAILED')
        self.check(b'DUPLICATE_REFUSED' in self.client('retry'), 'INQUIRY_RESTORED_DUPLICATE_NOT_REFUSED')
        self.check(self.rows(self.root / 'restored.db') == [('COHERENT-ACK-LOST', 1234567.0, 2345678.0)], 'INQUIRY_RESTORED_DUPLICATE_OR_POSTCUT_ROW')
        self.wait(lambda: self.work('restored')['phase'] == 'QUIESCENT', 'INQUIRY_RESTORED_WORK_NOT_QUIET')

    def stop_restored(self):
        result = self.stop('restored')
        self.inventory()
        os.fsync(self.log); os.close(self.log)
        return result


    def online_point_sqlite_identity(self):
        file=self.root/'restored.db';before=os.lstat(file)
        self.check(file.resolve(strict=True)==file and stat.S_ISREG(before.st_mode) and before.st_nlink==1
                   and before.st_uid==os.getuid() and not before.st_mode&0o077,'INQUIRY_POINT_SQLITE_IDENTITY_INVALID')
        identity=lambda value:tuple(getattr(value,key) for key in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns','st_uid','st_mode','st_nlink'))
        fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);hashed=hashlib.sha256()
        try:
            self.check(identity(os.fstat(fd))==identity(before),'INQUIRY_POINT_SQLITE_CHANGED')
            while chunk:=os.read(fd,262144):hashed.update(chunk)
            self.check(identity(os.fstat(fd))==identity(before)==identity(os.lstat(file)),'INQUIRY_POINT_SQLITE_CHANGED')
        finally:os.close(fd)
        return dict(file=str(file),device=str(before.st_dev),inode=str(before.st_ino),bytes=before.st_size,sha256=hashed.hexdigest())

    def start_online_point(self, grant, spawn_native):
        """Fresh diagnostic SQLite owner; never reopen an old native grant.

        The original candidate controller supplies its fixed process creator and
        retains the SAME returned Popen from birth through requested retirement.
        """
        self.check('online-point' not in self.grants and callable(spawn_native), 'INQUIRY_POINT_ALREADY_ISSUED')
        expected = self.index['onlinePointInquiryGrant']
        self.check(grant == expected, 'INQUIRY_POINT_GRANT_CHANGED')
        scope = grant['scope']; cohort = self.index['privateQualification']['httpGrants'][1]['scope']
        self.check(scope['format']=='sabalan-online-runtime-scope/v2' and scope['purpose']=='http'
                   and scope['role']=='serving' and scope['worker'] is None, 'INQUIRY_POINT_SCOPE_INVALID')
        for field in ['coordinationDirectory','gate','interlock','database','admission','image','sourceCommit','manifestSha256']:
            self.check(scope[field] == cohort[field], 'INQUIRY_POINT_WRONG_COHORT')
        prior = [self.index['inquiryGrants']['source'],self.index['inquiryGrants']['restored'],
                 *self.index['privateQualification']['httpGrants'],self.index['privateQualification']['onlinePointCaptureGrant']]
        self.check(all(scope['runtimeId'] != item['scope']['runtimeId'] and scope['nonce'] != item['scope']['nonce'] for item in prior), 'INQUIRY_POINT_REUSED_NATIVE_IDENTITY')
        self.check(not (Path(scope['nativeDirectory'])/'deployment-runtime-native.json').exists()
                   and not (Path(scope['boundaryDirectory'])/'state.json').exists(), 'INQUIRY_POINT_NATIVE_ALREADY_OBSERVED')
        self.check(Path(grant['file']).read_bytes() == (json.dumps(scope,sort_keys=True,separators=(',',':'))+'\n').encode()
                   and hashlib.sha256(Path(grant['file']).read_bytes()).hexdigest()==grant['sha256'], 'INQUIRY_POINT_RO_SCOPE_CHANGED')
        previous = self.index['inquiryGrants']['restored']; previous_raw=(Path(previous['scope']['nativeDirectory'])/'deployment-runtime-native.json').read_bytes()
        previous_native=json.loads(previous_raw)
        self.check(previous_native['onlineScope']['sha256']==previous['sha256'] and previous_native['phase']=='QUIESCENT'
                   and previous_native['nativeReaped'] is True and previous_native['sqliteNativeClosed'] is True,
                   'INQUIRY_POINT_PREVIOUS_ACTOR_NOT_CLOSED')
        sqlite = self.root/'restored.db'; before=os.lstat(sqlite)
        self.check(sqlite.resolve(strict=True)==sqlite and stat.S_ISREG(before.st_mode) and before.st_nlink==1
                   and before.st_uid==os.getuid() and not before.st_mode&0o077, 'INQUIRY_POINT_SQLITE_IDENTITY_INVALID')
        self.check(self.rows(sqlite)==[('COHERENT-ACK-LOST',1234567.0,2345678.0)], 'INQUIRY_POINT_RESTORED_SQLITE_CHANGED')
        self.grants=dict(self.grants,**{'online-point':grant});self.spawn_point_native=spawn_native
        self.custody=json.loads((self.outer/'inquiry-custody.json').read_bytes());self.inventory()
        policy_spec=importlib.util.spec_from_file_location('online_point_inquiry_stop_policy',self.outer/'inquiry-requested-stop.py')
        self.stop_policy=importlib.util.module_from_spec(policy_spec);policy_spec.loader.exec_module(self.stop_policy)
        self.start('online-point')
        raw,native=self.native('online-point');after=os.lstat(sqlite)
        self.check((before.st_dev,before.st_ino)==(after.st_dev,after.st_ino)
                   and native['guardian']['pid']==self.actors['online-point'].pid and native['onlineScope']==dict(scope=scope,sha256=grant['sha256']), 'INQUIRY_POINT_READY_IDENTITY_CHANGED')
        self.wait(lambda:self.work('online-point')['phase']=='QUIESCENT','INQUIRY_POINT_READY_WORK_NOT_QUIET')
        self.point_sqlite=self.online_point_sqlite_identity()
        self.point_active_raw=raw
        return dict(format='sabalan-original-online-point-inquiry-ready/v1',runtimeId=scope['runtimeId'],scopeSha256=grant['sha256'],
                    sqlite=self.point_sqlite,originalGuardian=native['guardian'],nativeActiveRawBase64=base64.b64encode(raw).decode(),
                    nativeDirectory=scope['nativeDirectory'],boundaryDirectory=scope['boundaryDirectory'],
                    diagnosticSourceBundle=True,immutableInstalledApplicationQualified=False,productionAdmission=False)

    def stop_online_point(self):
        self.wait(lambda:self.work('online-point')['phase']=='QUIESCENT','INQUIRY_POINT_STOP_WORK_NOT_QUIET')
        stop = self.stop('online-point');raw,native=self.native('online-point');actor=self.actors['online-point']
        self.check(actor.poll()==128 and native['nativeStatus']==143 and native['guardian']['pid']==actor.pid,'INQUIRY_POINT_ORIGINAL_CLOSE_UNPROVEN')
        self.check(self.online_point_sqlite_identity()==self.point_sqlite,'INQUIRY_POINT_SQLITE_CHANGED')
        self.inventory()
        return dict(format='sabalan-original-online-point-inquiry-closed/v1',result=stop,originalPopenPid=actor.pid,
                    originalReturncode=actor.returncode,nativeRawBase64=base64.b64encode(raw).decode(),
                    activeRawBase64=base64.b64encode(self.point_active_raw).decode(),sqlite=self.point_sqlite,
                    workRawBase64=base64.b64encode((Path(self.grants['online-point']['scope']['boundaryDirectory'])/'state.json').read_bytes()).decode(),
                    diagnosticSourceBundle=True,immutableInstalledApplicationQualified=False,productionAdmission=False)
