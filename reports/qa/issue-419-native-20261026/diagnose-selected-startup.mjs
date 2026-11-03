/** Read-only artifact/startup compatibility diagnosis; never runtime admission. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const dir=import.meta.dirname,out=path.join(dir,'SELECTED-STARTUP-DIAGNOSIS.json');
assert.ok(!fs.existsSync(out));
const proposal=JSON.parse(fs.readFileSync(path.join(dir,'EXISTING-INQUIRY-CARRIER-PROPOSAL.json')));
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(sha(fs.readFileSync(proposal.archive.file)),proposal.archive.sha256);
const extract=String.raw`import tarfile,json,sys,io,hashlib
p=json.load(sys.stdin); wanted={'app/run-inquiry-with-recovery.sh','app/verify-inquiry-database.cjs','app/inquiry-baseline.json','app/inquiry-compiled-browser.cjs'}; found={}
with tarfile.open(p['archive']) as outer:
 def blob(d):
  raw=outer.extractfile('blobs/sha256/'+d.split(':')[1]).read();assert hashlib.sha256(raw).hexdigest()==d.split(':')[1];return raw
 index=json.loads(blob(p['index']));assert any(r['digest']==p['platform']for r in index['manifests'])
 manifest=json.loads(blob(p['platform']))
 for layer in reversed(manifest['layers']):
  if not wanted:break
  with tarfile.open(fileobj=io.BytesIO(blob(layer['digest'])),mode='r:*')as inner:
   for m in inner:
    name=m.name.removeprefix('./')
    if name in wanted:
     assert m.isfile();raw=inner.extractfile(m).read();found[name]={'sha256':hashlib.sha256(raw).hexdigest(),'source':raw.decode()};wanted.remove(name)
 assert not wanted
print(json.dumps(found))`;
const actual=JSON.parse(execFileSync('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',extract],{input:JSON.stringify({archive:proposal.archive.file,index:proposal.graph.index,platform:proposal.graph.platform}),encoding:'utf8',maxBuffer:1000000,stdio:['pipe','pipe','pipe']}));
assert.equal(actual['app/verify-inquiry-database.cjs'].source.replaceAll('\r\n','\n'),fs.readFileSync(path.resolve(dir,'../../../deploy/scripts/verify-inquiry-database.cjs'),'utf8').replaceAll('\r\n','\n'));
function docker(args,input){
 const rows=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'],{encoding:'utf8'}).trim().split(/\r?\n/).map(JSON.parse);
 assert.ok(rows.length===10&&rows.every(r=>r.Project==='sabalanerp-local'&&r.Health==='healthy'));
 return execFileSync('docker',args,{input,encoding:'utf8',maxBuffer:1000000,stdio:['pipe','pipe','pipe']});
}
const [inquiry,backend]=JSON.parse(docker(['inspect','sabalanerp-local-inquiry-1','sabalanerp-local-backend-retained-1']));
assert.equal(inquiry.ImageManifestDescriptor.digest,proposal.rollbackGraph.platform);
const data=inquiry.Mounts.find(r=>r.Destination==='/data'),mount=backend.Mounts.find(r=>r.Name===data.Name);assert.ok(mount&&!mount.RW);
const snapshot=String.raw`import sys,json,sqlite3,hashlib
from pathlib import Path
p=json.load(sys.stdin);f=Path(p['file']);a=f.stat();h=hashlib.sha256(f.read_bytes()).hexdigest();assert all(not Path(str(f)+s).exists()for s in ['-wal','-shm','-journal'])
d=sqlite3.connect(f.as_uri()+'?mode=ro&immutable=1',uri=True)
try:
 objects=[dict(zip(['type','name','table','sql'],r))for r in d.execute("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name")]
 integrity=d.execute('PRAGMA integrity_check').fetchall();assert integrity==[('ok',)]
 ledger=any(r['name']=='_sabalan_inquiry_migrations'for r in objects)
 result={'sqliteSha256':h,'device':str(a.st_dev),'inode':str(a.st_ino),'bytes':a.st_size,'mtimeNs':str(a.st_mtime_ns),'ctimeNs':str(a.st_ctime_ns),'integrity':'ok','objects':objects,'migrationLedgerPresent':ledger,'administrators':d.execute('SELECT count(*)FROM Admin').fetchone()[0]}
finally:d.close()
b=f.stat();assert(a.st_dev,a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_dev,b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns);assert hashlib.sha256(f.read_bytes()).hexdigest()==h
print(json.dumps(result))`;
const database=JSON.parse(docker(['exec','-i',backend.Id,'/usr/bin/python3','-I','-B','-c',snapshot],JSON.stringify({file:mount.Destination+'/inquiry.db'})));
const envKeys=inquiry.Config.Env.map(r=>r.slice(0,r.indexOf('=')));
const result={format:'sabalan-419-selected-startup-diagnosis/v1',observedAt:new Date().toISOString(),qualified:false,productionAdmission:false,readOnly:true,composeUp:false,archive:proposal.archive,graph:proposal.graph,artifactFiles:Object.fromEntries(Object.entries(actual).map(([k,v])=>[k,{sha256:v.sha256}])),startupSource:actual['app/run-inquiry-with-recovery.sh'].source,verifierSource:actual['app/verify-inquiry-database.cjs'].source,inquiryContainer:inquiry.Id,nativeDescriptor:inquiry.ImageManifestDescriptor,managedStartupEnvironmentKeys:envKeys.filter(k=>['BACKEND_ONLINE_SCOPE_FILE','BACKEND_ONLINE_SCOPE_SHA256','INQUIRY_NATIVE_AUTHORITY_FILE','INQUIRY_NATIVE_CLAIM_SHA256','INQUIRY_RUNTIME_GENERATION','BACKEND_RUNTIME_ROLE'].includes(k)),database,childrenClosed:true};
fs.writeFileSync(out,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({file:out,ledgerPresent:database.migrationLedgerPresent,sqliteSha256:database.sqliteSha256,managedStartupEnvironmentKeys:result.managedStartupEnvironmentKeys}));
