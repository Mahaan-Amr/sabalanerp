#!/usr/bin/env python3
"""Original host owner of a bounded physical/WAL/coherent component set.

This process never adopts a report or an interrupted child.  FD9 remains held
on unresolved daemon/native/SQL outcome; a time budget cannot release custody.
The output is a plaintext component receipt, not a healthy recovery point.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import stat
import subprocess
import sys
import threading
import time
import base64
import hmac
import secrets
import shlex
from types import SimpleNamespace

sys.dont_write_bytecode = True


def require(value, code):
    if not value:
        raise RuntimeError('ONLINE_CHECKPOINT_' + code)


def encoded(value):
    return (json.dumps(value, sort_keys=True, separators=(',', ':')) + '\n').encode()


def private_bytes(file, maximum=262144, immutable=False):
    file = Path(file)
    require(file.is_absolute() and file.resolve(strict=True) == file, 'PATH_INVALID')
    descriptor = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_nlink == 1
                and not before.st_mode & (0o222 if immutable else 0o077)
                and 0 < before.st_size <= maximum, 'FILE_INVALID')
        raw = os.read(descriptor, maximum + 1)
        key = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns,
                             value.st_mode, value.st_uid, value.st_nlink)
        require(len(raw) == before.st_size and key(before) == key(os.fstat(descriptor)) == key(file.lstat()), 'FILE_CHANGED')
        return raw
    finally:
        os.close(descriptor)


def publish(file, value, mode=0o400):
    raw = value if isinstance(value, bytes) else encoded(value)
    descriptor = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    try:
        with os.fdopen(descriptor, 'wb', closefd=False) as stream:
            stream.write(raw); stream.flush(); os.fsync(descriptor)
    finally:
        os.close(descriptor)
    descriptor = os.open(Path(file).parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)
    return hashlib.sha256(raw).hexdigest()


class OriginalChildren:
    """Only handles created by this instance can be waited or read here."""
    def __init__(self, root, assert_owner, retained_fds=()):
        self.root, self.assert_owner, self.children = root, assert_owner, []
        self.retained_fds=tuple(retained_fds)

    def start(self, name, argv, *, environment=None, interactive=False, inherited=(), maximum=1048576):
        self.assert_owner()
        require(re.fullmatch(r'[a-z][a-z0-9-]{0,63}', name) and all(item.name != name for item in self.children), 'CHILD_NAME_INVALID')
        stdout, stderr = self.root / (name + '.stdout'), self.root / (name + '.stderr')
        outputs = [os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os,'O_BINARY',0), 0o600) for file in (stdout, stderr)]
        child = SimpleNamespace(name=name, stdout=stdout, stderr=stderr, overflow=False, errors=[], threads=[], process=None)
        self.children.append(child)
        try:
            child.process = subprocess.Popen(argv, stdin=subprocess.PIPE if interactive else subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, pass_fds=tuple(sorted(set((*self.retained_fds,*inherited)))))
        except BaseException:
            for descriptor in outputs: os.close(descriptor)
            raise

        def drain(source, descriptor):
            kept = 0
            try:
                while True:
                    raw = source.read1(16384)
                    if not raw: break
                    allowed = min(len(raw), max(0, maximum - kept))
                    if allowed:
                        view = memoryview(raw)[:allowed]
                        while view:
                            written = os.write(descriptor, view); view = view[written:]
                        kept += allowed
                    if allowed != len(raw): child.overflow = True
                os.fsync(descriptor)
            except BaseException as error:
                child.errors.append(type(error).__name__)
                # Continue draining the original pipe even if audit storage
                # fails.  A blocked client must not be mistaken for closure.
                try:
                    while source.read(16384): pass
                except BaseException: pass
            finally:
                source.close(); os.close(descriptor)
        for source, descriptor in zip((child.process.stdout, child.process.stderr), outputs):
            thread = threading.Thread(target=drain, args=(source, descriptor))
            child.threads.append(thread); thread.start()
        return child

    def finish(self, child, maximum=1048576):
        require(any(item is child for item in self.children) and child.process is not None, 'ORIGINAL_CHILD_REQUIRED')
        status = child.process.wait()  # No signal, kill, deadline or replacement.
        for thread in child.threads: thread.join()
        self.assert_owner()
        require(not child.overflow and child.stdout.stat().st_size <= maximum
                and child.stderr.stat().st_size <= maximum and not child.errors, 'OUTPUT_BOUND')
        require(status == 0, 'CHILD_FAILED')
        return child.stdout.read_bytes()

    def closed(self):
        return all(item.process is None or (item.process.poll() is not None
                   and all(not thread.is_alive() for thread in item.threads)) for item in self.children)


def scram_verifier(password, salt):
    salted = hashlib.pbkdf2_hmac('sha256', password.encode('ascii'), salt, 4096)
    client = hmac.new(salted, b'Client Key', hashlib.sha256).digest()
    stored = hashlib.sha256(client).digest()
    server = hmac.new(salted, b'Server Key', hashlib.sha256).digest()
    text = lambda raw: base64.b64encode(raw).decode('ascii')
    return 'SCRAM-SHA-256$4096:' + text(salt) + '$' + text(stored) + ':' + text(server)


_LOCAL_RUNTIME_AUTHORITY=object()


def host_runtime(config):
    if 'localHostRuntime' not in config:
        return {'python':['/usr/bin/python3','-I','-B'],'docker':['/usr/bin/docker'],'pins':{}}
    require(config.get('project')=='sabalanerp-local','LOCAL_RUNTIME_PROJECT_REQUIRED')
    require(config.get('_localRuntimeAuthority') is _LOCAL_RUNTIME_AUTHORITY,'LOCAL_RUNTIME_NOT_VALIDATED')
    return config['_localRuntimeCommands']


def validate_host_runtime(config):
    require('_localRuntimeAuthority'not in config and '_localRuntimeCommands'not in config,'LOCAL_RUNTIME_PRIVATE_INPUT')
    if 'localHostRuntime'not in config:return
    require(config.get('project')=='sabalanerp-local','LOCAL_RUNTIME_PROJECT_REQUIRED')
    file=Path(__file__).with_name('online-local-host-runtime.py')
    pin=config['helpers'].get('localRuntime',{})
    require(pin.get('file')==str(file) and source_sha(file)==pin.get('sha256'),'LOCAL_RUNTIME_HELPER_PIN')
    spec=importlib.util.spec_from_file_location('sabalan_fixed_local_host_runtime',file)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    config['_localRuntimeCommands']=module.validate(config['localHostRuntime'])
    config['_localRuntimeAuthority']=_LOCAL_RUNTIME_AUTHORITY


class Producer:
    def __init__(self, config, children, ownership):
        self.config, self.children, self.ownership = config, children, ownership
        self.root, self.counter = Path(config['root']), 0
        self.receiver = self.capture = None
        self.role_created = self.hba_installed = False
        self.native_closed = False
        self.cancelled = False

    def prepare_docker_guard(self):
        directory=self.root/'physical-base-docker-guard';directory.mkdir(mode=0o700)
        script=("#!/bin/sh\nexec "+shlex.join(host_runtime(self.config)['python'])+' '+shlex.quote(self.config['helpers']['producer']['file'])+
            ' --docker-guard '+shlex.quote(self.config['configurationFile'])+' '+self.config['configurationSha256']+' "$@"\n').encode()
        self.guard_sha=publish(directory/'docker',script,0o500)
        self.guard_file=directory/'docker'
        return dict(os.environ,PATH=str(directory)+':/usr/bin:/bin')

    def step(self, purpose):
        self.counter += 1
        return purpose + '-' + str(self.counter)

    def held(self, reason):
        # Persistent false evidence, then retain the SAME process, all original
        # child objects, FD9 and any unresolved role/HBA ownership indefinitely.
        try: publish(self.root / 'UNKNOWN.json', {'format':'sabalan-online-checkpoint-unknown/v1', 'reason':reason})
        except BaseException: pass
        while True: time.sleep(1)

    def command(self, purpose, argv, *, interactive=False, inherited=(), environment=None, maximum=1048576):
        return self.children.start(self.step(purpose), argv, interactive=interactive,
            inherited=inherited, environment=environment, maximum=maximum)

    def docker(self, arguments, *, interactive=False, environment=None):
        self.ownership()
        # Every daemon action is immediately preceded by the canonical project
        # census. Neither census nor a lost Docker client is native completion.
        census = self.command('compose-ps', [*host_runtime(self.config)['docker'],'compose','-f',self.config['composeFile'],
            '-p',self.config['project'],'ps','--all','--no-trunc','--format','json'])
        raw = self.children.finish(census)
        rows = json.loads(raw) if raw.lstrip().startswith(b'[') else [json.loads(line) for line in raw.splitlines() if line]
        validate_census(rows,self.config['expectedContainerIds'],self.config['project'],local_context=self.config if 'localDevSuspension'in self.config else None)
        inspect_local_dev_suspension(self.config,lambda args:self.children.finish(self.command('local-dev-inspect',[*host_runtime(self.config)['docker'],*args])))
        return self.command('docker', [*host_runtime(self.config)['docker'],*arguments], interactive=interactive, environment=environment)

    def complete(self, child, stdin=None):
        if stdin is not None:
            require(child.process.stdin is not None, 'ORIGINAL_PIPE_REQUIRED')
            child.process.stdin.write(stdin); child.process.stdin.flush(); child.process.stdin.close()
        return self.children.finish(child)

    def sql(self, query):
        pg = self.config['postgres']
        require(re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]{0,62}',pg['user']), 'POSTGRES_USER_INVALID')
        child = self.docker(['exec','-i',pg['containerId'],'psql','-X','-qAt','-v','ON_ERROR_STOP=1',
            '-U',pg['user'],'-d',self.config['database']['name']], interactive=True)
        return self.complete(child, ("SET statement_timeout='10s';SET lock_timeout='500ms';\n" + lease_assertion(self.config['lease']) + query + '\n').encode()).decode().strip()

    def query(self, query):
        return json.loads(self.sql(query))

    def inspect(self, actor, service):
        template = ('{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},'
            '"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},'
            '"service":{{json (index .Config.Labels "com.docker.compose.service")}},'
            '"mounts":{{json .Mounts}},"networks":{{json .NetworkSettings.Networks}}}')
        found = json.loads(self.complete(self.docker(['inspect','--format',template,actor['containerId']])))
        if service=='backend'and self.config['project']=='sabalanerp-local':service='backend-candidate'
        require(found['id'] == actor['containerId'] and found['image'] == actor['image']
            and found['startedAt'] == actor['startedAt'] and found['running'] is True
            and found['project'] == self.config['project'] and found['service'] == service, 'SOURCE_CONTAINER_CHANGED')
        return found

    def profile(self):
        result = self.query("SELECT json_build_object('databaseName',current_database(),'databaseOid',d.oid::text,"
            "'systemIdentifier',c.system_identifier::text,'timeline',(pg_control_checkpoint()).timeline_id,"
            "'segmentBytes',pg_size_bytes(current_setting('wal_segment_size')),'currentLsn',pg_current_wal_insert_lsn(),"
            "'version',current_setting('server_version_num'),'visible',(SELECT rolsuper FROM pg_roles WHERE rolname=current_user),"
            "'prepared',(SELECT count(*) FROM pg_prepared_xacts WHERE database=current_database())) "
            "FROM pg_database d CROSS JOIN pg_control_system() c WHERE d.datname=current_database();")
        require({key:result[field] for key,field in [('name','databaseName'),('oid','databaseOid'),('systemIdentifier','systemIdentifier')]}
            == self.config['database'] and result['visible'] is True and result['prepared'] == 0
            and 150000 <= int(result['version']) < 160000, 'DATABASE_SOURCE_CHANGED')
        return result

    def wait_for(self, predicate, child, seconds, code):
        deadline = time.monotonic() + seconds
        while True:
            self.ownership()
            value = predicate()
            if value is not None: return value
            require(child.process.poll() is None and not self.cancelled and time.monotonic() < deadline, code)
            time.sleep(.05)

    def provision_replication(self, backend, postgres):
        token = self.config['captureId'][:32]
        self.replication_user, self.namespace = 'sabalan_wal_' + token, 'sabalan-wal-' + token
        password = secrets.token_hex(32)
        require(self.query("SELECT to_json(count(*)) FROM pg_roles WHERE rolname='" + self.replication_user + "'") == 0,
                'REPLICATION_ROLE_ALREADY_EXISTS')
        verifier = scram_verifier(password, secrets.token_bytes(16))
        publish(self.root/'replication-role-intent.json',dict(role=self.replication_user,namespace=self.namespace,
            database=self.config['database'],persistentMutationPending=True))
        self.sql('CREATE ROLE "' + self.replication_user + '" LOGIN REPLICATION NOSUPERUSER NOCREATEDB NOCREATEROLE '
            "NOINHERIT NOBYPASSRLS CONNECTION LIMIT 2 PASSWORD '" + verifier + "';")
        self.role_created = True
        self.role = self.query("SELECT json_build_object('oid',oid::text,'super',rolsuper,'createdb',rolcreatedb,"
            "'createrole',rolcreaterole,'inherit',rolinherit,'bypass',rolbypassrls,'replication',rolreplication,"
            "'login',rolcanlogin,'limit',rolconnlimit) FROM pg_roles WHERE rolname='" + self.replication_user + "'")
        require(all(self.role[key] is False for key in ('super','createdb','createrole','inherit','bypass'))
            and self.role['replication'] is True and self.role['login'] is True and self.role['limit'] == 2, 'ROLE_PRIVILEGES_CHANGED')
        addresses = [value['IPAddress'] for value in backend['networks'].values()]
        require(addresses == [self.config['backend']['privateAddress']]
                and re.fullmatch(r'(?:[0-9]{1,3}\.){3}[0-9]{1,3}', addresses[0]), 'RECEIVER_NETWORK_CHANGED')
        hba_path = self.sql('SHOW hba_file')
        require(hba_path.endswith('/pg_hba.conf') and Path(hba_path).is_absolute(), 'HBA_PATH_INVALID')
        mounts = [row for row in postgres['mounts'] if row['Type']=='volume' and row['RW']
                  and (hba_path == row['Destination'] or hba_path.startswith(row['Destination'].rstrip('/') + '/'))]
        require(len(mounts)==1 and mounts[0]['Name'], 'HBA_PERSISTENT_VOLUME_REQUIRED')
        row = 'host replication ' + self.replication_user + ' ' + addresses[0] + '/32 scram-sha-256 # online-checkpoint-' + token
        self.hba_directory = str(Path(hba_path).parent / ('.sabalan-online-wal-' + token))
        # Copy and bind the complete previous file before the atomic install.
        prepare = ('set -eu; target="$1"; dir="$2"; test ! -L "$target"; '
            'test "$(stat -c %h "$target")" = 1; perm=$(stat -c %a "$target"); test "$((0$perm & 022))" -eq 0; '
            'umask 077; mkdir -m 700 "$dir"; '
            'chown "$(stat -c %u:%g "$target")" "$dir"; cp -p "$target" "$dir/original"; '
            'cp -p "$target" "$dir/prepared"; printf "\\n%s\\n" "$3" >>"$dir/prepared"; '
            'sync; sha256sum "$dir/original" "$dir/prepared"; stat -c %u:%g:%a:%h "$target"')
        output = self.complete(self.docker(['exec',self.config['postgres']['containerId'],'sh','-c',prepare,
            'online-wal-hba-prepare',hba_path,self.hba_directory,row])).decode().splitlines()
        require(len(output)==3 and all(re.fullmatch(r'[a-f0-9]{64}  .+',line) for line in output[:2])
            and re.fullmatch(r'[0-9]+:[0-9]+:[0-7]{3,4}:1',output[2]), 'HBA_HASH_UNPROVEN')
        self.hba_original, self.hba_installed_hash = [line.split()[0] for line in output[:2]]
        self.hba_metadata=output[2]
        self.hba_path = hba_path
        publish(self.root/'replication-intent.json',dict(role=self.replication_user,roleOid=self.role['oid'],namespace=self.namespace,
            hbaPath=hba_path,directory=self.hba_directory,originalSha256=self.hba_original,
            installedSha256=self.hba_installed_hash,originalMetadata=self.hba_metadata,volume=mounts[0]['Name'],exactAddress=addresses[0]))
        self.replace_hba(self.hba_original,self.hba_installed_hash,'prepared')
        self.hba_installed = True
        self.reload_hba(True)
        return password

    def replace_hba(self, previous, replacement, filename):
        require(filename in ('original','prepared'), 'HBA_REPLACEMENT_INVALID')
        self.sql('SELECT 1')
        script = ('set -eu; target="$1"; dir="$2"; test ! -L "$target"; '
            'test "$(stat -c %u:%g:%a:%h "$target")" = "$6"; '
            'test "$(stat -c %u:%g:%a:%h "$dir/$5")" = "$6"; '
            'test "$(sha256sum "$target" | cut -d " " -f 1)" = "$3"; '
            'test "$(sha256sum "$dir/$5" | cut -d " " -f 1)" = "$4"; '
            'test ! -e "$dir/installing"; cp -p "$dir/$5" "$dir/installing"; sync; '
            'mv "$dir/installing" "$target"; sync; sha256sum "$target"')
        raw = self.complete(self.docker(['exec',self.config['postgres']['containerId'],'sh','-c',script,
            'online-wal-hba-replace',self.hba_path,self.hba_directory,previous,replacement,filename,self.hba_metadata])).decode()
        require(raw.split()[0] == replacement,'HBA_REPLACEMENT_UNPROVEN')

    def reload_hba(self, installed):
        previous=self.sql('SELECT pg_conf_load_time()::text')
        require(self.sql('SELECT pg_reload_conf()')=='t','HBA_RELOAD_FAILED')
        deadline=time.monotonic()+10
        while self.query("SELECT to_json(pg_conf_load_time()> '"+previous.replace("'","''")+"'::timestamptz)")is not True:
            require(not self.cancelled and time.monotonic()<deadline,'HBA_RELOAD_NOT_OBSERVED')
            time.sleep(.05)
        require(self.query('SELECT to_json(count(*)) FROM pg_hba_file_rules WHERE error IS NOT NULL')==0,'HBA_PARSE_FAILED')
        count = self.query("SELECT to_json(count(*)) FROM pg_hba_file_rules WHERE '" + self.replication_user
            + "'=ANY(user_name) AND 'replication'=ANY(database)")
        require(count == (1 if installed else 0),'HBA_RULE_UNPROVEN')

    def cleanup_replication(self):
        require(self.receiver is not None and self.receiver.process.poll() == 0, 'ORIGINAL_RECEIVER_NOT_CLOSED')
        require(self.query("SELECT to_json(count(*)) FROM pg_stat_activity WHERE usename='"+self.replication_user+"'")==0,
                'REPLICATION_SQL_STILL_ACTIVE')
        if self.hba_installed:
            self.replace_hba(self.hba_installed_hash,self.hba_original,'original'); self.reload_hba(False)
            self.hba_installed=False
        if self.role_created:
            require(self.sql("SELECT oid::text FROM pg_roles WHERE rolname='"+self.replication_user+"'")==self.role['oid'],
                    'REPLICATION_ROLE_REPLACED')
            self.sql('DROP ROLE "'+self.replication_user+'"'); self.role_created=False

    def runtime(self, host_file):
        return self.config['runtimeRoot'].rstrip('/') + '/' + str(Path(host_file).relative_to(self.root))

    def backend_python(self, code, args=(), *, interactive=False):
        return self.docker(['exec',*(['-i'] if interactive else []),self.config['backend']['containerId'],
                           '/usr/bin/python3','-I','-B','-c',code,*args], interactive=interactive)

    def admission(self):
        script=r'''
import base64,importlib.util,json,os,sys
v=json.load(sys.stdin)
os.environ.update(BACKEND_RUNTIME_ROLE='control',RECOVERY_COORDINATION_DIR=v['coordinationDirectory'],
 BACKEND_ONLINE_SCOPE_FILE=v['scopeFile'],BACKEND_ONLINE_SCOPE_SHA256=v['scopeSha256'])
def load(name,file):
 s=importlib.util.spec_from_file_location(name,'/app/scripts/'+file);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
scope=load('original_scope','online-runtime-scope.py').load_scope(os.environ)
state,raw=load('original_admission','online-capture-admission.py').CaptureAdmission(scope).state()
print(json.dumps(dict(state=state,rawBase64=base64.b64encode(raw).decode())))
'''
        grant=self.config['capture']
        return json.loads(self.complete(self.backend_python(script,interactive=True),encoded(dict(
            coordinationDirectory=grant['scope']['coordinationDirectory'],scopeFile=grant['runtimeScopeFile'],scopeSha256=grant['scopeSha256']))))

    def prepare_receiver(self, password):
        directory = self.root/'receiver'; directory.mkdir(mode=0o700)
        configuration = dict(self.range, root=self.runtime(directory), namespace=self.namespace,
            replicationUser=self.replication_user,
            **{key:self.source[key] for key in ('databaseName','databaseOid','systemIdentifier')})
        publish(directory/'configuration.json',configuration)
        publish(directory/'replication-password',password.encode())
        publish(directory/'receive-postgres-wal.py',private_bytes(self.config['helpers']['receiver']['file'],16*1024*1024,True))
        # Own a distinct receiver lock inside the enrolled RW volume. It is NOT
        # the host deployment mutex and cannot grant capture/application work.
        descriptor=os.open(directory/'receiver.lock',os.O_CREAT|os.O_EXCL|os.O_RDWR,0o600);os.fsync(descriptor);os.close(descriptor)
        launcher = ("import fcntl,os,sys;from pathlib import Path;root=Path(sys.argv[1]);"
            "fd=os.open(root/'receiver.lock',os.O_RDWR|os.O_NOFOLLOW);fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB);"
            "os.dup2(fd,9,inheritable=True);"
            "os.execv(sys.executable,[sys.executable,'-I','-B',str(root/'receive-postgres-wal.py'),str(root/'configuration.json')])")
        # The secret is inherited only by this original Docker client/process;
        # no argv or persisted command/output contains DATABASE_URL.
        env=dict(os.environ,DATABASE_URL=self.config['databaseUrl'])
        self.receiver=self.docker(['exec','-e','DATABASE_URL',self.config['backend']['containerId'],
            '/usr/bin/python3','-I','-B','-c',launcher,self.runtime(directory)], environment=env)
        return directory

    def begin_capture(self):
        self.sql('SELECT 1')
        grant=self.config['capture']
        scope_raw=private_bytes(grant['scopeFile'],immutable=True)
        declaration_file=Path(grant['boundaryDirectoryHost'])/'scope.json'
        declaration_raw=private_bytes(declaration_file)
        require(declaration_file.lstat().st_mode&0o777==0o600,'CAPTURE_DECLARATION_MODE_CHANGED')
        declaration=json.loads(declaration_raw)
        require(declaration['scope']['runtimeId']==grant['runtimeId'],'CAPTURE_DECLARATION_CHANGED')
        self.capture_declaration=declaration_raw
        require(hashlib.sha256(scope_raw).hexdigest()==grant['scopeSha256'] and json.loads(scope_raw)==grant['scope'],
                'SIGNED_SCOPE_CHANGED')
        component=self.root/'coherent';component.mkdir(mode=0o700)
        sealer=self.root/'sealer';sealer.mkdir(mode=0o700)
        wrapper=b"'use strict';require('/app/dist/scripts/sealNativeVersionedFiles.js');\n"
        entry_hash=self.complete(self.backend_python("import hashlib;print(hashlib.sha256(open('/app/dist/scripts/sealNativeVersionedFiles.js','rb').read()).hexdigest())")).decode().strip()
        require(entry_hash==self.config['sealer']['entrySha256'],'INSTALLED_SEALER_CHANGED')
        wrapper_sha=publish(sealer/'native-file-sealer.cjs',wrapper)
        scope=dict(format='sabalan-coherent-capture-scope/v3',captureId=self.config['captureId'],
            handshake=secrets.token_hex(32),systemIdentifier=self.config['database']['systemIdentifier'],
            databaseName=self.config['database']['name'],storeRoot=None,sources=self.config['sources'],
            inquiry=self.config['inquiry'],logicalDump=True,
            coordinationHistory=dict(operationRoot=self.config['runtimeRoot']),
            sealer=dict(script=self.runtime(sealer/'native-file-sealer.cjs'),sha256=wrapper_sha,
                stores=self.config['sealer']['stores']))
        publish(component/'scope.json',scope)
        native_file=Path(grant['nativeDirectoryHost'])/'deployment-runtime-native.json'
        require(not native_file.exists(),'NATIVE_CAPTURE_ALREADY_ATTEMPTED')
        self.prior_admission=self.admission()
        require(self.prior_admission['state']['phase']=='OPEN','ADMISSION_ALREADY_CLOSED')
        env=dict(os.environ,DATABASE_URL=self.config['databaseUrl'])
        arguments=['exec','-i','-e','DATABASE_URL','-e','BACKEND_RUNTIME_ROLE=control',
            '-e','RECOVERY_COORDINATION_DIR='+grant['scope']['coordinationDirectory'],
            '-e','BACKEND_ONLINE_SCOPE_FILE='+grant['runtimeScopeFile'],
            '-e','BACKEND_ONLINE_SCOPE_SHA256='+grant['scopeSha256'],self.config['backend']['containerId'],
            '/usr/bin/python3','-I','-B','/app/scripts/online-runtime-owner.py',
            '/usr/bin/python3','-I','-B','/app/scripts/capture-coherent-components.py',self.runtime(component/'scope.json')]
        self.capture=self.docker(arguments,interactive=True,environment=env)
        def active():
            if not native_file.exists():return None
            raw=private_bytes(native_file);value=json.loads(raw)
            require(value['phase']=='ACTIVE' and value['onlineScope']['sha256']==grant['scopeSha256']
                and value['onlineScope']['scope']==grant['scope'],'NATIVE_ACTIVE_SCOPE_CHANGED')
            return raw
        self.capture_active=self.wait_for(active,self.capture,120,'NATIVE_ACTIVE_MISSING')
        def frozen():
            for line in self.capture.stdout.read_bytes().split(b'\n')[:-1]:
                value=json.loads(line)
                if value.get('phase')=='FROZEN':return value
            return None
        value=self.wait_for(frozen,self.capture,120,'FROZEN_HANDSHAKE_MISSING')
        require(value['handshake']==scope['handshake'] and len(value['versionedCuts'])==9,'FROZEN_HANDSHAKE_CHANGED')
        census_raw=private_bytes(component/'registered-backend-boundary.json',8*1024*1024)
        sqlite_runtimes=[runtime for runtime in json.loads(census_raw)['runtimes']if runtime.get('engine')=='sqlite']
        require(sqlite_runtimes and sorted(runtime['runtimeId']for runtime in sqlite_runtimes)==sorted(self.config['inquiryRuntimeIds'])
            and all(dict(path=runtime['sqlite']['file'],device=runtime['sqlite']['device'],inode=runtime['sqlite']['inode'])==scope['inquiry']
                    for runtime in sqlite_runtimes),'ORIGINAL_INQUIRY_NOT_ENROLLED')
        self.capture_census=census_raw
        self.complete(self.capture,encoded(dict(phase='BEGIN_CAPTURE',handshake=scope['handshake'],versionedCuts=value['versionedCuts'])))
        self.capture_closure=self.read_capture_closure()
        self.native_closed=True
        self.captured=json.loads(private_bytes(component/'captured.json',16*1024*1024))
        require(self.captured['nativeClaimSha256']==hashlib.sha256(self.capture_active).hexdigest()
                and self.captured['versionedCuts']==value['versionedCuts']
                and self.captured['registeredBackendBoundarySha256']==hashlib.sha256(census_raw).hexdigest(),'CAPTURE_CLAIM_CHANGED')
        return component

    def read_capture_closure(self):
        grant=self.config['capture']
        raw=private_bytes(Path(grant['nativeDirectoryHost'])/'deployment-runtime-native.json')
        final=json.loads(raw);active=json.loads(self.capture_active)
        require(final['phase']=='QUIESCENT' and final['nativeReaped'] is True and final['databaseQuiet'] is True
            and final['nativeStatus']==0 and final['stoppedBySignal'] is False
            and final['guardian']==active['guardian'] and final['onlineScope']==active['onlineScope']
            and final['activeClaimSha256']==hashlib.sha256(self.capture_active).hexdigest()
            and self.capture.process.returncode==0,'NATIVE_CAPTURE_CLOSURE_UNPROVEN')
        namespace=final['namespace'];require(re.fullmatch(r'sabalan-rt-[a-f0-9]{48}',namespace),'NATIVE_NAMESPACE_INVALID')
        require(self.query("SELECT to_json(count(*)) FROM pg_stat_activity WHERE application_name='"+namespace+"'")==0,
                'NATIVE_CAPTURE_SQL_ACTIVE')
        self.profile()
        observation=self.admission();opened=observation['state']
        require(opened['phase']=='OPEN' and opened['closureSha256']==hashlib.sha256(raw).hexdigest()
            and opened['generation']==self.prior_admission['state']['generation']+2
            and opened['capture']==dict(runtimeId=grant['runtimeId'],scopeSha256=grant['scopeSha256'],guardian=active['guardian']),
            'NATIVE_ADMISSION_NOT_REOPENED')
        scope_raw=private_bytes(grant['scopeFile'],immutable=True)
        declaration_file=Path(grant['boundaryDirectoryHost'])/'scope.json'
        declaration_raw=private_bytes(declaration_file)
        require(declaration_file.lstat().st_mode&0o777==0o600,'CAPTURE_DECLARATION_MODE_CHANGED')
        require(declaration_raw==self.capture_declaration,'CAPTURE_DECLARATION_CHANGED')
        intent_raw=private_bytes(self.root/'coherent/intent.json')
        intent=json.loads(intent_raw)
        require(intent['nativeClaimSha256']==hashlib.sha256(self.capture_active).hexdigest()
            and intent['namespace']==namespace and intent['captureId']==self.config['captureId'],'CAPTURE_INTENT_CHANGED')
        return dict(format='sabalan-original-confined-capture-closure/v1',purpose='capture',
            originalDockerPid=self.capture.process.pid,originalDockerStatus=self.capture.process.returncode,
            activeRawBase64=base64.b64encode(self.capture_active).decode(),nativeRawBase64=base64.b64encode(raw).decode(),
            scopeRawBase64=base64.b64encode(scope_raw).decode(),intentRawBase64=base64.b64encode(intent_raw).decode(),
            declarationRawBase64=base64.b64encode(declaration_raw).decode(),
            censusRawBase64=base64.b64encode(self.capture_census).decode(),
            admissionBeforeRawBase64=self.prior_admission['rawBase64'],admissionAfterRawBase64=observation['rawBase64'],
            freshNamespaceSessions=0,preparedTransactions=0)

    def finish_wal(self):
        coverage=load_coverage(self.config['helpers']['coverage']['file']);end=coverage.lsn(self.range['endLsn'])
        for _ in range(8):
            current=self.profile()
            require(current['timeline']==self.source['timeline'] and current['segmentBytes']==self.source['segmentBytes'],
                    'WAL_SOURCE_CHANGED')
            if coverage.lsn(current['currentLsn'])>=end:break
            # Canonical natural switch; never signal pg_receivewal or fake EOF.
            self.sql('SELECT pg_switch_wal()')
        require(coverage.lsn(self.profile()['currentLsn'])>=end,'WAL_END_NOT_REACHED')
        self.children.finish(self.receiver)
        raw=private_bytes(self.root/'receiver/capture-state.json')
        value=json.loads(raw)
        require(value['phase']=='COMPLETE' and value['nativeReaped'] is True and value['databaseQuiet'] is True
            and value['nativeStatus']==0 and value['namespace']==self.namespace
            and value['configurationSha256']==hashlib.sha256(private_bytes(self.root/'receiver/configuration.json',immutable=True)).hexdigest(),
            'WAL_NATIVE_CLOSURE_UNPROVEN')
        require(self.query("SELECT to_json(count(*)) FROM pg_stat_activity WHERE application_name='"+self.namespace+"'")==0,
                'WAL_SQL_STILL_ACTIVE')
        return value

    def inventory(self, base_directory, component, receiver, coverage):
        # Run the independent canonical reader in the runtime namespace where
        # source inodes/mounts were actually sealed.  Its full predecessor walk
        # and every selected PUT object are included, not just counts. Deleted
        # historical object bytes are not resurrected into a new backup policy.
        payload=dict(operation=self.config['captureId'],root=self.config['runtimeRoot'],
            component=self.runtime(component),base=self.runtime(base_directory),
            captured=self.captured,receiver=receiver,coverage=coverage,
            readerSha256=self.config['helpers']['reader']['sha256'])
        result=json.loads(self.complete(self.docker(['exec','-i',self.config['backend']['containerId'],'/usr/bin/python3','-I','-B','/app/scripts/online-checkpoint-inventory.py'],interactive=True),encoded(payload)))
        manifest_raw=private_bytes(self.root/'plaintext-components.json',64*1024*1024,True)
        require(hashlib.sha256(manifest_raw).hexdigest()==result['sha256'],'COMPONENT_MANIFEST_CHANGED')
        manifest=json.loads(manifest_raw)
        require(len(manifest['sources'])==result['sources'],'COMPONENT_MANIFEST_CHANGED')
        return result

    def prepare_original_source(self):
        self.ownership()
        require(not getattr(self,'original_source_prepared',False),'ORIGINAL_SOURCE_ALREADY_PREPARED')
        backend=self.inspect(self.config['backend'],'backend')
        postgres=self.inspect(self.config['postgres'],'postgres')
        # The same RW volume must map the freshly created host workspace;
        # do not invent docker cp/adoption paths to unrelated file roots.
        mappings=[row for row in backend['mounts'] if row['RW'] and row['Type']=='volume'
            and self.config['runtimeRoot'].startswith(row['Destination'].rstrip('/')+'/')]
        require(len(mappings)==1 and str(Path(mappings[0]['Source'])/str(Path(self.config['runtimeRoot']).relative_to(mappings[0]['Destination'])))
            ==str(self.root),'HOST_RUNTIME_MAPPING_CHANGED')
        password=self.provision_replication(backend,postgres)
        self.source=self.profile()
        self.range=load_coverage(self.config['helpers']['coverage']['file']).plan_receiver(self.source)
        self.original_source_prepared=True
        return dict(password=password,source=self.source,backend=backend,postgres=postgres)

    def capture_original_point(self):
        self.ownership()
        require(getattr(self,'original_source_prepared',False) and not getattr(self,'original_point',None),'ORIGINAL_POINT_NOT_READY')
        require(self.receiver is not None and self.receiver.process.poll() is None,'ORIGINAL_RECEIVER_NOT_ACTIVE')
        # Receiver is demonstrably streaming BEFORE either base or cut.
        base_args=[*host_runtime(self.config)['python'],self.config['helpers']['base']['file']]
        for key,value in [('project',self.config['project']),('operation-id',self.config['operationId']),
            ('image',self.config['postgres']['image']),('system-identifier',self.config['database']['systemIdentifier']),
            ('container',self.config['postgres']['containerId']),('root',str(self.root)),('lock-file',self.config['lockFile']),
            ('supervisor',self.config['helpers']['supervisor']['file']),('supervisor-sha256',self.config['helpers']['supervisor']['sha256'])]:
            base_args+=['--'+key,value]
        base_environment=self.prepare_docker_guard()
        require(hashlib.sha256(private_bytes(self.guard_file)).hexdigest()==self.guard_sha,'DOCKER_GUARD_MISSING')
        base=self.command('physical-base',base_args,inherited=(9,),environment=base_environment)
        base_value=json.loads(self.children.finish(base))
        component=self.begin_capture()
        self.original_point=dict(base_value=base_value,component=component)
        self.original_point_children=dict(base_child=base,capture_child=self.capture,receiver_child=self.receiver)
        return self.original_point.copy()

    def closed_original_point_children(self):
        self.ownership()
        scoped=[]
        for role,key in [('physical-base','base_child'),('coherent-capture','capture_child'),('initial-wal','receiver_child')]:
            child=self.original_point_children[key]
            require(any(owned is child for owned in self.children.children) and child.process is not None
                and child.process.poll()==0 and not child.errors and not child.overflow
                and all(not thread.is_alive() for thread in child.threads),'ORIGINAL_POINT_CHILD_NOT_CLOSED')
            scoped.append(dict(role=role,originalPid=child.process.pid,returncode=child.process.returncode,signal=None,stdoutSha256=hashlib.sha256(child.stdout.read_bytes()).hexdigest(),stderrSha256=hashlib.sha256(child.stderr.read_bytes()).hexdigest()))
        return scoped

    def close_original_point(self,receiver,receiver_active,sender):
        self.ownership()
        require(getattr(self,'original_point',None) and not getattr(self,'original_point_closed',False),'ORIGINAL_POINT_NOT_READY')
        require(self.receiver.process.poll()==0,'ORIGINAL_RECEIVER_NOT_CLOSED')
        base_value=self.original_point['base_value'];component=self.original_point['component']
        self.receiver_active=receiver_active
        configuration=dict(self.range,**{key:self.source[key]for key in ('databaseName','databaseOid','systemIdentifier','timeline','segmentBytes')})
        coverage=load_coverage(self.config['helpers']['coverage']['file']).validate_coverage(base_value,self.captured,receiver,configuration)
        coverage.update(physicalBaseProof=base_value,originalReceiverActiveRawBase64=base64.b64encode(self.receiver_active).decode(),
            originalSender=sender,captureClosure=self.capture_closure,
            originalReceiverDockerPid=self.receiver.process.pid,originalReceiverDockerStatus=self.receiver.process.returncode)
        publish(self.root/'coverage.json',coverage)
        inventory=self.inventory(self.root/self.config['operationId'],component,receiver,coverage)
        scoped=self.closed_original_point_children()
        result=dict(format='sabalan-original-online-checkpoint-producer-result/v1',phase='POINT_COMPONENTS_MATERIALIZED',originalPointChildren=scoped,
            captureId=self.config['captureId'],manifestFile=str(self.root/'plaintext-components.json'),manifestRuntimeFile=self.runtime(self.root/'plaintext-components.json'),
            manifestSha256=inventory['sha256'],sources=inventory['sources'],
            captureClosure=self.capture_closure,physicalBaseProof=base_value,walClosure=receiver,
            independentRestoreVerified=False,remoteVerified=False,healthyRecoveryPoint=False,productionAdmission=False)
        self.original_point_closed=True
        return result

    def run(self):
        for number in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP):
            signal.signal(number,lambda _signal,_frame:setattr(self,'cancelled',True))
        try:
            prepared=self.prepare_original_source()
            password=prepared['password']
            receiver_root=self.prepare_receiver(password)
            def streaming():
                result=self.query("SELECT json_build_object('count',count(*),'pid',min(pid)) FROM pg_stat_replication WHERE "
                    "application_name='"+self.namespace+"' AND state='streaming' AND usename='"+self.replication_user+
                    "' AND host(client_addr)='"+self.config['backend']['privateAddress']+"'")
                if result['count']==0:return None
                require(result['count']==1,'REPLICATION_IDENTITY_AMBIGUOUS')
                return result
            sender=self.wait_for(streaming,self.receiver,30,'RECEIVER_NOT_STREAMING')
            self.receiver_active=private_bytes(receiver_root/'capture-state.json')
            active=json.loads(self.receiver_active)
            require(active['phase']=='ACTIVE' and active['namespace']==self.namespace
                and active['configurationSha256']==hashlib.sha256(private_bytes(receiver_root/'configuration.json',immutable=True)).hexdigest(),
                'RECEIVER_ORIGINAL_ACTIVE_UNPROVEN')
            self.capture_original_point()
            receiver=self.finish_wal()
            result=self.close_original_point(receiver,self.receiver_active,sender)
            self.cleanup_replication()
            self.inspect(self.config['backend'],'backend');self.inspect(self.config['postgres'],'postgres')
            require(self.children.closed() and not self.cancelled,'ORIGINAL_CHILDREN_NOT_CLOSED')
            result.update(phase='PLAINTEXT_COMPONENTS_CLOSED',allOriginalChildrenClosed=True)
            publish(self.root/'producer-result.json',result)
            print(json.dumps(result),flush=True)
        except BaseException:
            # No loss of client acknowledgement is daemon/native completion.
            # Keep all handles and FD9; never reconstruct/adopt a prior owner.
            self.held('ORIGINAL_COMPONENT_OUTCOME_UNPROVEN')


def load_coverage(file):
    spec = importlib.util.spec_from_file_location('online_checkpoint_coverage', file)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module


def lease_assertion(lease):
    quote=lambda value:"'"+value.replace("'","''")+"'"
    for key in ('deploymentId','releaseId','leaseToken'):
        require(isinstance(lease[key],str) and re.fullmatch(r'[a-zA-Z0-9_-]{8,128}',lease[key]),'LEASE_IDENTITY_INVALID')
    advisory=lease['advisory']
    require(type(advisory['pid'])is int and advisory['pid']>0 and isinstance(advisory['birth'],str)
        and len(advisory['birth'])<=128,'ADVISORY_IDENTITY_INVALID')
    return ("DO $owned$ BEGIN IF NOT EXISTS(SELECT 1 FROM deployment_operations WHERE id="+quote(lease['deploymentId'])+
        ' AND "releaseId"='+quote(lease['releaseId'])+' AND "leaseToken"='+quote(lease['leaseToken'])+
        " AND \"activeKey\"='production' AND phase='ONLINE_CHECKPOINTING' AND \"leaseExpiresAt\">clock_timestamp()+interval '20 seconds') "
        "OR NOT EXISTS(SELECT 1 FROM pg_stat_activity a JOIN pg_locks l ON l.pid=a.pid WHERE a.pid="+str(advisory['pid'])+
        " AND a.backend_start::text="+quote(advisory['birth'])+" AND l.locktype='advisory' AND l.classid=0 AND l.objid=741936425 "
        "AND l.objsubid=1 AND l.granted AND l.mode='ExclusiveLock') THEN RAISE EXCEPTION 'ORIGINAL_CHECKPOINT_LEASE_LOST'; END IF; END $owned$;\n")


def local_dev_validator(config):
    require(config.get('project')=='sabalanerp-local' and 'localDevSuspension' in config,'LOCAL_DEV_EXPLICIT_LOCAL_SCOPE_REQUIRED')
    pin=config['helpers']['localDevSuspension'];file=Path(pin['file'])
    require(source_sha(file)==pin['sha256'],'LOCAL_DEV_VALIDATOR_SOURCE_CHANGED')
    spec=importlib.util.spec_from_file_location('sabalan_fixed_local_dev_suspension',file);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    module.validate_scope(config);return module


def inspect_local_dev_suspension(config,run):
    if 'localDevSuspension' not in config:return
    module=local_dev_validator(config);receipt=module.validate_scope(config)
    actual=json.loads(run(['inspect',receipt['frontend']['id']]))
    require(isinstance(actual,list)and len(actual)==1,'LOCAL_DEV_EXACT_INSPECT_REQUIRED');module.validate_inspected(actual[0],config)


def validate_census(rows, expected, project='sabalanerp',configuration_only=False,local_context=None):
    require(project in ('sabalanerp','sabalanerp-local'),'CENSUS_CHANGED')
    if local_context is not None:
        require(project=='sabalanerp-local'and not configuration_only and local_context['project']==project,'LOCAL_DEV_PRODUCTION_OR_CONFIG_WAIVER_REFUSED')
        local_dev_validator(local_context).validate_rows(rows,local_context)
    elif project=='sabalanerp-local' and not configuration_only:
        require(len(rows)==10 and all(row.get('State')=='running'and row.get('Health')=='healthy'for row in rows),'LOCAL_CANONICAL_SERVICES_UNHEALTHY')
    require(isinstance(expected,list) and expected and len(expected)==len(set(expected))
        and all(isinstance(item,str)and re.fullmatch(r'[a-f0-9]{64}',item)for item in expected),'CENSUS_CHANGED')
    require(isinstance(rows,list) and len(rows)==len(expected)
        and all(row.get('Project')==project for row in rows)
        and sorted(row.get('ID','')for row in rows)==sorted(expected),'CENSUS_CHANGED')


def source_sha(file,maximum=64*1024*1024,allow_empty=False):
    file=Path(file)
    require(file.is_absolute()and file.resolve(strict=True)==file,'FIXED_SOURCE_ALIAS')
    fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        before=os.fstat(fd)
        require(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_nlink==1
            and not before.st_mode&0o022 and (0 if allow_empty else 1)<=before.st_size<=maximum,'FIXED_SOURCE_UNSAFE')
        result=hashlib.sha256()
        while chunk:=os.read(fd,262144):result.update(chunk)
        key=lambda item:(item.st_dev,item.st_ino,item.st_size,item.st_mtime_ns,item.st_ctime_ns,item.st_mode,item.st_uid,item.st_nlink)
        require(key(before)==key(os.fstat(fd))==key(file.lstat()),'FIXED_SOURCE_CHANGED')
        return result.hexdigest()
    finally:os.close(fd)


def assert_host_lock(config):
    inherited=os.fstat(9);named=Path(config['lockFile']).lstat()
    require(Path(config['lockFile']).resolve(strict=True)==Path(config['lockFile'])
        and stat.S_ISREG(named.st_mode)and named.st_uid==0 and named.st_nlink==1 and named.st_size==0
        and not named.st_mode&0o022 and(named.st_dev,named.st_ino)==(inherited.st_dev,inherited.st_ino),'HOST_LOCK_CHANGED')
    require(any(re.fullmatch(r'lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+\S+\s+[0-9a-f]+:[0-9a-f]+:'
        +str(inherited.st_ino)+r'\s+0\s+EOF\s*',line)for line in Path('/proc/self/fdinfo/9').read_text().splitlines()),'HOST_LOCK_REQUIRED')
    return inherited.st_dev,inherited.st_ino


def docker_guard(arguments):
    require(sys.platform=='linux' and os.getuid()==0 and len(arguments)>=3,'DOCKER_GUARD_REQUIRED')
    configuration,sha,*command=arguments
    raw=private_bytes(configuration,immutable=True)
    require(hashlib.sha256(raw).hexdigest()==sha,'DOCKER_GUARD_CONFIGURATION_CHANGED')
    value=validate_configuration(json.loads(raw))
    assert_host_lock(value)
    # This shim only gates the existing canonical helper's fixed command set;
    # it supplies no generic daemon/provisioning/reset/force operation.
    require(command and command[0]in ('inspect','info','exec','cp'),'DOCKER_GUARD_COMMAND_REFUSED')
    runtime=host_runtime(value);binary=Path(runtime['docker'][0])
    require(source_sha(binary)==value['dockerSha256'] and source_sha(value['composeFile'])==value['composeSha256'], 'GENUINE_DOCKER_CHANGED')
    guard_directory=Path(value['root'])/'physical-base-docker-guard'
    require(guard_directory.resolve(strict=True)==guard_directory and guard_directory.stat().st_uid==0
        and not guard_directory.stat().st_mode&0o077,'DOCKER_GUARD_DIRECTORY_INVALID')
    # Each invocation owns its own bounded census client and closure before
    # exec replaces THIS shim with the absolute genuine Docker client.
    evidence=guard_directory/('invocation-'+secrets.token_hex(16));evidence.mkdir(mode=0o700)
    owner=OriginalChildren(evidence,lambda:require(private_bytes(configuration,immutable=True)==raw,'CONFIGURATION_CHANGED'),retained_fds=(9,))
    census=owner.start('compose-ps',[*runtime['docker'],'compose','-f',value['composeFile'],'-p',value['project'],'ps','--all','--no-trunc','--format','json'])
    output=owner.finish(census)
    rows=json.loads(output)if output.lstrip().startswith(b'[')else[json.loads(line)for line in output.splitlines()if line]
    validate_census(rows,value['expectedContainerIds'],value['project'],local_context=value if 'localDevSuspension'in value else None)
    inspect_local_dev_suspension(value,lambda args:owner.finish(owner.start('local-dev-inspect',[*runtime['docker'],*args])))
    require(owner.closed(),'DOCKER_GUARD_CENSUS_NOT_CLOSED')
    os.execv(str(binary),[*runtime['docker'],*command])


def validate_configuration(value):
    require(value.get('format') == 'sabalan-original-online-checkpoint-producer/v1', 'CONFIGURATION_INVALID')
    require(value.get('project')in ('sabalanerp','sabalanerp-local'), 'FIXED_PROJECT_REQUIRED')
    if 'localDevSuspension'in value:
        require(value['project']=='sabalanerp-local','LOCAL_DEV_PRODUCTION_SCOPE_REFUSED');local_dev_validator(value)
    if value['project']=='sabalanerp-local':
        require(Path(value['composeFile']).name=='docker-compose.local.yml'
            and re.fullmatch(r'qa_application_(?:native|restored)_[a-f0-9]{32}',value['database']['name']), 'LOCAL_ISOLATED_DATABASE_REQUIRED')
    require(Path(value['composeFile']).is_absolute() and re.fullmatch(r'[a-f0-9]{64}',value['dockerSha256'])
            and re.fullmatch(r'[a-f0-9]{64}',value['composeSha256']), 'FIXED_DOCKER_INPUT_REQUIRED')
    validate_census([dict(ID=item,Project=value['project'])for item in value['expectedContainerIds']],value['expectedContainerIds'],value['project'],configuration_only=True)
    lease_assertion(value['lease'])
    require(re.fullmatch(r'[a-f0-9]{64}', value.get('captureId', '')), 'CAPTURE_ID_INVALID')
    require(re.fullmatch(r'[a-z][a-z0-9-]{7,95}', value.get('operationId', '')), 'OPERATION_INVALID')
    for role in ('backend', 'postgres'):
        actor = value[role]
        require(re.fullmatch(r'[a-f0-9]{64}', actor['containerId'])
                and re.fullmatch(r'sha256:[a-f0-9]{64}', actor['image']), 'CONTAINER_IDENTITY_INVALID')
    grant = value['capture']
    require(grant['scope']['purpose'] == 'capture' and grant['scope']['format'] == 'sabalan-online-runtime-scope/v2'
            and grant['scope']['runtimeId'] == grant['runtimeId']
            and grant['scope']['database'] == {key:value['database'][key]for key in ('name','systemIdentifier')}
            and grant['scope']['image']==value['backend']['image'], 'CAPTURE_SCOPE_INVALID')
    require(len(value['sources']) == 9 and len({item['name'] for item in value['sources']}) == 9, 'NINE_ROOTS_REQUIRED')
    require(isinstance(value.get('inquiryRuntimeIds'),list) and value['inquiryRuntimeIds']
            and len(set(value['inquiryRuntimeIds']))==len(value['inquiryRuntimeIds'])
            and all(re.fullmatch(r'[a-f0-9]{64}',item)for item in value['inquiryRuntimeIds']), 'ORIGINAL_INQUIRY_REQUIRED')
    for name in ('receiver', 'base', 'owner', 'capture', 'supervisor', 'coverage', 'reader', 'inventory', 'producer'):
        pin = value['helpers'][name]
        require(Path(pin['file']).is_absolute() and re.fullmatch(r'[a-f0-9]{64}', pin['sha256']), 'HELPER_PIN_INVALID')
    validate_host_runtime(value)
    return value


def create_original_producer(configuration_file, expected):
    """Construct only after the exact original CLI ownership checks.

    The persistent launcher uses this in-process so its SAME FD9, original
    children and replication authentication survive the entire release.
    """
    require(sys.platform == 'linux' and os.getuid() == 0, 'ORIGINAL_HOST_REQUIRED')
    file = Path(configuration_file)
    require(re.fullmatch(r'[a-f0-9]{64}', expected), 'CONFIGURATION_SHA_REQUIRED')
    raw = private_bytes(file, immutable=True)
    require(hashlib.sha256(raw).hexdigest() == expected, 'CONFIGURATION_CHANGED')
    config = validate_configuration(json.loads(raw))
    config['configurationFile']=str(file);config['configurationSha256']=expected
    root = Path(config['root'])
    require(root.is_absolute() and root.resolve(strict=True) == root and file.parent == root
            and root.stat().st_uid == 0 and not root.stat().st_mode & 0o077, 'ROOT_INVALID')
    require(sorted(os.listdir(root))==[file.name],'FRESH_ORIGINAL_ROOT_REQUIRED')
    inherited = assert_host_lock(config)
    fixed_sources={}
    for source,sha in [(host_runtime(config)['docker'][0],config['dockerSha256']),(config['composeFile'],config['composeSha256']),*host_runtime(config)['pins'].items()]:
        require(source_sha(source,allow_empty=source in host_runtime(config)['pins'])==sha,'FIXED_DOCKER_SOURCE_CHANGED')
        observed=Path(source).lstat()
        fixed_sources[source]=(observed.st_dev,observed.st_ino,observed.st_size,observed.st_mtime_ns,observed.st_ctime_ns,observed.st_mode,observed.st_uid,observed.st_nlink)

    def ownership():
        require(private_bytes(file, immutable=True) == raw, 'CONFIGURATION_CHANGED')
        for source,expected_identity in fixed_sources.items():
            observed=Path(source).lstat()
            require(Path(source).resolve(strict=True)==Path(source)
                and (observed.st_dev,observed.st_ino,observed.st_size,observed.st_mtime_ns,observed.st_ctime_ns,observed.st_mode,observed.st_uid,observed.st_nlink)==expected_identity,
                'FIXED_DOCKER_SOURCE_CHANGED')
        for pin in config['helpers'].values():
            require(hashlib.sha256(private_bytes(pin['file'], maximum=16*1024*1024, immutable=True)).hexdigest()==pin['sha256'],'HELPER_CHANGED')
        require(assert_host_lock(config)==inherited,'HOST_LOCK_CHANGED')

    ownership()
    for pin in config['helpers'].values():
        require(hashlib.sha256(private_bytes(pin['file'], maximum=16*1024*1024, immutable=True)).hexdigest() == pin['sha256'], 'HELPER_CHANGED')
    owner = OriginalChildren(root, ownership, retained_fds=(9,))
    return Producer(config, owner, ownership)


def main():
    require(len(sys.argv) == 3, 'ORIGINAL_HOST_ARGUMENTS_REQUIRED')
    create_original_producer(sys.argv[1], sys.argv[2]).run()


if __name__ == '__main__':
    try:
        if len(sys.argv)>1 and sys.argv[1]=='--docker-guard':docker_guard(sys.argv[2:])
        else:main()
    except BaseException as error:
        sys.stderr.write('ONLINE_CHECKPOINT_PRODUCER_FAILED:' + type(error).__name__ + '\n')
        raise SystemExit(1)
