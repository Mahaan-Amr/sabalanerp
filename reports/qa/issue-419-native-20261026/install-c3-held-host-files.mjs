/** Install existing #413 file artifacts into the dedicated C3 checkout. No build or runtime. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {acquireSerialHostLease} from '../../../scripts/lib/serial-physical/host-lease.mjs';
import {originalBackendBaseCommands} from '../../../scripts/lib/production-backend-base-process.mjs';
const target='C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp';
const operation=randomBytes(16).toString('hex'),commands=originalBackendBaseCommands(),sha=b=>createHash('sha256').update(b).digest('hex');
const inventorySha='13332a91191919ef9b445aa0f9d01ef046b5cfb1e64707a04724bee9c3e287c9';
const inventoryRaw=fs.readFileSync(path.join(import.meta.dirname,'C3-INSTALLATION-INVENTORY-b297e08be1d542db982b0942859db831.json'));assert.equal(sha(inventoryRaw),inventorySha);const inventory=JSON.parse(inventoryRaw);
assert.equal(inventory.pass,true);assert.equal(inventory.differentOperations,0);assert.equal(inventory.operationsFileCount,5710);assert.equal(inventory.hostOutputCount,110);
const report={format:'sabalan-419-c3-held-host-files-install/v1',operation,inventorySha256:inventorySha,pass:false,runtimeStarted:false,masterStarted:false,imageBuilt:false,hostPackBuilt:false,productionAdmission:false};let lease;
const source=String.raw`import sys,json,pathlib,hashlib,tarfile,subprocess,shutil
target=pathlib.Path(sys.argv[1]); sha=lambda raw:hashlib.sha256(raw).hexdigest()
inv_raw=pathlib.Path(sys.argv[2]).read_bytes();assert sha(inv_raw)=='13332a91191919ef9b445aa0f9d01ef046b5cfb1e64707a04724bee9c3e287c9';inv=json.loads(inv_raw)
plan_raw=pathlib.Path('D:/sabalanerp-online-qa/ticket413-artifact-ready-d4948dcb6fd54d31bf2ce76513030432/install-plan-final.json').read_bytes()
assert sha(plan_raw)=='0b9cba26b9975abbc6893cb988d4571a3b49a8d1c6719215f61aad6c336ec238'; plan=json.loads(plan_raw)
assert inv['operationsArchive']==plan['operationsArchive'] and inv['missingOperations']==31
assert inv['source']['commit']==plan['sourceCommit']=='c3b7e4fcf88f5e2c3c54ae71dc5c593844d59b14'
assert inv['source']['tree']==plan['sourceTree']=='34db94fca59986498028ba463d340302eb484f75'
def git(*args):return subprocess.check_output(['git','-C',str(target),*args]).decode().strip()
def inquiry():
 root=target/'apps/sabalan-inquiry'
 assert subprocess.check_output(['git','-C',str(root),'rev-parse','HEAD']).decode().strip()=='63407dd94f17471b030b0aa59c80313c107c3a54'
 assert subprocess.check_output(['git','-C',str(root),'status','--porcelain']).decode().strip()==''
inquiry()
assert git('rev-parse','HEAD')==inv['source']['commit'] and git('rev-parse','HEAD^{tree}')==inv['source']['tree'] and git('status','--porcelain')==''
assert target.resolve()==target
archive=inv['operationsArchive']; assert sha(pathlib.Path(archive['file']).read_bytes())==archive['sha256']
pending=[]
with tarfile.open(archive['file'],'r:*') as tf:
 members={m.name:m for m in tf.getmembers() if m.isfile()}
 assert len(members)==len(inv['operationsFiles'])
 for row in inv['operationsFiles']:
  name=row['path']; relative=pathlib.PurePosixPath(name)
  assert not relative.is_absolute() and '..' not in relative.parts and '\\' not in name and ':' not in name
  member=members[name]; assert member.isfile() and not member.issym() and not member.islnk()
  raw=tf.extractfile(member).read(); assert sha(raw)==row['sha256'] and len(raw)==row['bytes']
  file=target.joinpath(*relative.parts); assert file.is_relative_to(target)
  parent=file.parent
  while parent!=target:
   assert not parent.is_symlink() and not parent.is_junction()
   if parent.exists():assert parent.resolve()==parent and parent.resolve().is_relative_to(target)
   parent=parent.parent
  if row['targetExists']:
   assert file.is_file() and not file.is_symlink() and sha(file.read_bytes())==row['sha256']
  else:
   assert not file.exists() and not file.is_symlink(); pending.append((file,raw,row))
 assert len(pending)==31
 required=sum(len(raw) for _,raw,_ in pending)
 assert shutil.disk_usage(target).free>=12*1024**3+512*1024**2+required
 installed=[]
 for file,raw,row in pending:
  file.parent.mkdir(parents=True,exist_ok=True)
  assert file.parent.resolve()==file.parent and file.parent.resolve().is_relative_to(target)
  with file.open('xb') as out:out.write(raw);out.flush();__import__('os').fsync(out.fileno())
  assert sha(file.read_bytes())==row['sha256'];installed.append({'path':row['path'],'sha256':row['sha256'],'bytes':len(raw)})
 for row in inv['operationsFiles']:
  assert sha(target.joinpath(*pathlib.PurePosixPath(row['path']).parts).read_bytes())==row['sha256']
 for row in inv['hostOutputs']:
  assert sha(target.joinpath(*pathlib.PurePosixPath(row['path']).parts).read_bytes())==row['sha256']
 assert git('status','--porcelain')==''
 inquiry()
 print(json.dumps({'installed':installed,'verifiedOperations':len(inv['operationsFiles']),'verifiedHostOutputs':len(inv['hostOutputs']),'sourceClean':True,'filesOnly':True}))
`;
try{
 lease=await acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock');report.lease={originalPid:lease.originalPid};
 await assert.rejects(acquireSerialHostLease('D:/sabalanerp-online-qa/deployment.lock'),/SERIAL_LEASE_BUSY_OR_UNAVAILABLE/);report.lease.contenderRefused=true;lease.assertHeld();
 const row=await commands.run('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',source,target,path.join(import.meta.dirname,'C3-INSTALLATION-INVENTORY-b297e08be1d542db982b0942859db831.json')],{maximum:1024**2});
 report.original={originalPid:row.originalPid,code:row.code,signal:row.signal,naturalChildClosure:row.naturalChildClosure,stdout:row.stdout,stderr:row.stderr};commands.assertSuccessful(row);
 report.installation=JSON.parse(row.stdout);lease.assertHeld();report.pass=true;
}catch(error){report.error=error.code??error.name;process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.lease.closed=true;}report.completedAt=new Date().toISOString();const file=path.join(import.meta.dirname,'C3-HELD-HOST-INSTALL-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,pass:report.pass}));}
