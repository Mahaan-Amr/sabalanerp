/** Read-only native prerequisite observations under the canonical serial lease. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
import {backendBaseLocalGuards} from '../../../scripts/lib/production-backend-base-local-guard.mjs';
import {sanitizeProductionImageInspection} from '../../../deploy/scripts/production-image-execution-binding.mjs';
const file=path.join(import.meta.dirname,'NATIVE-READINESS.json');assert.ok(!fs.existsSync(file));
const commands=originalBackendBaseCommands(),guards=backendBaseLocalGuards(commands);
const sha=raw=>createHash('sha256').update(raw).digest('hex');
const report={format:'sabalan-419-native-readiness/v1',observedAt:new Date().toISOString(),readOnly:true,productionAdmission:false,runtimeAccepted:false,observations:{}};
let lease;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');lease.assertHeld();
 report.lease={originalPid:lease.originalPid};
 report.before=await guards.protectedIdentities();
 const probe=String.raw`import os,json,hashlib,stat
from pathlib import Path
def stamp(p):
 if not os.path.lexists(p):return {'exists':False}
 p=Path(p);s=p.lstat();v={'exists':True,'regular':stat.S_ISREG(s.st_mode),'mode':s.st_mode,'uid':s.st_uid,'gid':s.st_gid,'size':s.st_size,'inode':str(s.st_ino),'device':str(s.st_dev),'mtimeNs':str(s.st_mtime_ns),'ctimeNs':str(s.st_ctime_ns),'nlink':s.st_nlink}
 if v['regular'] and s.st_nlink==1:
  fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
  try:
   a=os.fstat(fd);h=hashlib.sha256()
   while b:=os.read(fd,1048576):h.update(b)
   z=os.fstat(fd);n=p.lstat();assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(z.st_dev,z.st_ino,z.st_size,z.st_mtime_ns,z.st_ctime_ns)==(n.st_dev,n.st_ino,n.st_size,n.st_mtime_ns,n.st_ctime_ns);v['sha256']=h.hexdigest()
  finally:os.close(fd)
 return v
files=['/app/online-runtime/entry.cjs','/app/online-runtime-verify.cjs','/app/online-runtime-scope.py','/app/.next/BUILD_ID','/app/.next/server/server-reference-manifest.json','/app/node_modules/next/dist/bin/next','/usr/bin/python3','/usr/bin/python3.11','/data/inquiry.db']
value={'files':{p:stamp(p)for p in files},'python':__import__('sys').version.split()[0],'processes':[],'scopes':[]}
for p in Path('/proc').iterdir():
 if not p.name.isdigit() or int(p.name)==os.getpid():continue
 try:
  argv=(p/'cmdline').read_bytes().split(b'\0');names={Path(a.decode(errors='strict')).name for a in argv if a}
  selected=sorted(names&{'online-runtime-owner.py','online-inquiry-owner.py','application-native-candidate-controller.py','run-full-catalog-controller.py','chromium','chrome','chrome_crashpad_handler','fixture.py'})
  if selected:value['processes'].append({'pid':int(p.name),'names':selected})
 except FileNotFoundError:pass
for root in ['/run/sabalan-online','/app/runtime-authority','/app/jobs-authority']:
 p=Path(root);value['scopes'].append({'path':root,'exists':p.exists(),'directory':p.is_dir()})
print(json.dumps(value))`;
 for(const service of ['backend-candidate','backend-retained','inquiry']){
  lease.assertHeld();await guards.status();
  const result=await commands.run('docker',['exec',report.before[service].id,'/usr/bin/python3','-I','-B','-c',probe]);
  report.observations[service]={originalPid:result.originalPid,code:result.code,signal:result.signal,stdoutSha256:sha(result.stdout),stderrSha256:sha(result.stderr),naturalChildClosure:result.naturalChildClosure};
  if(result.code===0){commands.assertSuccessful(result);report.observations[service].result=JSON.parse(result.stdout);}
  else report.observations[service].failure=result.stderr.slice(0,1000)||result.stdout.slice(0,1000);
 }
 report.images={};
 for(const service of ['backend-candidate','backend-retained','inquiry']){
  const [image]=JSON.parse(await guards.docker(['image','inspect',report.before[service].image]));
  report.images[service]=sanitizeProductionImageInspection(image);
 }
 report.sql=JSON.parse(await guards.docker(['exec',report.before.postgres.id,'psql','-X','-U','postgres','-d','postgres','-Atqc',
  "SELECT json_build_object('systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'prepared',(SELECT count(*) FROM pg_prepared_xacts),'sessions',(SELECT count(*) FROM pg_stat_activity WHERE pid<>pg_backend_pid()),'temporaryDatabases',(SELECT count(*) FROM pg_database WHERE datname LIKE 'qa_%'))"]));
 report.after=await guards.protectedIdentities();assert.deepEqual(report.after,report.before);
}catch(error){report.error={name:error.name,message:String(error.message).slice(0,1000)};process.exitCode=1;}
finally{
 report.originalChildren=await commands.close();
 if(lease){await lease.release();report.lease.closed=true;report.lease.acknowledgement='LEASE_CLOSED';}
 report.completedAt=new Date().toISOString();fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
}
console.log(JSON.stringify({file,error:report.error??null,observations:Object.fromEntries(Object.entries(report.observations).map(([k,v])=>[k,{code:v.code,failure:v.failure??null}]))}));
