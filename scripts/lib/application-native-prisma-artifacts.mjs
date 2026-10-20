import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

/** Frozen repository inputs only. Generation/migration execute in the existing
 * private native test environment, never in an installed shared client. */
export function collectApplicationPrismaArtifacts({repositoryRoot,captureSource}) {
  const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),read=name=>captureSource(name);
  read('scripts/lib/application-native-prisma-artifacts.mjs');
  const schema=read('backend/prisma/schema.prisma'),files={'prisma-schema-source.prisma':schema};
  const folder=path.join(repositoryRoot,'backend/prisma/migrations'),migrations=[];
  for(const entry of fs.readdirSync(folder,{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
    if(entry.name==='migration_lock.toml'){assert.ok(entry.isFile());files['prisma-migration-lock.toml']=read('backend/prisma/migrations/'+entry.name);continue;}
    assert.ok(entry.isDirectory()&&/^\d{14}_[a-zA-Z0-9_]+$/.test(entry.name),'UNSUPPORTED_MIGRATION_SOURCE');
    const source='backend/prisma/migrations/'+entry.name+'/migration.sql',bytes=read(source),file='prisma-migration-'+String(migrations.length).padStart(4,'0')+'.sql';
    assert.ok(bytes.length>0&&bytes.length<=4*1024*1024);files[file]=bytes;
    migrations.push({name:entry.name,file,sha256:sha(bytes),bytes:bytes.length});
  }
  assert.ok(files['prisma-migration-lock.toml']&&migrations.length>0&&migrations.length<=1000);
  files['prisma-source-inventory.json']=Buffer.from(JSON.stringify({format:'sabalan-private-prisma-source/v1',schemaSha256:sha(schema),migrations})+'\n');
  files['application-native-prisma.fixture.py']=read('tests/online-deployment/application-native-prisma.fixture.py');
  return files;
}
