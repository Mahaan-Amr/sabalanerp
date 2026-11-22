"""Linux finite native fixtures only: no Docker start, SQL, deploy or systemd mutation."""
import ast
import hashlib
import importlib.util
import json
import os
import pathlib
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import types
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('original_service', ROOT/'deploy/scripts/online-owner-service.py')
service = importlib.util.module_from_spec(spec)
spec.loader.exec_module(service)

FIXTURE = r'''
import os,sys,json,hashlib,pathlib
config=pathlib.Path(sys.argv[1]);cfg=json.loads(config.read_bytes())
sys.stderr.buffer.write(b'FINITE_ORIGINAL_STDERR\n');sys.stderr.buffer.flush()
def send(value):print(json.dumps(value),flush=True)
def birth():
 s=pathlib.Path('/proc/self/stat').read_text();return s[s.rfind(')')+2:].split()[19]
send(dict(format='sabalan-original-predeploy-ready/v1',launcherPid=os.getpid(),launcherBirth=birth(),configurationSha256=hashlib.sha256(config.read_bytes()).hexdigest()))
lifecycle=int(os.environ['SABALAN_ORIGINAL_OWNER_READY_FD'])
def life(kind,**fields):os.write(lifecycle,(json.dumps(dict(format=kind,launcherPid=os.getpid(),launcherBirth=birth(),configurationSha256=hashlib.sha256(config.read_bytes()).hexdigest(),**fields))+'\n').encode())
begin=json.loads(sys.stdin.buffer.readline())
if begin['format']=='sabalan-original-abort-predeploy/v1':
 life('sabalan-original-predeploy-aborted/v1');os.close(lifecycle);sys.exit(0)
assert begin['format']=='sabalan-original-begin-deploy/v1'
pathlib.Path(cfg['operationDirectory']).mkdir(mode=0o700)
life('sabalan-original-operation-ready/v1',deployOriginalCode=0)
counter=0
for line in sys.stdin.buffer:
 value=json.loads(line)
 if value.get('fixtureExit') is True:
  life('sabalan-original-input-close-request/v1');break
 if value.get('binary') is True:
  sys.stdout.buffer.write(b'HEADER\n'+b'\0NO_LINE_FEED'*20000+b'END\n');sys.stdout.buffer.flush();continue
 counter+=1;send(dict(fixtureOnly=True,pid=os.getpid(),counter=counter))
'''


class NativeOwnerTests(unittest.TestCase):
    def setUp(self):
        self.assertEqual(sys.platform,'linux')
        self.assertEqual(os.getuid(),0)
        self.temp = tempfile.TemporaryDirectory(prefix='sabalan-owner-finite-')
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.handlers = {n:signal.getsignal(n) for n in (signal.SIGINT,signal.SIGTERM,signal.SIGHUP)}

    def tearDown(self):
        for n,handler in self.handlers.items():
            signal.signal(n,handler)

    def test_actual_launcher_blocks_before_any_deployment_child(self):
        launcher = self.root/'online-release-launcher.py'
        launcher.write_bytes((ROOT/'deploy/scripts/online-release-launcher.py').read_bytes())
        config = self.root/'config.json'
        config.write_text(json.dumps(dict(format='sabalan-online-original-launcher/v1')))
        config.chmod(0o600)
        life_read,life_write=os.pipe()
        child = subprocess.Popen([sys.executable,'-I','-B',str(launcher),str(config),'--owner-service'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(life_write,),
            env=dict(os.environ,SABALAN_ORIGINAL_OWNER_READY_FD=str(life_write)))
        os.close(life_write)
        try:
            ready = service.frame(child.stdout)
            self.assertEqual(ready['format'],'sabalan-original-predeploy-ready/v1')
            self.assertEqual(ready['launcherPid'],child.pid)
            self.assertIsNone(child.poll())
            children = pathlib.Path('/proc/%s/task/%s/children' % (child.pid,child.pid)).read_text().strip()
            self.assertEqual(children,'')
            out,err = child.communicate(service.encode(dict(format='UNBOUND_INVALID_BEGIN')))
            self.assertEqual(child.returncode,1)
            self.assertNotIn(b'BOOTSTRAP',out)
        finally:
            if child.poll() is None:
                child.communicate(service.encode(dict(format='UNBOUND_INVALID_BEGIN')))
            os.close(life_read)

    def owner(self):
        script = self.root/'fixture.py'
        script.write_text(FIXTURE)
        script.chmod(0o400)
        config = self.root/'config.json'
        config.write_text(json.dumps(dict(operationDirectory=str(self.root/'work'))))
        config.chmod(0o600)
        selected = dict(instanceId='1'*64,launcherPath=str(script),launcherSha256=service.sha(script.read_bytes()),
            configurationPath=str(config),configurationSha256=service.sha(config.read_bytes()))
        original_run = service.RUN
        service.RUN = self.root/'run'
        notify = socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM)
        notify.bind(str(self.root/'notify.sock'))
        prior_notify = os.environ.get('NOTIFY_SOCKET')
        os.environ['NOTIFY_SOCKET'] = str(self.root/'notify.sock')
        owner = service.Owner(selected,lambda:None)
        owner.start()
        self.assertIn(b'WAITING_FOR_BOUND_CLIENT',notify.recv(1024))
        notify.close()
        def cleanup():
            owner.quiescent_requested = True
            if owner.child.poll() is None:
                owner.child.stdin.write(service.encode(dict(fixtureExit=True)))
                owner.child.stdin.flush()
                owner.child.wait()
            owner.stdout_thread.join()
            owner.stderr_thread.join()
            owner.lifecycle_thread.join()
            owner.child.stdin.close()
            owner.child.stdout.close()
            owner.child.stderr.close()
            owner.server.close()
            os.close(owner.lock)
            service.RUN = original_run
            if prior_notify is None:os.environ.pop('NOTIFY_SOCKET',None)
            else:os.environ['NOTIFY_SOCKET']=prior_notify
        self.addCleanup(cleanup)
        return owner

    def test_actual_launcher_inert_abort_closes_without_any_deploy(self):
        config=self.root/'abort-config.json'
        config.write_text(json.dumps(dict(format='sabalan-online-original-launcher/v1')))
        config.chmod(0o600)
        read_fd,write_fd=os.pipe()
        child=subprocess.Popen([sys.executable,'-I','-B',str(ROOT/'deploy/scripts/online-release-launcher.py'),str(config),'--owner-service'],
            stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(write_fd,),
            env=dict(os.environ,SABALAN_ORIGINAL_OWNER_READY_FD=str(write_fd)))
        os.close(write_fd)
        try:
            ready=service.frame(child.stdout)
            self.assertEqual(pathlib.Path('/proc/%s/task/%s/children'%(child.pid,child.pid)).read_text().strip(),'')
            out,err=child.communicate(service.encode(dict(format='sabalan-original-abort-predeploy/v1',
                instanceId='1'*64,configurationSha256=ready['configurationSha256'])))
            self.assertEqual(child.returncode,0,(out,err))
            with os.fdopen(read_fd,'rb') as life:
                read_fd=None
                row=service.frame(life)
                self.assertEqual(row,dict(format='sabalan-original-predeploy-aborted/v1',launcherPid=child.pid,
                    launcherBirth=ready['launcherBirth'],configurationSha256=ready['configurationSha256']))
                self.assertEqual(life.read(),b'')
            self.assertEqual(out,b'')
        finally:
            if read_fd is not None:os.close(read_fd)

    def test_inert_service_abort_closes_same_original_and_execstop_observes_receipt(self):
        owner=self.owner()
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(service.RUN/'client.sock'))
        accepted,_=owner.server.accept();errors=[]
        def serve():
            try:owner.connection(accepted)
            except BaseException as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=serve);thread.start();stream=client.makefile('rb')
        client.sendall(service.encode(dict(type='ABORT_PREDEPLOY',instanceId=owner.selected['instanceId'])))
        row=service.frame(stream)
        self.assertEqual(row['type'],'INERT_ABORTED')
        self.assertEqual(stream.read(),b'')
        stream.close();client.close();thread.join()
        self.assertEqual(errors,[])
        self.assertEqual(owner.child.returncode,0)
        self.assertTrue(owner.inert_closed)
        self.assertFalse(owner.begun)
        self.assertFalse((self.root/'work').exists())
        self.assertTrue(all(getattr(owner.child,n).closed for n in ('stdin','stdout','stderr')))
        self.assertTrue(all(not t.is_alive() for t in (owner.stdout_thread,owner.stderr_thread,owner.lifecycle_thread)))
        receipt=json.loads((self.root/'owner-inert-aborted.json').read_bytes())
        self.assertFalse(receipt['deployEverStarted'])
        instance=self.root/'instance.json';instance.write_bytes(service.encode(owner.selected));instance.chmod(0o600)
        old_instance,old_argv=service.INSTANCE,sys.argv
        try:
            service.INSTANCE=instance;sys.argv=['service','--await-original-quiescence',str(instance)]
            service.main()  # Actual observation branch must return for this same inert closure.
        finally:
            service.INSTANCE=old_instance;sys.argv=old_argv

    def test_following_entry_cannot_start_an_inert_install(self):
        owner=self.owner()
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(service.RUN/'client.sock'))
        accepted,_=owner.server.accept()
        client.sendall(service.encode(dict(type='OPEN_CLIENT',instanceId=owner.selected['instanceId'],mode='FOLLOWING')))
        with self.assertRaises(RuntimeError):owner.connection(accepted)
        accepted.close();client.close()
        self.assertFalse(owner.begun)
        self.assertIsNone(owner.child.poll())
        owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
        owner.child.stdin.flush()

    def test_actual_client_main_rejects_null_reference_before_socket(self):
        prior_select,prior_client,prior_argv=service.pinned_selection,service.client,sys.argv
        calls=[]
        try:
            service.pinned_selection=lambda args:(dict(configurationPath=str(self.root/'config.json')),b'',b'')
            service.client=lambda *args:calls.append(args)
            sys.argv=['service','--client','launcher','sha','config','sha','null']
            with self.assertRaises(RuntimeError):service.main()
            self.assertEqual(calls,[])
        finally:
            service.pinned_selection,service.client,sys.argv=prior_select,prior_client,prior_argv

    def test_inert_abort_service_process_exits_zero_with_original_eof(self):
        script=self.root/'process-fixture.py';script.write_text(FIXTURE);script.chmod(0o400)
        config=self.root/'process-config.json';config.write_text(json.dumps(dict(operationDirectory=str(self.root/'work'))));config.chmod(0o600)
        selected=dict(instanceId='1'*64,launcherPath=str(script),launcherSha256=service.sha(script.read_bytes()),
            configurationPath=str(config),configurationSha256=service.sha(config.read_bytes()))
        harness=self.root/'original-service-fixture.py'
        harness.write_text("import importlib.util,pathlib,json\ns=importlib.util.spec_from_file_location('owner',"+
            repr(str(ROOT/'deploy/scripts/online-owner-service.py'))+")\nm=importlib.util.module_from_spec(s);s.loader.exec_module(m)\n"+
            "m.RUN=pathlib.Path("+repr(str(self.root/'process-run'))+")\n"+
            "m.Owner(json.loads("+repr(json.dumps(selected))+"),lambda:None).serve()\n")
        notify=socket.socket(socket.AF_UNIX,socket.SOCK_DGRAM);notify.bind(str(self.root/'process-notify'))
        child=subprocess.Popen([sys.executable,'-I','-B',str(harness)],stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,stderr=subprocess.PIPE,env=dict(os.environ,NOTIFY_SOCKET=str(self.root/'process-notify')))
        self.assertIn(b'WAITING_FOR_BOUND_CLIENT',notify.recv(1024));notify.close()
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(self.root/'process-run/client.sock'))
        client.sendall(service.encode(dict(type='ABORT_PREDEPLOY',instanceId=selected['instanceId'])))
        with client.makefile('rb') as stream:
            row=service.frame(stream)
            self.assertEqual(row['body']['servicePid'],child.pid)
            self.assertEqual(stream.read(),b'')
        client.close()
        out,err=child.communicate()
        self.assertEqual(child.returncode,0,(out,err))
        self.assertFalse((self.root/'work').exists())

    def test_abort_refuses_after_begin_attempt_without_closing_original(self):
        owner=self.owner()
        owner.begun=True
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(service.RUN/'client.sock'))
        accepted,_=owner.server.accept()
        client.sendall(service.encode(dict(type='ABORT_PREDEPLOY',instanceId=owner.selected['instanceId'])))
        with self.assertRaises(RuntimeError):owner.connection(accepted)
        accepted.close();client.close()
        self.assertFalse(owner.inert_aborting)
        self.assertIsNone(owner.child.poll())
        owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
        owner.child.stdin.flush()

    def session(self,owner):
        client = socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)
        client.connect(str(service.RUN/'client.sock'))
        accepted,_ = owner.server.accept()
        errors=[]
        def serve():
            try:owner.connection(accepted)
            except BaseException as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=serve)
        thread.start()
        stream=client.makefile('rb')
        client.sendall(service.encode(dict(type='OPEN_CLIENT',instanceId=owner.selected['instanceId'],mode='FOLLOWING' if owner.begun else 'INITIAL')))
        bound=service.frame(stream)['body']
        client.sendall(service.encode(dict(type='BIND_CLIENT',instanceId=bound['instanceId'],clientNonce=bound['clientNonce'])))
        return client,stream,bound,thread,errors

    def test_detach_and_new_client_keep_same_actual_original_process_and_pipes(self):
        owner=self.owner()
        pid=owner.child.pid
        before_birth=service.birth(pid)
        pipes=[os.fstat(s.fileno()).st_ino for s in (owner.child.stdin,owner.child.stdout,owner.child.stderr)]
        self.assertFalse((self.root/'work').exists())  # READY is inert until BIND.
        def terminal(command,fields,client_sequence=None):
            self.assertEqual(command,'READ_CLIENT_DETACH_BARRIER')
            mode=fields['input']['mode']
            return dict(clientDetachBarrier=dict(format='sabalan-original-client-terminal-barrier/v1',mode=mode,fixtureOnly=True),
                launcherCustody=dict(deployOriginalCode=0,pendingMasterReplies=0,checkpointProducerAbsent=True,
                    continuousOwnerAbsent=True,checkpointContextAbsent=True,launcherPid=pid,launcherBirth=service.birth(pid),
                    configurationSha256=owner.selected['configurationSha256']))
        owner.control=terminal
        nonces=[]
        for expected in (1,2):
            client,stream,bound,thread,errors=self.session(owner)
            nonces.append(bound['clientNonce'])
            client.sendall(service.encode(dict(type='PROTOCOL_FRAME',clientNonce=bound['clientNonce'],body=dict(query=True))))
            output=service.frame(stream)
            actual=json.loads(__import__('base64').b64decode(output['rawBase64']))
            self.assertEqual(actual['pid'],pid)
            self.assertEqual(actual['counter'],expected)
            if expected==1:
                client.sendall(service.encode(dict(type='PROTOCOL_FRAME',clientNonce=bound['clientNonce'],body=dict(binary=True))))
                payload=b'';expected_binary=b'HEADER\n'+b'\0NO_LINE_FEED'*20000+b'END\n'
                while len(payload)<len(expected_binary):
                    chunk=service.frame(stream)
                    self.assertEqual(chunk['type'],'OUTPUT')
                    payload+=__import__('base64').b64decode(chunk['rawBase64'])
                self.assertEqual(hashlib.sha256(payload).hexdigest(),hashlib.sha256(expected_binary).hexdigest())
            client.sendall(service.encode(dict(type='PREPARE_CLIENT_DETACH',clientNonce=bound['clientNonce'],mode='BOOTSTRAP')))
            detached=service.frame(stream)
            self.assertEqual(detached['type'],'DETACHED')
            self.assertEqual(detached['body']['launcherPid'],pid)
            stream.close();client.close();thread.join()
            self.assertEqual(errors,[])
            self.assertIsNone(owner.child.poll())
            self.assertEqual(service.birth(pid),before_birth)
            self.assertEqual([os.fstat(s.fileno()).st_ino for s in (owner.child.stdin,owner.child.stdout,owner.child.stderr)],pipes)
        self.assertNotEqual(nonces[0],nonces[1])

    def test_wrong_binding_holds_same_original_without_begin_or_replacement(self):
        owner=self.owner()
        client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(service.RUN/'client.sock'))
        accepted,_=owner.server.accept();errors=[]
        def serve():
            try:owner.connection(accepted)
            except BaseException as error:errors.append(type(error).__name__)
        thread=threading.Thread(target=serve);thread.start();stream=client.makefile('rb')
        client.sendall(service.encode(dict(type='OPEN_CLIENT',instanceId=owner.selected['instanceId'],mode='FOLLOWING' if owner.begun else 'INITIAL')))
        service.frame(stream)
        client.sendall(service.encode(dict(type='BIND_CLIENT',instanceId='2'*64,clientNonce='3'*64)))
        stream.close();client.close();thread.join()
        self.assertEqual(errors,['RuntimeError'])
        self.assertFalse(owner.begun)
        self.assertIsNone(owner.child.poll())
        self.assertIsNotNone(owner.held)
        # Fixture-only explicit end of the still-blocked predeploy gate.
        owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
        owner.child.stdin.flush()

    def test_readonly_inert_probe_does_not_bind_or_begin_original(self):
        owner=self.owner()
        observed=[]
        for _ in range(2):
            client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.connect(str(service.RUN/'client.sock'))
            accepted,_=owner.server.accept();errors=[]
            def serve():
                try:owner.connection(accepted)
                except BaseException as error:errors.append(type(error).__name__)
            thread=threading.Thread(target=serve);thread.start();stream=client.makefile('rb')
            client.sendall(service.encode(dict(type='PROBE_INSTANCE',instanceId=owner.selected['instanceId'])))
            row=service.frame(stream)
            self.assertEqual(row['type'],'PROBED')
            self.assertTrue(row['body']['deploymentInert'])
            observed.append(row['body'])
            stream.close();client.close();thread.join()
            self.assertEqual(errors,[])
            self.assertIsNone(owner.client)
            self.assertFalse(owner.begun)
            self.assertFalse((self.root/'work').exists())
            self.assertIsNone(owner.child.poll())
        self.assertEqual(observed[0],observed[1])
        owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
        owner.child.stdin.flush()

    def test_unit_never_uses_automatic_restart_or_group_kill(self):
        unit=(ROOT/'deploy/systemd/sabalan-online-owner.service').read_text()
        for exact in ('RefuseManualStop=yes','Restart=no','KillMode=mixed','SendSIGKILL=no','TimeoutStopSec=infinity'):
            self.assertIn(exact,unit.splitlines())
        self.assertNotIn('KillMode=none',unit)

    def test_real_original_stderr_short_writes_preserve_every_byte(self):
        original_write=os.write
        def short_write(fd,data):
            return original_write(fd,data[:max(1,len(data)//2)])
        service.os.write=short_write
        try:
            owner=self.owner()
            owner.quiescent_requested=True
            owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
            owner.child.stdin.write(service.encode(dict(fixtureExit=True)))
            owner.child.stdin.flush()
            self.assertEqual(owner.child.wait(),0)
            owner.stdout_thread.join();owner.stderr_thread.join();owner.lifecycle_thread.join()
            self.assertIsNone(owner.held)
            self.assertEqual((self.root/'owner-launcher.stderr').read_bytes(),b'FINITE_ORIGINAL_STDERR\n')
        finally:
            service.os.write=original_write

    def test_actual_native_observation_fault_is_closed_and_durable_before_refusal(self):
        previous=service.subprocess
        prior_audit=service.NATIVE_AUDIT_ROOT
        children=[]
        def launch(*args,**kwargs):
            child=subprocess.Popen(*args,**kwargs)
            children.append(child)
            original=child.communicate
            calls=[0]
            def communicate(*values,**options):
                calls[0]+=1
                if calls[0]==1:raise OSError('finite observer fault')
                return original(*values,**options)
            child.communicate=communicate
            return child
        service.subprocess=types.SimpleNamespace(Popen=launch,DEVNULL=subprocess.DEVNULL,PIPE=subprocess.PIPE)
        service.NATIVE_AUDIT_ROOT=self.root
        try:
            with self.assertRaises(RuntimeError):
                service.original_command([sys.executable,'-I','-B','-c','print("finite native child")'])
            self.assertEqual(len(children),1)
            self.assertEqual(children[0].returncode,0)
            self.assertTrue(children[0].stdout.closed and children[0].stderr.closed)
            files=list(self.root.glob('owner-native-child-*.json'))
            self.assertEqual(len(files),1)
            receipt=json.loads(files[0].read_bytes())
            self.assertEqual(receipt['pid'],children[0].pid)
            self.assertEqual(receipt['observationFault'],'OSError')
            self.assertTrue(receipt['pipesClosed'])
            self.assertIsNone(receipt['signal'])
        finally:
            service.subprocess=previous
            service.NATIVE_AUDIT_ROOT=prior_audit

    def test_actual_master_port_non_daemon_reader_exits_only_for_terminal_EOF(self):
        program = r'''
import ast,pathlib,sys,threading,queue,os,json
t=ast.parse(pathlib.Path(sys.argv[1]).read_bytes())
chosen=[n for n in t.body if isinstance(n,(ast.FunctionDef,ast.ClassDef))and n.name in ['OriginalInputEOF','OriginalMasterPort','require','frame']]
frame_buffers={}
exec(compile(ast.Module(body=chosen,type_ignores=[]),'actual-launcher-port','exec'),globals())
port=OriginalMasterPort()
with port.lock:port.terminalClosing=sys.argv[2]=='terminal'
print('ORIGINAL_READER_READY',flush=True)
port.thread.join()
print(json.dumps(dict(closed=port.closed,error=type(port.error).__name__ if port.error else None)),flush=True)
'''
        source=ROOT/'deploy/scripts/online-release-launcher.py'
        for mode in ('terminal','unexpected'):
            child=subprocess.Popen([sys.executable,'-I','-B','-c',program,str(source),mode],
                stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
            self.assertEqual(child.stdout.readline(),b'ORIGINAL_READER_READY\n')
            out,err=child.communicate()
            self.assertEqual(child.returncode,0)
            result=json.loads(out)
            self.assertEqual(result['closed'],mode=='terminal')
            self.assertEqual(result['error'],None if mode=='terminal' else 'OriginalInputEOF')

    def test_real_term_to_original_bridge_does_not_signal_or_abandon_its_child(self):
        owner=self.owner()
        pid=owner.child.pid
        before=service.birth(pid)
        os.kill(os.getpid(),signal.SIGTERM)
        self.assertEqual(owner.signals,[signal.SIGTERM])
        self.assertIsNone(owner.child.poll())
        self.assertEqual(service.birth(pid),before)
        with self.assertRaises(RuntimeError):owner.guard()
        # Explicit finite fixture cleanup, not a service recovery or actor adoption.
        owner.child.stdin.write(service.encode(dict(format='sabalan-original-begin-deploy/v1')))
        owner.child.stdin.flush()


if __name__=='__main__':unittest.main(verbosity=2)
