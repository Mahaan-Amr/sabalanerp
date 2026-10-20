"""Private native schema/client preparation; no serving or production authority."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import stat
from urllib.parse import urlsplit


def digest(file):
    value = hashlib.sha256()
    with file.open('rb') as source:
        while chunk := source.read(262144):
            value.update(chunk)
    return value.hexdigest()


def inventory(directory, check):
    rows, total = [], 0
    for parent, directories, files in os.walk(directory, followlinks=False):
        check(len(rows) + len(directories) + len(files) <= 2000, 'PRIVATE_PRISMA_INVENTORY_CAPACITY')
        for name in directories:
            value = (Path(parent) / name).lstat()
            check((Path(parent) / name).is_dir() and not (Path(parent) / name).is_symlink(), 'PRIVATE_PRISMA_DIRECTORY_ALIAS')
        for name in files:
            file = Path(parent) / name
            value = file.lstat()
            check(file.is_file() and not file.is_symlink() and value.st_nlink == 1 and value.st_uid == os.getuid(), 'PRIVATE_PRISMA_FILE_UNSAFE')
            total += value.st_size
            check(total <= 256 * 1024**2, 'PRIVATE_PRISMA_INVENTORY_CAPACITY')
            rows.append(dict(path=str(file.relative_to(directory)), bytes=value.st_size, sha256=digest(file)))
    rows.sort(key=lambda value: value['path'])
    return dict(files=len(rows), bytes=total, sha256=hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(',', ':')).encode()).hexdigest())


def generate(root, write, encoded, check):
    source = json.loads((root / 'prisma-source-inventory.json').read_bytes())
    check(source['format'] == 'sabalan-private-prisma-source/v1', 'PRIVATE_PRISMA_SOURCE_INVALID')
    original = (root / 'prisma-schema-source.prisma').read_bytes()
    check(hashlib.sha256(original).hexdigest() == source['schemaSha256'], 'PRIVATE_PRISMA_SCHEMA_CHANGED')
    private = root / 'private-prisma'; private.mkdir(mode=0o700)
    (root / 'node_modules').mkdir(mode=0o700)
    (root / 'node_modules/@prisma').mkdir(mode=0o700)
    output = root / 'node_modules/@prisma/client'
    text = original.decode()
    expected = 'generator client {\n  provider      = "prisma-client-js"\n  binaryTargets = ["native", "debian-openssl-3.0.x"]\n}'
    check(text.count(expected) == 1, 'PRIVATE_PRISMA_GENERATOR_UNRECOGNIZED')
    # Invoke the exact installed official generator without resolving a package
    # from this deliberately dependency-free cwd or permitting auto-install.
    replacement = 'generator client {\n  provider = "node /app/node_modules/@prisma/client/generator-build/index.js"\n  binaryTargets = ["native"]\n  output = ' + json.dumps(str(output)) + '\n}'
    schema = text.replace(expected, replacement).encode()
    write(private / 'schema.prisma', schema)
    migrations = private / 'migrations'; migrations.mkdir(mode=0o700)
    write(migrations / 'migration_lock.toml', (root / 'prisma-migration-lock.toml').read_bytes())
    for selected in source['migrations']:
        check(re.fullmatch(r'\d{14}_[a-zA-Z0-9_]+', selected['name']), 'PRIVATE_PRISMA_MIGRATION_NAME')
        data = (root / selected['file']).read_bytes()
        check(len(data) == selected['bytes'] and hashlib.sha256(data).hexdigest() == selected['sha256'], 'PRIVATE_PRISMA_MIGRATION_CHANGED')
        target = migrations / selected['name']; target.mkdir(mode=0o700)
        write(target / 'migration.sql', data)
    tool_facts = subprocess.run(['node', '-e', "const p=require('/app/node_modules/prisma/package.json'),c=require('/app/node_modules/@prisma/client/package.json');if(p.version!==c.version)throw Error('PRISMA_VERSION_MISMATCH');console.log(JSON.stringify({cli:p.version,client:c.version,cliFile:require.resolve('/app/node_modules/prisma/build/index.js')}))"], stdin=subprocess.DEVNULL, capture_output=True)
    check(tool_facts.returncode == 0, 'PRIVATE_PRISMA_TOOLCHAIN_MISMATCH')
    facts = json.loads(tool_facts.stdout)
    facts['cliSha256'] = digest(Path(facts['cliFile']))
    facts['generatorSha256'] = digest(Path('/app/node_modules/@prisma/client/generator-build/index.js'))
    engine_root = Path('/app/node_modules/@prisma/engines')
    engine_paths = dict(PRISMA_QUERY_ENGINE_LIBRARY=engine_root / 'libquery_engine-debian-openssl-3.0.x.so.node',
                        PRISMA_SCHEMA_ENGINE_BINARY=engine_root / 'schema-engine-debian-openssl-3.0.x')
    facts['localEngines'] = {name: dict(path=str(file), sha256=digest(file)) for name, file in engine_paths.items()}
    check(facts['cli'] == '5.22.0', 'PRIVATE_PRISMA_TOOLCHAIN_UNSUPPORTED')
    env = dict(os.environ, PRISMA_GENERATE_SKIP_AUTOINSTALL='1', CHECKPOINT_DISABLE='1', PRISMA_HIDE_UPDATE_MESSAGE='1',
               **{key: str(value) for key, value in engine_paths.items()})
    # No database connection, package install or second service is involved.
    with (root / 'prisma-generate.stdout').open('xb') as out, (root / 'prisma-generate.stderr').open('xb') as err:
        child = subprocess.Popen(['node', facts['cliFile'], 'generate', '--schema', str(private / 'schema.prisma')], env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err)
    birth = (Path('/proc') / str(child.pid) / 'stat').read_text().rsplit(') ', 1)[1].split()
    write(root / 'generation-process-birth.json', encoded(dict(pid=child.pid, startTicks=birth[19],
        bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip())))
    child.wait(timeout=120)
    write(root / 'generation-process-result.json', encoded(dict(pid=child.pid, returncode=child.returncode)))
    check(child.returncode == 0, 'PRIVATE_PRISMA_GENERATION_FAILED')
    probe = subprocess.run(['node', '-e', "const p=require(process.argv[1]);const c=new p.PrismaClient();try{for(const n of ['deploymentOperation','onlineRelease','onlineMigrationStep'])if(typeof c[n]?.count!=='function')throw Error('MISSING_'+n);console.log(JSON.stringify({version:p.Prisma.prismaVersion,models:p.Prisma.dmmf.datamodel.models.length}));}finally{c.$disconnect()}", str(output)], stdin=subprocess.DEVNULL, capture_output=True)
    check(probe.returncode == 0, 'PRIVATE_PRISMA_GENERATED_DELEGATES_MISSING')
    generated = json.loads(probe.stdout)
    check(generated['version']['client'] == facts['client'], 'PRIVATE_PRISMA_GENERATED_VERSION_MISMATCH')
    check(generated['version']['engine'] == '605197351a3c8bdd595af2d2a9bc3025bca48ea2', 'PRIVATE_PRISMA_ENGINE_VERSION_MISMATCH')
    capsule = inventory(output, check)
    proof = dict(format='sabalan-private-generated-prisma/v1', schemaSha256=source['schemaSha256'],
        generatedSchemaSha256=hashlib.sha256(schema).hexdigest(), generatorOnlyTransform=True,
        migrationCount=len(source['migrations']), toolchain=facts, generated=generated, capsule=capsule,
        sharedClientModified=False, productionAdmission=False)
    write(root / 'generated-prisma-proof.json', encoded(proof))
    return proof


def assemble_host(root, write, encoded, check):
    source = json.loads((root / 'prisma-source-inventory.json').read_bytes())
    artifact = json.loads((root / 'host-prisma-artifact.json').read_bytes())
    linux_generation = artifact.get('privateLinuxGeneration')
    linux_generated = linux_generation is not None
    check(artifact['format'] == ('sabalan-official-linux-prisma-artifact/v1' if linux_generated else 'sabalan-official-host-prisma-artifact/v1')
          and artifact['sourceSchemaSha256'] == source['schemaSha256']
          and artifact['version'] == dict(client='5.22.0', engine='605197351a3c8bdd595af2d2a9bc3025bca48ea2')
          and artifact['linuxGenerated'] is linux_generated and artifact['manualModelChanges'] is False,
          'PRIVATE_PRISMA_HOST_ARTIFACT_INVALID')
    private = root / 'private-prisma'; private.mkdir(mode=0o700)
    original = (root / 'prisma-schema-source.prisma').read_bytes()
    check(hashlib.sha256(original).hexdigest() == source['schemaSha256'], 'PRIVATE_PRISMA_SCHEMA_CHANGED')
    model_names = sorted(name.decode() for name in re.findall(rb'^model\s+(\w+)\s*\{', original, re.M))
    check(len(model_names) > 0 and artifact['models'] == len(model_names), 'PRIVATE_PRISMA_HOST_MODEL_BASELINE_CHANGED')
    write(private / 'schema.prisma', original)
    migrations = private / 'migrations'; migrations.mkdir(mode=0o700)
    write(migrations / 'migration_lock.toml', (root / 'prisma-migration-lock.toml').read_bytes())
    for selected in source['migrations']:
        check(re.fullmatch(r'\d{14}_[a-zA-Z0-9_]+', selected['name']), 'PRIVATE_PRISMA_MIGRATION_NAME')
        data = (root / selected['file']).read_bytes()
        check(len(data) == selected['bytes'] and hashlib.sha256(data).hexdigest() == selected['sha256'], 'PRIVATE_PRISMA_MIGRATION_CHANGED')
        target = migrations / selected['name']; target.mkdir(mode=0o700); write(target / 'migration.sql', data)
    output = root / 'node_modules/@prisma/client'; output.mkdir(parents=True, mode=0o700)
    # Every JS/model byte is copied unchanged from the official generated output.
    for selected in artifact['entries']:
        target = Path(selected['target'])
        check(not target.is_absolute() and '..' not in target.parts and len(target.parts) <= 2, 'PRIVATE_PRISMA_HOST_PATH_INVALID')
        data = (root / selected['file']).read_bytes()
        check(len(data) == selected['bytes'] and hashlib.sha256(data).hexdigest() == selected['sha256'], 'PRIVATE_PRISMA_HOST_BYTES_CHANGED')
        (output / target).parent.mkdir(mode=0o700, exist_ok=True)
        write(output / target, data)
    generated_schema = (output / 'schema.prisma').read_bytes()
    check(hashlib.sha256(generated_schema).hexdigest() == artifact['generatedSchemaSha256'], 'PRIVATE_PRISMA_HOST_SCHEMA_CHANGED')
    private_generation = artifact.get('privateHostGeneration')
    check(not (private_generation is not None and linux_generated), 'PRIVATE_PRISMA_GENERATION_PROVENANCE_CONFLICT')
    if linux_generated:
        private_generation = linux_generation
        current_local = private_generation.get('provenanceKind') == 'ORIGINAL_CANONICAL_LOCAL_BACKEND_EXEC'
        if current_local:
            check(re.fullmatch(r'private-local-linux-prisma-[a-f0-9]{32}', private_generation['operation'])
                  and private_generation['sourceSchemaSha256'] == source['schemaSha256']
                  and re.fullmatch(r'[a-f0-9]{64}', private_generation['helperSha256'])
                  and private_generation['helperSha256'] == private_generation['remoteEnvelopeSha256']
                  and re.fullmatch(r'[a-f0-9]{64}', private_generation['containerId'])
                  and re.fullmatch(r'sha256:[a-f0-9]{64}', private_generation['imageIdentity'])
                  and isinstance(private_generation['originalGeneratorPid'], int) and private_generation['originalGeneratorPid'] > 0
                  and private_generation['originalGeneratorCode'] == 0
                  and private_generation['allOriginalChildrenClosed'] is True
                  and private_generation['allTenIdentitiesUnchanged'] is True
                  and re.fullmatch(r'[a-f0-9]{64}', private_generation['extractionReceiptSha256']),
                  'PRIVATE_PRISMA_LOCAL_LINUX_PROVENANCE_UNREVIEWED')
        else:
            check(private_generation['operation'] == 'private-linux-prisma-generation-e380da106b5e41789f02b9e986f83d37'
                  and private_generation['remoteEnvelopeSha256'] == '284e18fdf8052ca401b29603cac95ed19e0f852f505d35668812f4365e7e6e1b'
                  and artifact['models'] == 548
                  and re.fullmatch(r'[a-f0-9]{64}', private_generation['extractionReceiptSha256']),
                  'PRIVATE_PRISMA_LINUX_PROVENANCE_UNREVIEWED')
    if private_generation is not None:
        check(artifact.get('generatorOnlyTransform') is True and private_generation.get('generatorOnlyTransform') is True
              and re.fullmatch((r'private-local-linux-prisma-[a-f0-9]{32}' if private_generation.get('provenanceKind') == 'ORIGINAL_CANONICAL_LOCAL_BACKEND_EXEC' else r'private-linux-prisma-generation-[a-f0-9]{32}') if linux_generated else r'private-host-prisma-[a-f0-9]{32}', private_generation['operation'])
              and re.fullmatch(r'[a-f0-9]{64}', private_generation['receiptSha256'])
              and re.fullmatch(r'[a-f0-9]{64}', private_generation['transformedSchemaSha256']),
              'PRIVATE_PRISMA_HOST_TRANSFORM_NOT_PROVEN')
        check(artifact['transformedSchemaFile'] == 'host-prisma-transform-source.prisma', 'PRIVATE_PRISMA_TRANSFORM_PATH_INVALID')
        transformed = root / artifact['transformedSchemaFile']
        check(digest(transformed) == private_generation['transformedSchemaSha256'], 'PRIVATE_PRISMA_TRANSFORM_SOURCE_CHANGED')
    else:
        transformed = root / 'prisma-schema-source.prisma'
    # Reuse the exact reviewed sticky lexer in the native namespace. Formatting
    # whitespace may differ, but every quoted token and all model/data tokens
    # must remain exact. Only the proven client generator may differ from source.
    lexical = subprocess.run(['node', '--input-type=module', '-e',
        "import fs from 'node:fs';import assert from 'node:assert/strict';import{pathToFileURL}from'node:url';const{schemaTokens,schemaTokenDigest}=await import(pathToFileURL(process.argv[1]).href);const[source,generated,transformed]=process.argv.slice(2).map(f=>fs.readFileSync(f,'utf8'));const without=s=>{assert.equal([...s.matchAll(/^generator client \\{[\\s\\S]*?^\\}/gm)].length,1);return s.replace(/^generator client \\{[\\s\\S]*?^\\}/gm,'')};assert.deepEqual(schemaTokens(generated),schemaTokens(transformed));assert.deepEqual(schemaTokens(without(transformed)),schemaTokens(without(source)));console.log(JSON.stringify({transformed:schemaTokenDigest(transformed),generated:schemaTokenDigest(generated)}))",
        str(root / 'prisma-schema-tokens.mjs'), str(root / 'prisma-schema-source.prisma'), str(output / 'schema.prisma'), str(transformed)],
        stdin=subprocess.DEVNULL, capture_output=True)
    check(lexical.returncode == 0, 'PRIVATE_PRISMA_HOST_SCHEMA_SEMANTICS_CHANGED')
    lexical_proof = json.loads(lexical.stdout)
    if private_generation is not None:
        check(lexical_proof['transformed'] == private_generation['transformedSchemaTokensSha256']
              and lexical_proof['generated'] == private_generation['generatedSchemaTokensSha256'], 'PRIVATE_PRISMA_SCHEMA_TOKEN_DIGEST_CHANGED')
    inline = [line.lstrip()[len('"inlineSchema":'):].rstrip(',') for line in (output / 'index.js').read_text().splitlines()
              if line.lstrip().startswith('"inlineSchema":')]
    check(len(inline) == 1 and json.loads(inline[0]).encode() == generated_schema, 'PRIVATE_PRISMA_HOST_INLINE_SCHEMA_CHANGED')
    engine = Path('/app/node_modules/@prisma/engines/libquery_engine-debian-openssl-3.0.x.so.node')
    runtime = Path('/app/node_modules/@prisma/client/runtime/library.js')
    check(digest(output / engine.name) == digest(engine) and digest(output / 'runtime/library.js') == digest(runtime), 'PRIVATE_PRISMA_HOST_LINUX_IDENTITY_MISMATCH')
    probe = subprocess.run(['node', '-e', "const c=require(process.argv[1]);const db=new c.PrismaClient();(async()=>{try{for(const key of ['onlineRelease','onlineMigrationStep','onlineRuntimeSlot','deploymentOperation','onlineRealtimeBatch','onlineRealtimeCommand','onlineHrInvalidationIntent'])if(typeof db[key]?.count!=='function')throw Error('MISSING_'+key);const names=c.Prisma.dmmf.datamodel.models.map(m=>m.name).sort();if(JSON.stringify(names)!==process.argv[2])throw Error('MODEL_NAMES');console.log(JSON.stringify({version:c.Prisma.prismaVersion,models:c.Prisma.dmmf.datamodel.models.length,dmmfSha256:require('crypto').createHash('sha256').update(JSON.stringify(c.Prisma.dmmf)).digest('hex')}))}finally{await db.$disconnect()}})().catch(e=>{console.error(e.message);process.exitCode=1})", str(output), json.dumps(model_names, separators=(',', ':'))], stdin=subprocess.DEVNULL, capture_output=True)
    check(probe.returncode == 0, 'PRIVATE_PRISMA_HOST_DELEGATE_MISSING')
    generated = json.loads(probe.stdout)
    check(generated['dmmfSha256'] == artifact['dmmfSha256'] and generated['version'] == artifact['version'], 'PRIVATE_PRISMA_HOST_DMMF_CHANGED')
    proof = dict(format='sabalan-private-prisma-capsule/v1', provenance='official-linux-pure-code-generation-with-identical-installed-linux-engine' if linux_generated else 'official-host-generated-platform-neutral-with-identical-installed-linux-engine',
        linuxGenerated=linux_generated, manualModelChanges=False, schemaSha256=source['schemaSha256'],
        migrationCount=len(source['migrations']), generated=generated, capsule=inventory(output, check),
        toolchain=dict(cli='5.22.0', localEngines={key: dict(path=str(file), sha256=digest(file)) for key, file in dict(
            PRISMA_QUERY_ENGINE_LIBRARY=engine, PRISMA_SCHEMA_ENGINE_BINARY=engine.parent / 'schema-engine-debian-openssl-3.0.x').items()}),
        sharedClientModified=False, productionAdmission=False)
    proof['linuxArtifact' if linux_generated else 'hostArtifact'] = artifact
    write(root / 'generated-prisma-proof.json', encoded(proof))
    return proof


def reuse_qualified(root, write, encoded, check):
    accepted = json.loads((root / 'qualified-prisma-capsule.json').read_bytes())
    receipt_raw = (root / 'qualified-prisma-receipt.json').read_bytes()
    check(hashlib.sha256(receipt_raw).hexdigest() == accepted['receiptSha256'], 'PRIVATE_PRISMA_QUALIFICATION_RECEIPT_CHANGED')
    receipt = json.loads(receipt_raw)
    source = json.loads((root / 'prisma-source-inventory.json').read_bytes())
    check(receipt['pass'] is True and receipt['identitiesUnchanged'] is True and receipt['sourcesUnchanged'] is True
          and receipt['result']['databaseRetiredWithoutForce'] is True and receipt['result']['migrationCount'] == len(source['migrations']),
          'PRIVATE_PRISMA_QUALIFICATION_NOT_ACCEPTED')
    source_root = Path(accepted['sourceRoot'])
    check(re.fullmatch(r'/app/online-runtime-acceptance/application-prisma-[a-f0-9]{32}', str(source_root))
          and str(source_root) == receipt['directory'] and source_root.resolve(strict=True) == source_root,
          'PRIVATE_PRISMA_QUALIFIED_ROOT_UNSAFE')
    proof_raw = (source_root / 'generated-prisma-proof.json').read_bytes()
    proof = json.loads(proof_raw)
    check(hashlib.sha256(proof_raw).hexdigest() == accepted['proofSha256'] and proof == receipt['result']['generated'],
          'PRIVATE_PRISMA_QUALIFIED_PROOF_CHANGED')
    native_raw = (source_root / 'initial-migration-coordination/deployment-runtime-native.json').read_bytes()
    native = json.loads(native_raw)
    check(hashlib.sha256(native_raw).hexdigest() == receipt['result']['nativeClosure']['nativeSha256']
          and native['phase'] == 'QUIESCENT' and native['nativeStatus'] == 0 and native['nativeReaped']
          and native['databaseQuiet'] and not native['stoppedBySignal'], 'PRIVATE_PRISMA_QUALIFIED_NATIVE_NOT_CLOSED')
    check(proof['schemaSha256'] == source['schemaSha256'] and proof['migrationCount'] == len(source['migrations']),
          'PRIVATE_PRISMA_QUALIFIED_SCHEMA_CHANGED')
    original = (root / 'prisma-schema-source.prisma').read_bytes()
    check(hashlib.sha256(original).hexdigest() == source['schemaSha256'], 'PRIVATE_PRISMA_SCHEMA_CHANGED')
    private = root / 'private-prisma'; private.mkdir(mode=0o700); write(private / 'schema.prisma', original)
    migrations = private / 'migrations'; migrations.mkdir(mode=0o700)
    write(migrations / 'migration_lock.toml', (root / 'prisma-migration-lock.toml').read_bytes())
    for selected in source['migrations']:
        check(re.fullmatch(r'\d{14}_[a-zA-Z0-9_]+', selected['name']), 'PRIVATE_PRISMA_MIGRATION_NAME')
        data = (root / selected['file']).read_bytes()
        check(len(data) == selected['bytes'] and hashlib.sha256(data).hexdigest() == selected['sha256'], 'PRIVATE_PRISMA_MIGRATION_CHANGED')
        target = migrations / selected['name']; target.mkdir(mode=0o700); write(target / 'migration.sql', data)
    selected_root = source_root / 'node_modules/@prisma/client'
    check(inventory(selected_root, check) == proof['capsule'], 'PRIVATE_PRISMA_QUALIFIED_CAPSULE_CHANGED')
    output = root / 'node_modules/@prisma/client'; output.mkdir(parents=True, mode=0o700)
    for parent, directories, files in os.walk(selected_root, followlinks=False):
        for name in directories:
            target = output / (Path(parent) / name).relative_to(selected_root); target.mkdir(mode=0o700)
        for name in files:
            file = Path(parent) / name
            fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW)
            try:
                before = os.fstat(fd)
                check(before.st_nlink == 1 and before.st_size <= 128 * 1024**2, 'PRIVATE_PRISMA_QUALIFIED_FILE_UNSAFE')
                data = bytearray()
                while len(data) < before.st_size:
                    chunk = os.read(fd, min(262144, before.st_size - len(data))); check(bool(chunk), 'PRIVATE_PRISMA_QUALIFIED_FILE_SHORT'); data.extend(chunk)
                identity = lambda value: (value.st_dev, value.st_ino, value.st_size, value.st_mtime_ns, value.st_ctime_ns)
                check(not os.read(fd, 1) and identity(os.fstat(fd)) == identity(before) and identity(file.lstat()) == identity(before), 'PRIVATE_PRISMA_QUALIFIED_FILE_CHANGED')
                write(output / file.relative_to(selected_root), data)
            finally:
                os.close(fd)
    check(inventory(output, check) == proof['capsule'] and inventory(selected_root, check) == proof['capsule'],
          'PRIVATE_PRISMA_QUALIFIED_COPY_CHANGED')
    check((source_root / 'generated-prisma-proof.json').read_bytes() == proof_raw
          and (source_root / 'initial-migration-coordination/deployment-runtime-native.json').read_bytes() == native_raw,
          'PRIVATE_PRISMA_QUALIFIED_PROOF_CHANGED')
    write(root / 'generated-prisma-proof.json', proof_raw)
    return proof


def migrate(root, database, environment, write, encoded, check):
    proof = json.loads((root / 'generated-prisma-proof.json').read_bytes())
    source = urlsplit(environment['DATABASE_URL'])
    check(re.fullmatch(r'qa_application_(native|prisma)_[a-f0-9]{32}', database)
          and source.hostname == 'postgres' and source.path == '/' + database, 'PRIVATE_PRISMA_DATABASE_UNSAFE')
    # The database is newly created and has no serving actors or public grant.
    # This original guardian retains the actual EX9 until native descendants AND
    # all tagged SQL have finished. It is not an online migration/adoption path.
    coordination = root / 'initial-migration-coordination'; coordination.mkdir(mode=0o700)
    write(coordination / 'deployment-runtime-control.lock', b'', 0o600)
    launcher = """import os,sys,fcntl
fd=os.open(sys.argv[1],os.O_RDWR|os.O_NOFOLLOW)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
retained=fcntl.fcntl(fd,fcntl.F_DUPFD_CLOEXEC,16)
os.dup2(retained,9,inheritable=True);os.close(retained)
if fd!=9:os.close(fd)
os.environ['BACKEND_CONTROL_LOCK_FD']='9';os.environ['BACKEND_CONTROL_LOCK_FILE']=sys.argv[1]
os.execvp('python3',['python3','-I','-B',sys.argv[2],'node',sys.argv[3]])
"""
    program = """const assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process');
const root=process.env.APPLICATION_PRISMA_ROOT;
const migration=spawnSync(process.execPath,['/app/node_modules/prisma/build/index.js','migrate','deploy','--schema',root+'/private-prisma/schema.prisma'],{stdio:'inherit',env:process.env});
if(migration.status!==0||migration.signal)throw Error('PRIVATE_PRISMA_NATIVE_MIGRATE_FAILED');
const generated=require(root+'/node_modules/@prisma/client'),db=new generated.PrismaClient();
(async()=>{try{const [identity]=await db.$queryRawUnsafe('SELECT current_database()::text AS name,current_setting(\\'application_name\\')::text AS namespace');
assert.match(identity.name,/^qa_application_(native|prisma)_[a-f0-9]{32}$/);assert.match(identity.namespace,/^sabalan-rt-[a-f0-9]{48}$/);
const counts={};for(const key of ['onlineRelease','onlineMigrationStep','onlineRuntimeSlot','deploymentOperation']){assert.equal(typeof db[key]?.findMany,'function');assert.deepEqual(await db[key].findMany({take:1}),[]);counts[key]=await db[key].count();}
await db.user.findMany({take:1});
console.log(JSON.stringify({event:'private-prisma-models-qualified',identity,counts,version:generated.Prisma.prismaVersion,models:generated.Prisma.dmmf.datamodel.models.length}));
}finally{await db.$disconnect()}})().catch(e=>{console.error(e.message);process.exitCode=1});
"""
    write(root / 'initial-migrate-and-probe.cjs', program.encode())
    env = {key: value for key, value in environment.items() if not key.startswith(('BACKEND_ONLINE_', 'BACKEND_NATIVE_', 'BACKEND_CONTROL_', 'BACKEND_CAPTURE_'))}
    env.update(RECOVERY_COORDINATION_DIR=str(coordination), BACKEND_RUNTIME_ROLE='control', CHECKPOINT_DISABLE='1',
               PRISMA_HIDE_UPDATE_MESSAGE='1', APPLICATION_PRISMA_ROOT=str(root),
               **{key: value['path'] for key, value in proof['toolchain']['localEngines'].items()})
    for item in proof['toolchain']['localEngines'].values():
        check(digest(Path(item['path'])) == item['sha256'], 'PRIVATE_PRISMA_INSTALLED_ENGINE_CHANGED')
    with (root / 'prisma-migrate.stdout').open('xb') as out, (root / 'prisma-migrate.stderr').open('xb') as err:
        child = subprocess.Popen(['python3', '-I', '-B', '-c', launcher, str(coordination / 'deployment-runtime-control.lock'),
            str(root / 'backend-runtime-owner.py'), str(root / 'initial-migrate-and-probe.cjs')], env=env, stdin=subprocess.DEVNULL, stdout=out, stderr=err)
    child.wait(timeout=240)
    native_raw = (coordination / 'deployment-runtime-native.json').read_bytes(); native = json.loads(native_raw)
    check(child.returncode == 0 and native['guardian']['pid'] == child.pid and native['phase'] == 'QUIESCENT'
          and native['nativeReaped'] and native['databaseQuiet'] and native['nativeStatus'] == 0 and not native['stoppedBySignal'], 'PRIVATE_PRISMA_MIGRATION_NOT_CLOSED')
    check(native['initialDatabase']['name'] == database, 'PRIVATE_PRISMA_MIGRATION_DATABASE_MISMATCH')
    write(root / 'initial-migration-closure.json', encoded(dict(nativeSha256=hashlib.sha256(native_raw).hexdigest(),
        nativeStatus=0, nativeReaped=True, databaseQuiet=True, guardian=native['guardian'],
        schemaSha256=proof['schemaSha256'], productionAdmission=False)))
    return proof

def hint_prepared_declarations(root, check):
    """Read-only DONTNEED after verified inventory; no cache credit/admission."""
    accepted = json.loads((root / 'qualified-prisma-capsule.json').read_bytes())
    receipt_raw = (root / 'qualified-prisma-receipt.json').read_bytes()
    check(hashlib.sha256(receipt_raw).hexdigest() == accepted['receiptSha256'], 'PRIVATE_DECLARATION_RECEIPT_CHANGED')
    receipt = json.loads(receipt_raw)
    source = Path(accepted['sourceRoot'])
    check(str(source) == receipt['directory'] and source.resolve() == source, 'PRIVATE_DECLARATION_SOURCE_CHANGED')
    initial = json.loads((root / 'initial-migration-coordination/deployment-runtime-native.json').read_bytes())
    check(initial['phase'] == 'QUIESCENT' and initial['nativeStatus'] == 0 and initial['nativeReaped']
          and initial['databaseQuiet'] and not initial['stoppedBySignal'], 'PRIVATE_DECLARATION_PREPARE_NOT_CLOSED')
    index = json.loads((root / 'index.json').read_bytes())
    shared = Path('/app/node_modules/@prisma/client')
    check(inventory(shared, check) == index['sharedClientInventory']
          and inventory(root/'node_modules/@prisma/client',check) == receipt['result']['generated']['capsule'],
          'PRIVATE_DECLARATION_SHARED_INVENTORY_CHANGED')
    generated = receipt['result']['generated']
    profiles = [name for name in ('linuxArtifact', 'hostArtifact') if name in generated]
    check(len(profiles) == 1, 'PRIVATE_DECLARATION_ARTIFACT_PROFILE_AMBIGUOUS')
    entries = generated[profiles[0]]['entries']
    expected = {row['target']: row['sha256'] for row in entries if row['target'].endswith('.d.ts')}
    roots = [(source / 'node_modules/@prisma/client', expected), (root / 'node_modules/@prisma/client', expected), (shared, None)]
    rows = []
    for directory, pins in roots:
        check(directory.resolve() == directory, 'PRIVATE_DECLARATION_ROOT_ALIAS')
        for parent, directories, names in os.walk(directory, followlinks=False):
            directories[:] = [name for name in directories if not (Path(parent) / name).is_symlink()]
            for name in names:
                if not name.endswith('.d.ts'): continue
                file = Path(parent) / name
                if file.is_symlink(): continue
                fd = os.open(file, os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC)
                try:
                    before = os.fstat(fd)
                    if before.st_nlink != 1: continue
                    check(stat.S_ISREG(before.st_mode) and before.st_uid == os.getuid() and before.st_size <= 128 * 1024**2,
                          'PRIVATE_DECLARATION_FILE_UNSAFE')
                    identity = lambda v: (v.st_dev, v.st_ino, v.st_size, v.st_mode, v.st_mtime_ns, v.st_ctime_ns)
                    # Declarations are unused by these runtime actors. Skip any
                    # currently mapped/held declaration in this namespace.
                    active = False
                    for process in Path('/proc').iterdir():
                        if not process.name.isdecimal() or int(process.name) == os.getpid(): continue
                        try:
                            for descriptor in (process / 'fd').iterdir():
                                try: observed = descriptor.stat()
                                except (FileNotFoundError, ProcessLookupError): continue
                                active |= (observed.st_dev, observed.st_ino) == (before.st_dev, before.st_ino)
                            for line in (process / 'maps').read_text().splitlines():
                                fields = line.split(maxsplit=5)
                                if len(fields) >= 5:
                                    major, minor = fields[3].split(':')
                                    active |= (os.makedev(int(major, 16), int(minor, 16)), int(fields[4])) == (before.st_dev, before.st_ino)
                        except (FileNotFoundError, ProcessLookupError): continue
                    if active: continue
                    digest = hashlib.sha256()
                    while chunk := os.read(fd, 65536): digest.update(chunk)
                    value = digest.hexdigest()
                    if pins is not None: check(pins.get(str(file.relative_to(directory))) == value, 'PRIVATE_DECLARATION_HASH_CHANGED')
                    os.posix_fadvise(fd, 0, 0, os.POSIX_FADV_DONTNEED)
                    check(identity(os.fstat(fd)) == identity(before) == identity(file.lstat()), 'PRIVATE_DECLARATION_METADATA_CHANGED')
                    rows.append(dict(file=str(file), sha256=value, bytes=before.st_size, metadataUnchanged=True))
                finally: os.close(fd)
    cgroup = Path('/sys/fs/cgroup')
    return dict(format='sabalan-prepared-declaration-cache-hint/v1', productionAdmission=False, cacheCreditUsed=False,
                bytesChanged=False, filesDeleted=False, files=rows, memoryCurrent=int((cgroup / 'memory.current').read_text()),
                memoryMaximum=int((cgroup / 'memory.max').read_text()), memoryEvents=(cgroup / 'memory.events').read_text())
