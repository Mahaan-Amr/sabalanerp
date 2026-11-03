/** Native carrier preconditions, without installing dependencies or changing its image. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
const file=path.join(import.meta.dirname,'INQUIRY-PLATFORM.json');assert.ok(!fs.existsSync(file));
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const report={format:'sabalan-419-inquiry-platform-observation/v1',observedAt:new Date().toISOString(),readOnly:true,productionAdmission:false,runtimeAccepted:false};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');lease.assertHeld();report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();
 const probe=String.raw`const fs=require('fs'),crypto=require('crypto');
 const paths=['/usr/bin/python3','/usr/bin/python3.11','/usr/local/bin/python3','/app/online-runtime/entry.cjs','/app/online-runtime-verify.cjs','/app/.next/BUILD_ID','/app/.next/server/server-reference-manifest.json','/app/node_modules/next/dist/bin/next','/data/inquiry.db'];
 const files=Object.fromEntries(paths.map(p=>{if(!fs.existsSync(p))return[p,{exists:false}];const s=fs.lstatSync(p,{bigint:true});const row={exists:true,regular:s.isFile(),size:String(s.size),inode:String(s.ino),device:String(s.dev),mode:String(s.mode),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),nlink:String(s.nlink)};if(s.isFile()&&s.nlink===1n){row.sha256=crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');const after=fs.lstatSync(p,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs'])if(s[key]!==after[key])throw Error('FILE_CHANGED');}return[p,row];}));
 console.log(JSON.stringify({node:process.version,platform:process.platform,architecture:process.arch,osRelease:fs.readFileSync('/etc/os-release','utf8'),files,authorityMounted:fs.readFileSync('/proc/self/mountinfo','utf8').split('\n').some(line=>line.split(' ')[4]==='/run/sabalan-online')}));`;
 report.inquiry=JSON.parse(await guards.docker(['exec',report.before.inquiry.id,'node','-e',probe]));
 const [postgres]=JSON.parse(await guards.docker(['inspect',report.before.postgres.id]));
 const user=postgres.Config.Env.find(row=>row.startsWith('POSTGRES_USER=')).slice('POSTGRES_USER='.length);assert.match(user,/^[A-Za-z_][A-Za-z0-9_]*$/);
 await guards.status();const sql=await commands.run('docker',['exec',report.before.postgres.id,'psql','-X','-U',user,'-d','postgres','-Atqc',
  "SELECT json_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'prepared',(SELECT count(*) FROM pg_prepared_xacts),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()),'temporaryDatabases',(SELECT count(*) FROM pg_database WHERE datname LIKE 'qa_%'))"]);
 report.sqlOriginal={originalPid:sql.originalPid,code:sql.code,signal:sql.signal,naturalChildClosure:sql.naturalChildClosure,stdoutSha256:createHash('sha256').update(sql.stdout).digest('hex'),stderr:sql.stderr};
 if(sql.code===0){commands.assertSuccessful(sql);report.sql=JSON.parse(sql.stdout);}
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);
 report.preconditions={python:report.inquiry.files['/usr/bin/python3'].exists,runtimeEntry:report.inquiry.files['/app/online-runtime/entry.cjs'].exists,next:report.inquiry.files['/app/node_modules/next/dist/bin/next'].exists,authorityMounted:report.inquiry.authorityMounted};
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}report.completedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});}
console.log(JSON.stringify({file,preconditions:report.preconditions,error:report.error??null,sqlCode:report.sqlOriginal?.code}));
