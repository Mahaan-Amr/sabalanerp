import fs from'node:fs';import path from'node:path';import assert from'node:assert/strict';import{createHash}from'node:crypto';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const operation='actual-inquiry-image-export-0b479d7911dfaea12ab2cd6860ed6b6b';const root=path.resolve(import.meta.dirname,'..');const negativeFile=path.join(root,'reports/qa',operation+'.json'),raw=fs.readFileSync(negativeFile),negative=JSON.parse(raw),remote=JSON.parse(negative.originalSsh.stdout);assert.equal(negative.passResult,false);assert.equal(negative.originalClosure.allOriginalChildrenClosed,true);assert.equal(remote.allOriginalChildrenClosed,true);assert.equal(remote.originalCommands.at(-1).returncode,0);assert.deepEqual(remote.originalCommands.at(-1).argv.slice(0,3),['docker','image','save']);
const source=String.raw`import os,stat,json,hashlib
root='/root/__OP__';file=root+'/inquiry.docker.tar';parent=os.lstat(root);assert stat.S_ISDIR(parent.st_mode)and parent.st_uid==0 and stat.S_IMODE(parent.st_mode)==0o700 and os.path.realpath(root)==root
assert os.listdir(root)==['inquiry.docker.tar']
fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK);before=os.fstat(fd);identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_nlink,s.st_uid)
assert stat.S_ISREG(before.st_mode)and before.st_nlink==1 and before.st_uid==0 and stat.S_IMODE(before.st_mode)==0o400 and 1024<before.st_size<4*1024**3
h=hashlib.sha256()
while True:
 block=os.read(fd,262144)
 if not block:break
 h.update(block)
assert identity(os.fstat(fd))==identity(before)==identity(os.lstat(file))
checked=0
for process in os.listdir('/proc'):
 if not process.isdigit()or int(process)==os.getpid():continue
 try:
  for entry in os.listdir('/proc/'+process+'/fd'):
   try:
    value=os.stat('/proc/'+process+'/fd/'+entry);assert(value.st_dev,value.st_ino)!=(before.st_dev,before.st_ino),'OTHER_PROCESS_FD_REFERENCE'
   except FileNotFoundError:pass
  with open('/proc/'+process+'/maps')as stream:assert file not in stream.read(),'OTHER_PROCESS_MAPPED_REFERENCE'
  checked+=1
 except (FileNotFoundError,ProcessLookupError):pass
assert identity(os.lstat(file))==identity(before)and identity(os.lstat(root))==identity(parent)
os.unlink(file);os.fsync(os.open(root,os.O_RDONLY|os.O_DIRECTORY));os.close(fd);os.rmdir(root)
print(json.dumps(dict(format='sabalan-original-failed-export-retirement/v1',path=file,bytes=before.st_size,sha256=h.hexdigest(),device=str(before.st_dev),inode=str(before.st_ino),processCensus=checked,exactOwnedTemporaryRetired=True,negativeReceiptPreserved=True,productionAdmission=False)))
`.replace('__OP__',operation);
const owner=originalBackendBaseCommands();const result=await owner.run('ssh',['-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','root@94.182.85.254','python3 -I -B -'],{input:source});const closure=await owner.close();const reportFile=path.join(root,'reports/qa',operation+'-temporary-retirement.json');fs.writeFileSync(reportFile,JSON.stringify({format:'sabalan-original-failed-export-retirement-ssh/v1',negativeFile,negativeSha256:createHash('sha256').update(raw).digest('hex'),sourceSha256:createHash('sha256').update(source).digest('hex'),result,closure},null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({reportFile,code:result.code,closed:closure.allOriginalChildrenClosed,stdout:result.stdout,stderr:result.stderr}));if(result.code!==0)process.exitCode=1;
