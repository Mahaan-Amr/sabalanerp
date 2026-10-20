"""Original backup-only Next owner. No seed, migration, bootstrap or public port."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import time
import urllib.request


def check(value, code):
    if not value: raise RuntimeError(code)


def emit(event, **value):
    print(json.dumps(dict(format='sabalan-original-independent-next/v1', event=event,
                          productionAdmission=False, **value)), flush=True)


def main():
    check(sys.platform == 'linux' and os.getuid() == 0 and not sys.flags.optimize, 'ORIGINAL_NEXT_LINUX_ROOT_REQUIRED')
    os.umask(0o077); check(len(sys.argv) == 4 and sys.argv[2] in ['frontend', 'inquiry'], 'ORIGINAL_NEXT_FIXED_MODE')
    root=Path(sys.argv[1]); mode=sys.argv[2]
    check(re.fullmatch(r'/app/online-runtime-acceptance/application-native-[a-f0-9]{32}',str(root)) and root.resolve(strict=True)==root,'ORIGINAL_NEXT_ROOT')
    raw=(root/'next-controller.json').read_bytes(); check(hashlib.sha256(raw).hexdigest()==sys.argv[3],'ORIGINAL_NEXT_CONFIG_CHANGED')
    config=json.loads(raw); role=config[mode]; env=dict(os.environ)
    for name in list(env):
        if name.startswith(('PG','BACKEND_','INQUIRY_NATIVE_')) or name in ['NODE_OPTIONS','NODE_PATH']: env.pop(name)
    env.update(NODE_ENV='production',NEXT_TELEMETRY_DISABLED='1',HTTP_PROXY='',HTTPS_PROXY='',ALL_PROXY='',http_proxy='',https_proxy='',all_proxy='')
    for name in ['SMS_IR_API_KEY','SMTP_HOST','SMTP_USER','SMTP_PASS','RESEND_API_KEY','SENDGRID_API_KEY']: env.pop(name,None)
    argv=['/usr/local/bin/node','/app/node_modules/next/dist/bin/next','start','--hostname','0.0.0.0','--port',str(role['port'])]
    grant=None
    if mode=='inquiry':
        grant=role['grant']; check(role['port']==3001,'INQUIRY_PORT')
        # Fixed image-owned dependency inventory is observed BEFORE any Next
        # process starts. The external controller's verifier is explicitly a
        # pinned read-only helper, not a fallback inside the installed image.
        runtime=Path('/app/online-runtime');actual={}
        for file in sorted(runtime.rglob('*')):
            check(not file.is_symlink(),'INQUIRY_RUNTIME_ALIAS')
            if file.is_file():
                check(file.stat().st_nlink==1,'INQUIRY_RUNTIME_HARDLINK')
                actual[file.relative_to(runtime).as_posix()]=hashlib.sha256(file.read_bytes()).hexdigest()
        check(actual==role['runtimeFiles'],'INQUIRY_RUNTIME_FILES_CHANGED')
        canonical=(json.dumps(actual,sort_keys=True,separators=(',',':'))+'\n').encode()
        check(hashlib.sha256(canonical).hexdigest()==role['runtimeBundleSha256'],'INQUIRY_RUNTIME_BUNDLE_CHANGED')
        env.update(DATABASE_URL='file:/data/inquiry.db?connection_limit=2&pool_timeout=10',BACKEND_RUNTIME_ROLE='serving',
                   BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'],
                   RECOVERY_COORDINATION_DIR=grant['scope']['coordinationDirectory'],INQUIRY_RUNTIME_GENERATION='1')
        # This fixed verifier performs one read-only SQLite snapshot; no db push,
        # administrator seed or startup migration is permitted.
        verifier=subprocess.Popen(['/usr/local/bin/node',str(root/'verify-inquiry-database.cjs')],env=dict(env,DATABASE_URL='file:/data/inquiry.db'),
                                  stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        output,error=verifier.communicate();check(verifier.returncode==0 and output.strip()==b'INQUIRY_DATABASE_VERIFIED' and not error,'INQUIRY_ACTUAL_SCHEMA_UNPROVEN')
        argv=['/usr/bin/python3','-I','-B',str(root/'online-inquiry-owner.py'),*argv]
    else:
        check(role['port']==3000,'FRONTEND_PORT');env.pop('DATABASE_URL',None)
    log=(root/(mode+'-next.stdout')).open('xb');errors=(root/(mode+'-next.stderr')).open('xb')
    child=subprocess.Popen(argv,cwd='/app',env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=errors)
    proc=Path('/proc')/str(child.pid);fields=(proc/'stat').read_text().rsplit(') ',1)[1].split()
    birth=dict(pid=child.pid,startTicks=fields[19],bootId=Path('/proc/sys/kernel/random/boot_id').read_text().strip(),pidNamespace=os.readlink(proc/'ns/pid'))
    initial_raw=None
    try:
        deadline=time.monotonic()+240
        while True:
            check(child.poll() is None and time.monotonic()<deadline,'ORIGINAL_NEXT_HEALTH_UNKNOWN')
            if grant and initial_raw is None:
                native_file=Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json'
                if native_file.exists():
                    candidate=native_file.read_bytes();native=json.loads(candidate)
                    check(native['phase']=='ACTIVE' and native['guardian']==birth,'ORIGINAL_INQUIRY_BIRTH_CHANGED');initial_raw=candidate
            try:
                with urllib.request.urlopen('http://127.0.0.1:'+str(role['port'])+role['healthPath'],timeout=2) as response:
                    body=response.read(8*1024**2+1);check(len(body)<=8*1024**2 and response.status==200,'ORIGINAL_NEXT_RESPONSE')
                    break
            except (OSError, __import__('http.client').client.HTTPException): time.sleep(0.1)
        check(not grant or initial_raw is not None,'ORIGINAL_INQUIRY_NATIVE_MISSING')
        emit('READY',role=mode,originalPopenPid=child.pid,birth=birth,status=200,responseSha256=hashlib.sha256(body).hexdigest(),
             image=role['image'],componentSourceCommit=role['sourceCommit'],
             activeNativeRawBase64=base64.b64encode(initial_raw).decode() if initial_raw else None)
        check(sys.stdin.buffer.readline(16)==b'STOP\n','ORIGINAL_NEXT_STOP_CHANNEL_LOST')
        request=None
        if grant:
            work=json.loads((Path(grant['scope']['boundaryDirectory'])/'state.json').read_bytes());check(work['phase']=='QUIESCENT','INQUIRY_WORK_NOT_QUIET')
            request=dict(format='sabalan-private-inquiry-requested-stop/v1',guardian=birth,activeClaimSha256=hashlib.sha256(initial_raw).hexdigest(),
                         signal='SIGTERM',expectedNativeStatus=143,naturalExitZeroExpected=False)
            with (root/'inquiry-original-requested-stop.json').open('x') as record:
                json.dump(request,record);record.flush();os.fsync(record.fileno())
        child.send_signal(signal.SIGTERM);child.wait()
        for stream in [log,errors]:stream.flush();os.fsync(stream.fileno());stream.close()
        evidence=dict(originalPopenPid=child.pid,birth=birth,originalReturncode=child.returncode,retiredByRequestedSigterm=True,naturalExitZero=False)
        if grant:
            final_raw=native_file.read_bytes();final=json.loads(final_raw)
            spec=importlib.util.spec_from_file_location('original_inquiry_requested_stop',root/'inquiry-requested-stop.py')
            module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
            evidence.update(module.qualify_requested_stop(request,json.loads(initial_raw),final,child.returncode))
            evidence.update(nativeRawBase64=base64.b64encode(final_raw).decode(),workRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'state.json').read_bytes()).decode())
            evidence.update(workClaimRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'claim.json').read_bytes()).decode(),
                            workScopeRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'scope.json').read_bytes()).decode())
        else:
            check(child.returncode==0,'ORIGINAL_FRONTEND_NOT_GRACEFULLY_CLOSED');evidence['naturalExitZero']=True
        emit('CLOSED',role=mode,closure=evidence)
    except BaseException:
        emit('HELD',role=mode,originalPopenPid=child.pid,originalClosed=child.poll() is not None)
        while True:time.sleep(30)


if __name__=='__main__':main()
