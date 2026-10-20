#!/usr/bin/env python3
"""Fixed pure C compilation. No packages, app processes or databases started."""
SPEC = None  # Replaced with exact source bytes by the original host preparer.
import base64, hashlib, json, os, selectors, shutil, signal, stat, struct, subprocess, sys, uuid
from pathlib import Path
assert not sys.flags.optimize and SPEC is not None
sha = lambda raw: hashlib.sha256(raw).hexdigest()
os.umask(0o077)
children=[];history=[];interrupted=False
def interrupted_signal(*_):
 global interrupted
 interrupted=True
for number in [signal.SIGTERM,signal.SIGINT,signal.SIGHUP]:signal.signal(number,interrupted_signal)
def run(argv):
 child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(child)
 buffers={child.stdout:bytearray(),child.stderr:bytearray()};selector=selectors.DefaultSelector();overflow=False
 for stream in buffers:selector.register(stream,selectors.EVENT_READ)
 while selector.get_map():
  for item,_ in selector.select(0.2):
   raw=os.read(item.fd,65536)
   if not raw:selector.unregister(item.fileobj);continue
   target=buffers[item.fileobj]
   if len(target)+len(raw)<=4*1024*1024:target.extend(raw)
   else:overflow=True
 code=child.wait();selector.close()
 stdout=bytes(buffers[child.stdout]);stderr=bytes(buffers[child.stderr])
 history.append(dict(argv=argv,originalPid=child.pid,returncode=code,stdoutSha256=sha(stdout),stderrSha256=sha(stderr),stdout=stdout.decode(errors='replace'),stderr=stderr.decode(errors='replace'),outputBoundExceeded=overflow))
 assert code==0 and not overflow and not interrupted
 return stdout
def foreign():
 # Read-only census before every subsequent Docker action. No daemon mutations.
 ids=run(['/usr/bin/docker','ps','-aq','--no-trunc']).decode().splitlines();assert len(ids)<=128
 if not ids:return []
 template='{"id":{{json .Id}},"image":{{json .Image}},"startedAt":{{json .State.StartedAt}},"running":{{json .State.Running}},"health":{{if (index .State "Health")}}{{json .State.Health.Status}}{{else}}null{{end}}}'
 return sorted([json.loads(row) for row in run(['/usr/bin/docker','inspect','--format',template,*ids]).decode().splitlines()],key=lambda row:row['id'])
operation=SPEC['operation'];assert len(operation)==32 and all(c in 'abcdef0123456789' for c in operation)
root=Path('/root/sabalan-recovery-private/native-owner-build-'+operation);root.mkdir(mode=0o700)
report=dict(format='sabalan-original-remote-native-owner-build/v1',operation=operation,root=str(root),passResult=False,productionAdmission=False,sourceSha256=SPEC['sourceSha256'])
try:
 before=foreign();report['foreignBefore']=before
 cc=shutil.which('cc') or shutil.which('gcc');assert cc and os.path.isabs(cc),'EXISTING_HOST_COMPILER_REQUIRED'
 compiler=Path(cc).resolve(strict=True);st=compiler.stat();assert stat.S_ISREG(st.st_mode)
 compiler_sha=sha(compiler.read_bytes());version=run([cc,'--version']).decode()
 source=base64.b64decode(SPEC['sourceBase64'],validate=True);assert sha(source)==SPEC['sourceSha256']
 source_file=root/'native-process-owner.c';fd=os.open(source_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
 try:os.write(fd,source);os.fsync(fd)
 finally:os.close(fd)
 executable=root/'native-process-owner';command=[cc,'-static','-std=c11','-O2','-Wall','-Wextra','-Werror','-Wl,-z,relro,-z,now',str(source_file),'-o',str(executable)]
 run(command);compiler_child=children[-1]
 elf=executable.read_bytes();assert elf[:7]==bytes([127,69,76,70,2,1,1]) and struct.unpack('<H',elf[18:20])[0]==62 and len(elf)<=8*1024*1024
 os.chmod(executable,0o500);fd=os.open(executable,os.O_RDONLY|os.O_NOFOLLOW);os.fsync(fd);os.close(fd)
 run([str(executable),'5','qualification-native-owner','/bin/true']);probe=history[-1]
 assert probe['stdout']=='' and probe['stderr']=='\nSABALAN_NATIVE_REAPED qualification-native-owner 0\n'
 assert sha(source_file.read_bytes())==SPEC['sourceSha256'] and sha(compiler.read_bytes())==compiler_sha
 after=foreign();assert after==before
 assert all(child.poll() is not None for child in children)
 report.update(passResult=True,compiler=dict(path=cc,realpath=str(compiler),sha256=compiler_sha,version=version),originalCompilePid=compiler_child.pid,command=command,probe=probe,elfSha256=sha(elf),elfBytes=len(elf),elfClass=64,machine='x86_64',allForeignIdentitiesUnchanged=True,allOriginalChildrenClosed=True,foreignAfter=after,originalCommands=history,elfBase64=base64.b64encode(elf).decode())
except BaseException as error:
 # Every observed child remains owned here until actual exit; no timeout/adoption.
 for child in children:child.wait()
 report.update(failure=type(error).__name__+': '+str(error),originalCommands=history,allOriginalChildrenClosed=all(child.poll() is not None for child in children))
finally:
 for child in children:child.wait()
 output=root/'receipt.json';raw=(json.dumps(report,sort_keys=True)+'\n').encode();fd=os.open(output,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o400)
 try:os.write(fd,raw);os.fsync(fd)
 finally:os.close(fd)
 print(json.dumps(report));sys.exit(0 if report['passResult'] else 1)
