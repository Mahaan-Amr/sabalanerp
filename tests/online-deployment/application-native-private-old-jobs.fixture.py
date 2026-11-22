"""Original retained-image worker; never adopted or reconstructed from a receipt."""
import base64,hashlib,json,os,secrets,subprocess,time
from pathlib import Path

class OriginalPrivateOldJobs:
    def __init__(self,root,index,config,role_client,check,env,birth,resources):
        self.root,self.index,self.config,self.role,self.check=root,index,config,role_client,check
        self.grant=index['privateQualification']['oldJobsGrant'];self.closed=False;self.child=None
        self.env,self.birth_reader,self.resource_reader=env,birth,resources
    def start(self):
        root,index,config,role_client,check=self.root,self.index,self.config,self.role,self.check
        env,birth,resources=self.env,self.birth_reader,self.resource_reader
        self.before=resources();check(self.before['maximum']-self.before['current']>=384*1024**2,'PRIVATE_OLD_JOBS_CAPACITY_REFUSED')
        grant=self.grant;env=dict(env,BACKEND_RUNTIME_ROLE='control',BACKEND_ONLINE_SCOPE_FILE=grant['file'],BACKEND_ONLINE_SCOPE_SHA256=grant['sha256'])
        self.actor_id=secrets.token_hex(32);self.output=root/'private-qualification-old-jobs.stdout'
        self.requested_ns=time.monotonic_ns()
        with self.output.open('xb') as out,(root/'private-qualification-old-jobs.stderr').open('xb') as err:
            self.child=subprocess.Popen(['/usr/bin/python3','-I','-B',str(root/'online-runtime-owner.py'),'/usr/local/bin/node',str(root/'online-private-qualification-worker.cjs'),config['originalHostEnrollment']['publicKey'],config['originalHostEnrollment']['session'],self.actor_id],cwd=index['privateQualification']['qualificationRoot'],env=env,stdin=subprocess.PIPE,stdout=out,stderr=err)
        # Assigned before the first read/wait; caller retains this SAME object.
        self.birth=birth(self.child.pid);self.native_file=Path(grant['scope']['nativeDirectory'])/'deployment-runtime-native.json'
        deadline=time.monotonic()+120
        while True:
            check(self.child.poll() is None and time.monotonic()<deadline,'PRIVATE_OLD_JOBS_ACTIVE_UNPROVEN')
            if self.native_file.exists():
                raw=self.native_file.read_bytes();native=json.loads(raw)
                if native.get('phase')=='ACTIVE':break
            time.sleep(.02)
        self.active_ns=time.monotonic_ns();self.active_sha=hashlib.sha256(raw).hexdigest()
        check(native['guardian']==self.birth and native['onlineScope']['sha256']==grant['sha256'],'PRIVATE_OLD_JOBS_NATIVE_CHANGED')
        role_client.channel.emit('PRIVATE_OLD_JOBS_STARTED',dict(actorId=self.actor_id,scopeSha256=grant['sha256'],originalPopenPid=self.child.pid,birth=self.birth,activeNativeRawBase64=base64.b64encode(raw).decode()))
        ready=self.event('READY');identity=ready['identity']
        check(identity['purpose']=='jobs' and identity['runtimeId']==grant['scope']['runtimeId'] and identity['image']==config['roleTopology']['main']['image'] and ready['installedEntrySha256']==config['privateQualificationRuntimes']['main']['entrySha256'],'PRIVATE_OLD_JOBS_READY_CHANGED')
        role_client.channel.emit('PRIVATE_OLD_JOBS_READY',dict(actorId=self.actor_id,result=ready))
    def event(self,name):
        deadline=time.monotonic()+240
        while True:
            self.check(self.output.stat().st_size<=2*1024**2,'PRIVATE_OLD_JOBS_LOG_BOUND')
            records=[json.loads(line[len(b'SABALAN_PRIVATE_QUALIFICATION '):]) for line in self.output.read_bytes().splitlines() if line.startswith(b'SABALAN_PRIVATE_QUALIFICATION ')]
            found=[row for row in records if row['event']==name];self.check(len(found)<=1,'PRIVATE_OLD_JOBS_DUPLICATE_EVENT')
            if found:
                value=found[0];self.check(value['actorId']==self.actor_id and value['scopeSha256']==self.grant['sha256'],'PRIVATE_OLD_JOBS_EVENT_CHANGED');return value
            self.check(self.child.poll() is None and time.monotonic()<deadline,'PRIVATE_OLD_JOBS_EVENT_UNPROVEN_'+name);time.sleep(.02)
    def close(self,resources):
        for command,event,response in [('PREPARE_PRIVATE_OLD_JOBS','PREPARED','PRIVATE_OLD_JOBS_PREPARE_AUTHORIZED'),('FINISH_PRIVATE_OLD_JOBS','CLOSED','PRIVATE_OLD_JOBS_FINISH_AUTHORIZED')]:
            control=self.role.request(command,dict(actorId=self.actor_id),response)
            self.child.stdin.write(control['wire'].encode()+b'\n');self.child.stdin.flush();result=self.event(event)
            if event=='PREPARED':self.role.channel.emit('PRIVATE_OLD_JOBS_PREPARED',dict(actorId=self.actor_id,result=result))
        self.child.wait();closed_ns=time.monotonic_ns();self.check(self.child.returncode==0,'PRIVATE_OLD_JOBS_EXIT_FAILED')
        grant=self.grant;closure=dict(scopeSha256=grant['sha256'],originalPopenPid=self.child.pid,originalReturncode=self.child.returncode,nativeRawBase64=base64.b64encode(self.native_file.read_bytes()).decode(),workRawBase64=base64.b64encode((Path(grant['scope']['boundaryDirectory'])/'state.json').read_bytes()).decode())
        self.role.enrich_original_closure(closure,grant)
        closure['sql']=dict(visible=True,system=grant['scope']['database']['systemIdentifier'],oid=str(self.index['restoredOid']),sessions=0,prepared=0)
        closure['ownershipInterval']=dict(runtimeId=grant['scope']['runtimeId'],bootId=self.birth['bootId'],activeClaimSha256=self.active_sha,admissionRequestedMonotonicNs=str(self.requested_ns),exclusiveClaimObservedMonotonicNs=str(self.active_ns),controlClosedMonotonicNs=str(closed_ns))
        after=resources();self.check(all(after['events'][key]==self.before['events'][key] for key in ['oom','oom_kill','oom_group_kill']),'PRIVATE_OLD_JOBS_OOM_DELTA')
        self.closed=True;self.role.channel.emit('PRIVATE_OLD_JOBS_CLOSED',dict(actorId=self.actor_id,result=result,closure=closure));return closure
