"""Tests only new test-owned files; never opens an operational lease."""
import ctypes as C
from ctypes import wintypes as W
import json
import hashlib
import os
from pathlib import Path
import subprocess
import shutil
import tempfile
import threading
import unittest
import uuid

SOURCE = Path(__file__).parents[2] / 'scripts/lib/serial-physical/host-lease.ps1'
K = C.WinDLL('kernel32', use_last_error=True) if os.name == 'nt' else None
class ID128(C.Structure):
    _fields_ = [('value', C.c_ubyte * 16)]
class INFO(C.Structure):
    _fields_ = [('volume', C.c_ulonglong), ('value', ID128)]

def file_identity(path):
    K.CreateFileW.argtypes = [W.LPCWSTR, W.DWORD, W.DWORD, C.c_void_p, W.DWORD, W.DWORD, W.HANDLE]
    K.CreateFileW.restype = W.HANDLE
    K.GetFileInformationByHandleEx.argtypes = [W.HANDLE, C.c_int, C.c_void_p, W.DWORD]
    K.GetFileInformationByHandleEx.restype = W.BOOL
    K.CloseHandle.argtypes = [W.HANDLE]
    K.CloseHandle.restype = W.BOOL
    handle = K.CreateFileW(str(path), 0, 7, None, 3, 0x200000, None)
    if handle == C.c_void_p(-1).value:
        raise OSError(C.get_last_error(), 'fixture metadata open failed')
    try:
        info = INFO()
        if not K.GetFileInformationByHandleEx(handle, 18, C.byref(info), C.sizeof(info)):
            raise OSError(C.get_last_error(), 'fixture identity unavailable')
        return str(info.volume) + ':' + bytes(info.value.value).hex()
    finally:
        if not K.CloseHandle(handle):
            raise OSError(C.get_last_error(), 'fixture handle closure unproven')

@unittest.skipUnless(os.name == 'nt', 'Windows fixture only')
class ExistingLeaseTests(unittest.TestCase):
    def setUp(self):
        self.root = Path(tempfile.gettempdir()) / ('sabalan-phase1-fixture-' + uuid.uuid4().hex)
        self.root.mkdir(mode=0o700)
        self.target = self.root / 'fixture.lock'

    def copy_manifest_sources(self):
        repo=Path(__file__).parents[2]
        names=['scripts/lib/reconciliation-phase1-core.mjs','scripts/lib/serial-physical/host-lease.mjs',
               'scripts/lib/serial-physical/host-lease.ps1','tests/phase1-existing-lease/phase1-fixture-adapter.mjs',
               'scripts/lib/reconciliation-readonly-phase1-cli.mjs','scripts/lib/reconciliation-phase1-census.ps1',
               'scripts/lib/reconciliation-phase1-lock-identity.ps1']
        entries=[]
        for name in names:
            src=repo/name;dst=self.root/name;dst.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(src,dst);entries.append({'path':name,'sha256':hashlib.sha256(dst.read_bytes()).hexdigest()})
        manifest=self.root/'fixture-manifest.json'
        manifest.write_text(json.dumps({'format':'phase1-fixture-manifest/v1','operation':'TEST_ONLY','action':'FIXTURE_AUDIT','allowedTargets':['fixture.lock','evidence.json'],'sources':entries}),encoding='utf-8')
        (self.root/'fixture-anchor.json').write_text(json.dumps({'format':'phase1-fixture-anchor/v1','fixtureOnly':True,'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest()}),encoding='utf-8')
        launcher=repo/'scripts/lib/reconciliation-phase1-launcher.mjs'
        intent={'fixtureOnly':True,'root':str(self.root),'manifestSha256':hashlib.sha256(manifest.read_bytes()).hexdigest(),
                'launcherSha256':hashlib.sha256(launcher.read_bytes()).hexdigest(),'sources':entries,
                'directoryDurability':'UNKNOWN','sourcePathRace':'UNPROVEN'}
        with (self.root/'fixture-intent.json').open('x',encoding='utf-8') as out:
            json.dump(intent,out,sort_keys=True);out.flush();os.fsync(out.fileno())

    def run_fixture_launcher(self,identity):
        launcher=Path(__file__).parents[2]/'scripts/lib/reconciliation-phase1-launcher.mjs'
        outputs={name:(self.root/('launcher.'+name)).open('xb') for name in ('stdout','stderr')}
        captured={'stdout':bytearray(),'stderr':bytearray()};eof={'stdout':False,'stderr':False};errors=[];threads=[]
        try:
            child=subprocess.Popen(['node',str(launcher),'--test-owned',str(self.root),identity],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
        except BaseException:
            for stream in outputs.values():stream.close()
            raise
        def drain(name,pipe):
            try:
                with outputs[name] as out:
                    while True:
                        raw=pipe.read(4096)
                        if not raw:out.flush();os.fsync(out.fileno());eof[name]=True;return
                        room=65536-len(captured[name]);out.write(raw[:max(0,room)]);captured[name].extend(raw[:max(0,room)])
                        if len(raw)>room:errors.append(name+':BOUND')
            except BaseException as error:errors.append(name+':'+type(error).__name__)
        try:
            for name in ('stdout','stderr'):
                t=threading.Thread(target=drain,args=(name,getattr(child,name)));t.start();threads.append(t)
            try:child.wait(timeout=30)
            except subprocess.TimeoutExpired:
                # Retain the original child and wait: no unverified kill or retry.
                child.wait();errors.append('TIMEOUT_UNKNOWN')
            for t in threads:t.join()
        except BaseException:
            # On reader setup failure, preserve the original child and wait;
            # pipe/descendant ambiguity may require manual test-only recovery.
            child.wait()
            for t in threads:t.join()
            raise
        finally:
            for stream in outputs.values():
                if not stream.closed:stream.close()
        stdout=bytes(captured['stdout']).decode('utf-8');stderr=bytes(captured['stderr']).decode('utf-8')
        receipt={'fixtureOnly':True,'pid':child.pid,'birth':'UNKNOWN','exitCode':child.returncode,
                 'stdoutEof':eof['stdout'],'stderrEof':eof['stderr'],'readerErrors':errors,
                 'stdoutCapturedSha256':hashlib.sha256(stdout.encode()).hexdigest(),'stderrCapturedSha256':hashlib.sha256(stderr.encode()).hexdigest(),
                 'stdoutComplete':eof['stdout'] and 'stdout:BOUND' not in errors,'stderrComplete':eof['stderr'] and 'stderr:BOUND' not in errors,
                 'source':'TEST_PARENT_REPORTED','directoryDurability':'UNKNOWN','outputBound':'65536_BYTES_PER_STREAM'}
        with (self.root/'launcher-receipt.json').open('x',encoding='utf-8') as out:json.dump(receipt,out,sort_keys=True);out.flush();os.fsync(out.fileno())
        if errors or not all(eof.values()):self.fail('FIXTURE_LAUNCHER_CLOSURE_UNKNOWN')
        return subprocess.CompletedProcess(child.args,child.returncode,stdout,stderr)

    def run_child(self, expected):
        env = os.environ.copy()
        env['SABALAN_SERIAL_LEASE_FILE'] = str(self.target)
        if expected is None:
            env.pop('SABALAN_AUDIT_EXPECTED_FILE_ID', None)
        else:
            env['SABALAN_AUDIT_EXPECTED_FILE_ID'] = expected
        child = subprocess.Popen([r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
                                  '-NoProfile', '-NonInteractive', '-File', str(SOURCE)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=env)
        try:
            stdout, stderr = child.communicate('RELEASE_AFTER_VERIFIED_RESTORATION\n', timeout=30)
        except subprocess.TimeoutExpired:
            # Keep custody and wait; never infer closure or kill by PID.
            child.wait()
            raise AssertionError('FIXTURE_TIMEOUT_UNKNOWN')
        return subprocess.CompletedProcess(child.args, child.returncode, stdout, stderr)

    def test_existing_matching_identity(self):
        self.target.write_bytes(b'fixture only')
        identity = file_identity(self.target)
        result = self.run_child(identity)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['LEASE_READY ' + identity, 'LEASE_CLOSED'])

    def test_missing_file_is_not_created(self):
        result = self.run_child('1:' + '0' * 32)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('LEASE_READY', result.stdout)
        self.assertFalse(self.target.exists())

    def test_legacy_mode_still_creates_fixture_file(self):
        result = self.run_child(None)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(result.stdout.splitlines(), ['LEASE_READY', 'LEASE_CLOSED'])
        self.assertTrue(self.target.exists())

    def test_wrong_identity_never_reports_ready(self):
        self.target.write_bytes(b'fixture only')
        result = self.run_child('1:' + '0' * 32)
        self.assertNotEqual(result.returncode, 0)
        self.assertNotIn('LEASE_READY', result.stdout)

    def test_matching_owner_excludes_second_open_until_release(self):
        self.target.write_bytes(b'fixture only')
        identity = file_identity(self.target)
        env = os.environ.copy()
        env['SABALAN_SERIAL_LEASE_FILE'] = str(self.target)
        env['SABALAN_AUDIT_EXPECTED_FILE_ID'] = identity
        child = subprocess.Popen([r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe',
                                  '-NoProfile', '-NonInteractive', '-File', str(SOURCE)],
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                 text=True, env=env)
        line = []
        reader = threading.Thread(target=lambda: line.append(child.stdout.readline()))
        reader.start()
        reader.join(30)
        if reader.is_alive():
            # Do not kill or abandon an ambiguously held test lease.
            reader.join()
            child.wait()
            self.fail('READY_TIMEOUT_UNKNOWN')
        try:
            self.assertEqual(line, ['LEASE_READY ' + identity + '\n'])
            other = self.run_child(identity)
            self.assertNotEqual(other.returncode, 0)
            self.assertIn('LEASE_BUSY', other.stdout)
        finally:
            try:
                stdout, stderr = child.communicate('RELEASE_AFTER_VERIFIED_RESTORATION\n', timeout=30)
            except subprocess.TimeoutExpired:
                child.wait()
                self.fail('CLOSURE_TIMEOUT_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.splitlines(), ['LEASE_CLOSED'])

    def test_js_failure_after_ready_closes_own_original_child(self):
        self.target.write_bytes(b'fixture only')
        identity = file_identity(self.target)
        module = (SOURCE.parent / 'host-lease.mjs').as_uri()
        script = f'''import fs from 'node:fs';
          import {{acquireSerialHostLease}} from {json.dumps(module)};
          const old=fs.lstatSync;
          fs.lstatSync=()=>{{ throw Error('test identity failure'); }};
          try {{ await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:process.env.FILEID}}); process.exitCode=2; }}
          catch(e) {{ if(e.message!=='SERIAL_LEASE_POST_READY_IDENTITY_UNPROVEN'||e.ownChildClosure!=='OBSERVED'||e.originalChild.exitCode!==0||!e.originalChild.stdout.readableEnded||!e.originalChild.stderr.readableEnded) process.exitCode=3; else console.log('OWN_CHILD_CLOSED'); }}
          finally {{ fs.lstatSync=old; }}'''
        env = os.environ.copy(); env['TARGET'] = str(self.target); env['FILEID'] = identity
        child = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        try:
            stdout, stderr = child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('JS_OWN_CHILD_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), 'OWN_CHILD_CLOSED')

    def test_js_opt_in_accepts_same_handle_path_and_releases(self):
        self.target.write_bytes(b'fixture only')
        identity = file_identity(self.target)
        module = (SOURCE.parent / 'host-lease.mjs').as_uri()
        script = f'''import {{acquireSerialHostLease}} from {json.dumps(module)};
          const lease=await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:process.env.FILEID}});
          lease.assertHeld();const c=await lease.release();
          if(c.pid!==lease.originalPid||c.birth100ns!=='UNKNOWN'||c.exitCode!==0||c.signal!==null||!c.stdoutEof||!c.stderrEof||c.closeMarker!=='LEASE_CLOSED'||c.evidenceType!=='ORIGINAL_PARENT_REPORTED'||!Number.isFinite(Date.parse(c.observedAt)))process.exitCode=2;
          else console.log('MATCH_CLOSED');'''
        env = os.environ.copy(); env['TARGET'] = str(self.target); env['FILEID'] = identity
        child = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        try:
            stdout, stderr = child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('JS_MISMATCH_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), 'MATCH_CLOSED')

    def test_js_legacy_acquires_and_releases(self):
        module = (SOURCE.parent / 'host-lease.mjs').as_uri()
        script = f'''import {{acquireSerialHostLease}} from {json.dumps(module)};
          const lease=await acquireSerialHostLease(process.env.TARGET);
          lease.assertHeld();await lease.release();console.log('LEGACY_CLOSED');'''
        env = os.environ.copy(); env['TARGET'] = str(self.target)
        child = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        try:
            stdout, stderr = child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('JS_LEGACY_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), 'LEGACY_CLOSED')

    def test_new_obligation_blocks_release_until_closed(self):
        self.target.write_bytes(b'fixture lock')
        identity=file_identity(self.target)
        module=(SOURCE.parent/'host-lease.mjs').as_uri()
        script=f'''import {{acquireSerialHostLease,retainOriginalSerialHostLease}} from {json.dumps(module)};
          const lease=await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:process.env.FILEID}});
          const hold=retainOriginalSerialHostLease(lease);let blocked=false;
          try{{await lease.release();}}catch(e){{blocked=e.message.includes('SERIAL_LEASE_HAS_LIVE_OBLIGATIONS');}}
          if(!blocked)process.exitCode=2;hold.close();await lease.release();if(blocked)console.log('GUARD_CLOSED');'''
        env=os.environ.copy();env.update(TARGET=str(self.target),FILEID=identity)
        child=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try:stdout,stderr=child.communicate(timeout=30)
        except subprocess.TimeoutExpired:child.wait();self.fail('OBLIGATION_FIXTURE_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'GUARD_CLOSED')

    def test_opt_in_stalled_child_timeout_retains_same_child_until_close(self):
        # A separate, test-owned helper performs no open or acquisition.
        module = self.root / 'host-lease.mjs'
        module.write_bytes((SOURCE.parent / 'host-lease.mjs').read_bytes())
        (self.root / 'host-lease.ps1').write_text('Start-Sleep -Seconds 12\n', encoding='ascii')
        script = f'''import {{acquireSerialHostLease}} from {json.dumps(module.as_uri())};
          try {{await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:'1:'+'0'.repeat(32)}});process.exitCode=2;}}
          catch(e) {{if(e.message!=='SERIAL_LEASE_READY_TIMEOUT'||e.ownChildClosure!=='UNKNOWN'||!e.originalChild||!e.originalCompletion){{process.exitCode=3;}}else{{await e.originalCompletion;if(e.originalChild.exitCode!==0||!e.originalChild.stdout.readableEnded||!e.originalChild.stderr.readableEnded)process.exitCode=4;else console.log('SAME_CHILD_CLOSED');}}}}'''
        env = os.environ.copy(); env['TARGET'] = str(self.target)
        child = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        try:
            stdout, stderr = child.communicate(timeout=35)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('STALLED_FIXTURE_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), 'SAME_CHILD_CLOSED')

    def test_opt_in_excess_output_fails_closed_and_waits_original(self):
        module = self.root / 'host-lease.mjs'
        module.write_bytes((SOURCE.parent / 'host-lease.mjs').read_bytes())
        (self.root / 'host-lease.ps1').write_text("[Console]::Out.Write('x' * 70000);Start-Sleep -Seconds 1\n", encoding='ascii')
        script = f'''import {{acquireSerialHostLease}} from {json.dumps(module.as_uri())};
          try {{await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:'1:'+'0'.repeat(32)}});process.exitCode=2;}}
          catch(e) {{if(e.message!=='SERIAL_LEASE_OUTPUT_BOUND_EXCEEDED'||e.ownChildClosure!=='UNKNOWN'||!e.originalChild||!e.originalCompletion)process.exitCode=3;else{{await e.originalCompletion;if(e.originalChild.exitCode!==0||!e.originalChild.stdout.readableEnded||!e.originalChild.stderr.readableEnded)process.exitCode=4;else console.log('OVERFLOW_CHILD_CLOSED');}}}}'''
        env = os.environ.copy(); env['TARGET'] = str(self.target)
        child = subprocess.Popen(['node', '--input-type=module', '-e', script], stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, env=env)
        try:
            stdout, stderr = child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('OUTPUT_FIXTURE_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode, 0, stderr)
        self.assertEqual(stdout.strip(), 'OVERFLOW_CHILD_CLOSED')

    def test_release_timeout_returns_unknown_and_retains_original_child(self):
        self.target.write_bytes(b'fixture lock')
        identity=file_identity(self.target)
        module=self.root/'host-lease.mjs';module.write_bytes((SOURCE.parent/'host-lease.mjs').read_bytes())
        (self.root/'host-lease.ps1').write_text("[Console]::Out.WriteLine('LEASE_READY '+$env:SABALAN_AUDIT_EXPECTED_FILE_ID);[Console]::Out.Flush();$null=[Console]::In.ReadLine();Start-Sleep -Seconds 12\n",encoding='ascii')
        script=f'''import {{acquireSerialHostLease}} from {json.dumps(module.as_uri())};
          const lease=await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:process.env.FILEID}});
          try{{await lease.release();process.exitCode=2;}}
          catch(e){{if(e.message!=='SERIAL_LEASE_RELEASE_CLOSURE_UNPROVEN'||e.ownChildClosure!=='UNKNOWN'||!e.originalChild||!e.originalCompletion)process.exitCode=3;
           else{{await e.originalCompletion;if(!e.originalChild.stdout.readableEnded||!e.originalChild.stderr.readableEnded)process.exitCode=4;else console.log('RELEASE_UNKNOWN_THEN_CHILD_CLOSED');}}}}'''
        env=os.environ.copy();env.update(TARGET=str(self.target),FILEID=identity)
        child=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try:stdout,stderr=child.communicate(timeout=35)
        except subprocess.TimeoutExpired:child.wait();self.fail('RELEASE_TIMEOUT_FIXTURE_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'RELEASE_UNKNOWN_THEN_CHILD_CLOSED')

    def test_test_owned_adapter_audits_and_releases_own_lease(self):
        self.target.write_bytes(b'fixture lock')
        (self.root / 'evidence.json').write_text('{"fixture":true}', encoding='utf-8')
        identity = file_identity(self.target)
        module = (Path(__file__).with_name('phase1-fixture-adapter.mjs')).as_uri()
        script = f'''import {{runTestOwnedAudit}} from {json.dumps(module)};
          const r=await runTestOwnedAudit(process.env.FIXTURE_ROOT,process.env.FILEID);
          if(r.oldObligation!=='RETAINED_UNRESOLVED'||r.safeState!=='UNKNOWN'||r.scopeReuse!==false)process.exitCode=2;
          else console.log('FIXTURE_AUDIT_RELEASED');'''
        env = os.environ.copy();env['FIXTURE_ROOT']=str(self.root);env['FILEID']=identity
        child = subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE,text=True,env=env)
        try:
            stdout, stderr=child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait()
            self.fail('TEST_ADAPTER_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'FIXTURE_AUDIT_RELEASED')
        record=json.loads((self.root/'audit.json').read_text())
        self.assertEqual(record['historicalEof'],'UNKNOWN')
        self.assertEqual(record['directoryDurability'],'UNKNOWN')
        self.assertEqual(record['stage'],'PRE_RELEASE')
        self.assertEqual(record['ownLeaseClosure'],'UNKNOWN_AT_RECORD')

    def test_test_owned_adapter_wrong_identity_never_writes_report(self):
        self.target.write_bytes(b'fixture lock')
        (self.root / 'evidence.json').write_text('{"fixture":true}', encoding='utf-8')
        module = Path(__file__).with_name('phase1-fixture-adapter.mjs').as_uri()
        script = f'''import {{runTestOwnedAudit}} from {json.dumps(module)};
          try {{await runTestOwnedAudit(process.env.FIXTURE_ROOT,'1:'+'0'.repeat(32));process.exitCode=2;}}
          catch(e) {{console.log('REJECTED');}}'''
        env=os.environ.copy();env['FIXTURE_ROOT']=str(self.root)
        child=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,
                               stderr=subprocess.PIPE,text=True,env=env)
        try: stdout,stderr=child.communicate(timeout=30)
        except subprocess.TimeoutExpired:
            child.wait();self.fail('TEST_ADAPTER_CLOSURE_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'REJECTED')
        self.assertFalse((self.root/'audit.json').exists())

    def test_report_failure_retains_original_test_lease_until_explicit_test_cleanup(self):
        self.target.write_bytes(b'fixture lock')
        (self.root/'evidence.json').write_text('{"fixture":true}',encoding='utf-8')
        (self.root/'audit.staging').write_text('preexisting fixture',encoding='utf-8')
        identity=file_identity(self.target)
        module=Path(__file__).with_name('phase1-fixture-adapter.mjs').as_uri()
        script=f'''import {{runTestOwnedAudit}} from {json.dumps(module)};
          import {{acquireSerialHostLease}} from {json.dumps((SOURCE.parent/'host-lease.mjs').as_uri())};
          try {{await runTestOwnedAudit(process.env.FIXTURE_ROOT,process.env.FILEID);process.exitCode=2;}}
          catch(e) {{if(e.message!=='PHASE1_OWN_LEASE_OR_AUDIT_UNRESOLVED'||e.custody!=='PROCESS_LOCAL_ONLY'||!e.lease){{process.exitCode=3;}}
           else {{e.lease.assertHeld();let rejected=false;try{{await acquireSerialHostLease(process.env.TARGET,{{expectedExistingFileId:process.env.FILEID}});}}catch{{rejected=true;}}
             if(!rejected)process.exitCode=4;await e.releaseFixtureLease();if(rejected)console.log('RETAINED_THEN_FIXTURE_CLEANUP');}}}}'''
        env=os.environ.copy();env.update(FIXTURE_ROOT=str(self.root),FILEID=identity,TARGET=str(self.target))
        child=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try: stdout,stderr=child.communicate(timeout=30)
        except subprocess.TimeoutExpired: child.wait();self.fail('TEST_ADAPTER_CUSTODY_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'RETAINED_THEN_FIXTURE_CLEANUP')
        self.assertFalse((self.root/'audit.json').exists())

    def test_post_acquisition_read_failure_retains_original_test_lease(self):
        self.target.write_bytes(b'fixture lock');(self.root/'evidence.json').write_text('{}',encoding='utf-8')
        identity=file_identity(self.target);module=Path(__file__).with_name('phase1-fixture-adapter.mjs').as_uri()
        script=f'''import fs from 'node:fs/promises';import {{runTestOwnedAudit}} from {json.dumps(module)};
          const original=fs.open;fs.open=async (...a)=>{{if(String(a[0]).endsWith('evidence.json'))throw Error('TEST_READ_FAILURE');return original(...a);}};
          try{{await runTestOwnedAudit(process.env.FIXTURE_ROOT,process.env.FILEID);process.exitCode=2;}}
          catch(e){{if(e.cause?.message!=='TEST_READ_FAILURE'||e.custody!=='PROCESS_LOCAL_ONLY'||!e.lease)process.exitCode=3;
           else{{e.lease.assertHeld();await e.releaseFixtureLease();console.log('READ_FAILURE_RETAINED');}}}}
          finally{{fs.open=original;}}'''
        env=os.environ.copy();env.update(FIXTURE_ROOT=str(self.root),FILEID=identity)
        child=subprocess.Popen(['node','--input-type=module','-e',script],stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
        try:stdout,stderr=child.communicate(timeout=30)
        except subprocess.TimeoutExpired:child.wait();self.fail('READ_FAILURE_FIXTURE_UNKNOWN')
        self.assertEqual(child.returncode,0,stderr)
        self.assertEqual(stdout.strip(),'READ_FAILURE_RETAINED')
        self.assertFalse((self.root/'audit.json').exists())

    def test_entrypoint_manifest_real_canonical_and_report(self):
        self.target.write_bytes(b'fixture lock');(self.root/'evidence.json').write_text('{}',encoding='utf-8')
        identity=file_identity(self.target);self.copy_manifest_sources()
        result=self.run_fixture_launcher(identity)
        self.assertEqual(result.returncode,0,result.stderr)
        output=json.loads(result.stdout)
        self.assertTrue(output['fixtureOnly']);self.assertEqual(output['historicalEof'],'UNKNOWN')
        self.assertEqual(json.loads((self.root/'audit.json').read_text())['stage'],'PRE_RELEASE')
        self.assertEqual(json.loads((self.root/'closed.json').read_text())['stage'],'OWN_LEASE_CLOSED')

    def test_entrypoint_actual_fixture_actor_conflict_has_no_acquisition(self):
        self.target.write_bytes(b'fixture lock');(self.root/'evidence.json').write_text('{}',encoding='utf-8')
        identity=file_identity(self.target);self.copy_manifest_sources()
        actor=subprocess.Popen(['node','-e','setTimeout(()=>{},12000)',str(self.root)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
        try:result=self.run_fixture_launcher(identity)
        finally:actor.wait()
        self.assertNotEqual(result.returncode,0)
        self.assertIn('PHASE1_ACTOR_CENSUS_NOT_CLEAR',result.stderr)
        self.assertFalse((self.root/'audit.json').exists());self.assertFalse((self.root/'closed.json').exists())

    def test_entrypoint_rejects_changed_test_source_before_acquisition(self):
        self.target.write_bytes(b'fixture lock');(self.root/'evidence.json').write_text('{}',encoding='utf-8')
        identity=file_identity(self.target);self.copy_manifest_sources()
        with (self.root/'scripts/lib/reconciliation-phase1-core.mjs').open('ab') as out:out.write(b'\n// changed fixture source\n')
        result=self.run_fixture_launcher(identity)
        self.assertNotEqual(result.returncode,0);self.assertIn('PHASE1_SOURCE_DIGEST_MISMATCH',result.stderr)
        self.assertFalse((self.root/'audit.json').exists());self.assertFalse((self.root/'closed.json').exists())

    def test_entrypoint_report_failure_retains_then_closes_test_lease(self):
        self.target.write_bytes(b'fixture lock');(self.root/'evidence.json').write_text('{}',encoding='utf-8')
        identity=file_identity(self.target);self.copy_manifest_sources();(self.root/'audit.staging').write_text('collision',encoding='utf-8')
        result=self.run_fixture_launcher(identity)
        self.assertNotEqual(result.returncode,0);self.assertIn('"cleanupStatus":"OWN_CLOSURE_REPORTED"',result.stderr)
        failure=json.loads((self.root/'failure.json').read_text());cleanup=json.loads((self.root/'cleanup.json').read_text())
        self.assertEqual(failure['phase'],'RECORD_PRE');self.assertEqual(failure['cause'],'EEXIST')
        self.assertTrue(cleanup['ownLease']['stdoutEof']);self.assertTrue(cleanup['ownLease']['stderrEof'])
        self.assertFalse((self.root/'audit.json').exists());self.assertFalse((self.root/'closed.json').exists())

if __name__ == '__main__':
    unittest.main()
