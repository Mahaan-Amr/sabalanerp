"""Finite read-only diagnosis; caller prepends the hash-pinned NativeHost kernel.
Only safe literal log fragments/timestamps and hashes leave the source host.
"""
import datetime, hashlib, json, re, subprocess, threading

def configuration_snapshot(values):
    encode=lambda value:json.dumps(value,sort_keys=True,separators=(',',':'))
    result={}
    for c in values:
        mounts=c['Mounts'];assert type(mounts)is list
        destinations=[m['Destination']for m in mounts];assert len(destinations)==len(set(destinations)),'DUPLICATE_MOUNT_DESTINATION'
        # Docker's realized mount enumeration is unordered. Preserve every field
        # and cardinality; no other array (including Env) is normalized here.
        config={key:c[key]for key in ['Config','HostConfig','NetworkSettings']};config['Mounts']=sorted(mounts,key=encode)
        result[c['Id']]=hashlib.sha256(encode(config).encode()).hexdigest()
    return result

def configuration_changed_fields(before,after):
    current={c['Id']:c for c in after};changes={}
    for c in before:
        now=current[c['Id']];fields=[]
        for key in ['Config','HostConfig','Mounts','NetworkSettings']:
            if isinstance(c[key],dict)and isinstance(now[key],dict):
                fields.extend(key+'.'+field for field in sorted(set(c[key])|set(now[key]))if (field in c[key])!=(field in now[key])or c[key].get(field)!=now[key].get(field))
            elif c[key]!=now[key]:fields.append(key)
        if fields:changes[c['Id']]=fields
    return changes

def require_runtime_conservation(before,after,configuration_before,configuration_after,protected_before,protected_after,configuration_fields=None):
    checks={'containerCensusUnchanged':before==after,'configurationUnchanged':configuration_before==configuration_after,'protectedFilesUnchanged':protected_before==protected_after}
    if not all(checks.values()):
        digest=lambda value:hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        print(json.dumps({'format':'sabalan-source-runtime-conservation-negative/v1','checks':checks,'beforeEight':before,'afterEight':after,'configurationBeforeSha256':configuration_before,'configurationAfterSha256':configuration_after,'configurationChangedFields':configuration_fields,'protectedBeforeSha256':digest(protected_before),'protectedAfterSha256':digest(protected_after),'diagnosticOnly':True,'productionAdmission':False,'runtimeAccepted':False}),flush=True)
        raise AssertionError('SOURCE_RUNTIME_CONSERVATION_FAILED')

def safe_log(raw):
    patterns=[('CONTROLLED_SHUTDOWN',r'Received (?:SIGTERM|SIGINT); draining connections before shutdown\.'),('BACKEND_STARTUP_BLOCKED',r'Backend startup blocked:'),('BACKEND_LISTENING',r'Server running on port'),('GRACEFUL_SHUTDOWN_FAILED',r'Graceful shutdown failed:'),('CLAMAV_HEALTH_FAILURE',r'ClamAV unhealthy: (?:latest update failed or is incomplete|successful update evidence is stale|no verified update cycle|invalid persisted updater state|invalid update interval|no successful FreshClam result evidence|FreshClam reports cooldown or error|scanner is unavailable|(?:clamd|updater) (?:PID is missing|PID is invalid|stopped|is missing or defunct)|(?:main|daily|bytecode) has no successful update evidence)'),('EICAR',r'Win\.Test\.EICAR(?:_HDB-1|_UNOFFICIAL)? FOUND'),('CLAMD_CONNECT_REFUSED',r'Connection refused'),('CLAMD_UNAVAILABLE',r'Could not connect to clamd'),('CLAMD_SOCKET_MISSING',r'No such file or directory'),('NO_VIRUS_DATABASE',r'No supported database files found'),('CLAMAV_DATABASE_OK',r'Database status OK\.'),('NODE_HEAP_OOM',r'(?:Reached heap limit|Ineffective mark-compacts near heap limit) Allocation failed - JavaScript heap out of memory'),('NPM_COMMAND_FAILED',r'npm (?:error|ERR!) command failed'),('NODE_ADDRESS_IN_USE',r'listen EADDRINUSE'),('PRISMA_INITIALIZATION',r'PrismaClientInitializationError'),('DB_CONNECTION_REFUSED',r'ECONNREFUSED'),('DB_AUTHENTICATION_FAILED',r'password authentication failed'),('NPM_EXIT',r'npm (?:error|ERR!) (?:code|signal) (?:SIGKILL|SIGTERM|ENOMEM|137|143|1)\b'),('KILLED',r'^Killed$'),('HEALTH_TIMEOUT',r'Health check exceeded timeout'),('COMMAND_NOT_FOUND',r'not found')]
    result=[];withheld=0
    for line in raw.decode('utf8',errors='replace').splitlines():
        stamp=re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s',line)
        matches=[{'classification':name,'safeExcerpt':m.group(0)}for name,p in patterns if(m:=re.search(p,line))]
        if matches:result.append({'timestamp':stamp[1]if stamp else None,'rawLineSha256':hashlib.sha256(line.encode()).hexdigest(),'matches':matches})
        else:withheld+=1
    return {'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'safeMatches':result,'unmatchedLinesWithheld':withheld,'rawTextExported':False}

def recovery_boundary_clear(value):
    assert value['state']['mode'] in ['NORMAL','READ_ONLY','MAINTENANCE'] and type(value['state']['operationPresent']) is bool
    assert set(value['markers'])=={'pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped'} and all(type(v)is bool for v in value['markers'].values())
    assert set(value['activeCounts'])=={'CREATING','VALIDATING','RESTORING'} and all(type(v)is int and v>=0 for v in value['activeCounts'].values())
    return value['state']['mode']=='NORMAL' and value['state']['operationPresent'] is False and not any(value['markers'].values()) and all(value['activeCounts'][key]==0 for key in ['CREATING','VALIDATING','RESTORING'])

# Standalone read-only client: no application/runtime import or initialization.
# No actor/user IDs, messages, paths, credentials or audit details are returned.
RECOVERY_METADATA_PROBE=r"""
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');const{PrismaClient}=require('@prisma/client');
const p=new PrismaClient(),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),pin=s=>Object.fromEntries(['dev','ino','mode','nlink','size','mtimeNs','ctimeNs'].map(k=>[k,String(s[k])])),root=path.resolve(process.env.RECOVERY_STORAGE_DIR||path.join(process.cwd(),'storage','recovery')),directory=path.resolve(process.env.RECOVERY_COORDINATION_DIR||path.join(root,'coordination'));
(async()=>{try{
 assert.equal(fs.realpathSync(directory),directory);const file=path.join(directory,'state.json'),before=fs.lstatSync(file,{bigint:true});assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=8192n);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);let raw;try{assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));raw=fs.readFileSync(fd);assert.deepEqual(pin(fs.fstatSync(fd,{bigint:true})),pin(before));}finally{fs.closeSync(fd);}assert.deepEqual(pin(fs.lstatSync(file,{bigint:true})),pin(before));const state=JSON.parse(raw);assert.ok(state&&['NORMAL','READ_ONLY','MAINTENANCE'].includes(state.mode)&&typeof state.updatedAt==='string'&&Number.isFinite(Date.parse(state.updatedAt))&&(state.operationId===undefined||typeof state.operationId==='string')&&(state.message===undefined||typeof state.message==='string'));const readMarkers=()=>{const values={};for(const name of ['pending-restore.json','deployment-maintenance.json','restart-inquiry','inquiry-stopped']){try{fs.lstatSync(path.join(directory,name));values[name]=true;}catch(e){assert.equal(e.code,'ENOENT');values[name]=false;}}return values;};const markers=readMarkers();
 const data=await p.$transaction(async tx=>{await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');const setting=await tx.$queryRawUnsafe("SELECT current_setting('transaction_read_only') AS mode");assert.equal(setting[0].mode,'on');const activeCounts={};for(const status of ['CREATING','VALIDATING','RESTORING'])activeCounts[status]=await tx.recoveryOperation.count({where:{status}});const last=await tx.recoveryOperation.aggregate({_max:{updatedAt:true,restoreStartedAt:true,completedAt:true}});const audits=await tx.recoveryAuditEvent.findMany({where:{eventType:{in:['RECOVERY_RESTORE_STARTED','RECOVERY_RESTORE_COMPLETED','RECOVERY_RESTORE_FAILED']},createdAt:{gte:new Date('2026-11-01T07:00:00Z')}},select:{eventType:true,createdAt:true},orderBy:{createdAt:'desc'},take:64});return{activeCounts,lastActivity:last._max,restoreAudit:audits,transactionReadOnly:true};},{isolationLevel:'RepeatableRead'});
 assert.deepEqual(readMarkers(),markers,'RECOVERY_MARKERS_CHANGED');assert.deepEqual(pin(fs.lstatSync(file,{bigint:true})),pin(before));console.log(JSON.stringify({directorySha256:sha(directory),state:{mode:state.mode,operationPresent:state.operationId!==undefined,updatedAt:state.updatedAt,identity:pin(before),sha256:sha(raw)},markers,...data,contentsReturned:false}));
}catch{process.stderr.write('READONLY_RECOVERY_METADATA_REFUSED\n');process.exitCode=1;}finally{await p.$disconnect();}})();
"""

def observe_runtime(h):
    h.acquire();host={key:hashlib.sha256(k['Path'](p).read_text().strip().lower().encode()).hexdigest()for key,p in [('machineUuidSha256','/sys/class/dmi/id/product_uuid'),('kernelBootIdSha256','/proc/sys/kernel/random/boot_id')]};assert host==SOURCE_HOST
    h.source_baseline_guard();before_eight=h.census();h.baseline=before_eight;h.no_lease();protected_before=h.protected()
    ids=h.run(['docker','ps','-aq','--no-trunc']).decode().split();assert len(ids)==8
    containers=json.loads(h.run(['docker','container','inspect',*ids]));selected={c['Config']['Labels']['com.docker.compose.service']:c for c in containers if c['Config'].get('Labels',{}).get('com.docker.compose.project')=='sabalanerp'and c['Config']['Labels'].get('com.docker.compose.service')in['backend','clamav']};assert set(selected)=={'backend','clamav'}
    configuration=configuration_snapshot
    configuration_before=configuration(containers);h.no_lease()
    begin='2026-10-26T06:04:29Z';end=datetime.datetime.now(datetime.timezone.utc).isoformat();rows={};originals=[]
    def read(args):
        h.lock_guard();child=subprocess.Popen(args,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,),env={'PATH':'/usr/sbin:/usr/bin:/sbin:/bin','HOME':'/root','LC_ALL':'C','TZ':'UTC','DOCKER_HOST':'unix:///var/run/docker.sock'});fault=None
        try:out,err=child.communicate()
        except BaseException as error:
            fault=type(error).__name__
            while True:
                try:out,err=child.communicate();break
                except BaseException:threading.Event().wait(1)
        row={'argv':args,'originalPid':child.pid,'code':child.returncode,'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest(),'stdoutBytes':len(out),'stderrBytes':len(err),'observationFault':fault};originals.append(row)
        assert child.returncode==0 and fault is None and row['stdoutEof']and row['stderrEof']and len(out)<=8*1024**2 and len(err)<=8*1024**2;h.lock_guard();return out,err
    metadata_before=json.loads(read(['docker','exec',selected['backend']['Id'],'node','--max-old-space-size=128','-e',RECOVERY_METADATA_PROBE])[0]);metadata_before['clear']=recovery_boundary_clear(metadata_before)
    for name,c in selected.items():
        state=c['State'];health=state.get('Health',{});checks=[{'start':v['Start'],'end':v['End'],'exitCode':v['ExitCode'],'output':safe_log(v['Output'].encode())}for v in health.get('Log',[])];success=[v['end']for v in checks if v['exitCode']==0]
        out,err=read(['docker','events','--since','2026-10-20T00:00:00Z','--until',end,'--filter','container='+c['Id'],'--format','{{json .}}']);assert not err
        events=[]
        for line in out.splitlines():
            event=json.loads(line);assert event['Actor']['ID']==c['Id'];action=event.get('Action',event.get('status'))
            if action in['start','stop','die','restart','oom','kill','health_status: healthy','health_status: unhealthy']:
                attrs=event['Actor'].get('Attributes',{});events.append({'time':event['time'],'timeNano':event.get('timeNano'),'action':action,**{key:attrs[key]for key in['exitCode','signal']if key in attrs and re.fullmatch(r'[0-9]{1,4}',attrs[key])}})
        out,err=read(['docker','logs','--since',begin,'--until',end,'--timestamps','--tail','3000',c['Id']])
        rows[name]={'containerId':c['Id'],'name':c['Name'],'image':c['Image'],'project':'sabalanerp','service':name,'startedAt':state['StartedAt'],'finishedAt':state['FinishedAt'],'exitCode':state['ExitCode'],'oomKilled':state['OOMKilled'],'restartCount':c['RestartCount'],'status':state['Status'],'healthStatus':health.get('Status'),'failingStreak':health.get('FailingStreak'),'retainedHealthchecks':checks,'healthcheckConfigurationSha256':hashlib.sha256(json.dumps(c['Config'].get('Healthcheck'),sort_keys=True).encode()).hexdigest(),'lastSuccessfulRetainedHealthcheck':max(success)if success else None,'events':events,'eventCoverage':{'since':'2026-10-20T00:00:00Z','until':end,'completeHistoryProven':False,'limitation':'DOCKER_DAEMON_RETAINS_ONLY_BOUNDED_RECENT_EVENTS'},'logs':{'since':begin,'until':end,'tailLimit':3000,'stdout':safe_log(out),'stderr':safe_log(err)}}
    started=datetime.datetime.fromisoformat(selected['backend']['State']['StartedAt'].replace('Z','+00:00'));window_begin=(started-datetime.timedelta(minutes=5)).isoformat();window_end=(started+datetime.timedelta(minutes=5)).isoformat();out,err=read(['docker','logs','--since',window_begin,'--until',window_end,'--timestamps','--tail','3000',selected['backend']['Id']]);rows['backend']['restartWindowLogs']={'since':window_begin,'until':window_end,'tailLimit':3000,'stdout':safe_log(out),'stderr':safe_log(err)}
    metadata_after=json.loads(read(['docker','exec',selected['backend']['Id'],'node','--max-old-space-size=128','-e',RECOVERY_METADATA_PROBE])[0]);metadata_after['clear']=recovery_boundary_clear(metadata_after)
    after_eight=h.census();protected_after=h.protected();h.source_baseline_guard();containers_after=json.loads(h.run(['docker','container','inspect',*ids]));configuration_after=configuration(containers_after);require_runtime_conservation(before_eight,after_eight,configuration_before,configuration_after,protected_before,protected_after,configuration_changed_fields(containers,containers_after))
    h.lock_guard();after=json.loads(h.run(['docker','container','inspect',*[c['Id']for c in selected.values()]]));assert all(c['State']['StartedAt']==selected[c['Config']['Labels']['com.docker.compose.service']]['State']['StartedAt']and c['RestartCount']==selected[c['Config']['Labels']['com.docker.compose.service']]['RestartCount']for c in after);h.no_lease()
    assert all(v['code']==0 and v['pipesClosed']and v['observationFault']is None for v in h.children)
    return {'format':'sabalan-source-runtime-diagnostics/v1','host':{'address':'94.182.85.254','sshPort':22,**host},'observedAt':end,'containers':rows,'beforeEight':before_eight,'afterEight':after_eight,'configurationBeforeSha256':configuration_before,'configurationAfterSha256':configuration_after,'rawConfigurationChangedFields':configuration_changed_fields(containers,containers_after),'configurationComparison':'ALL_FIELDS_ONLY_REALIZED_MOUNT_ENUMERATION_SORTED','protectedBeforeSha256':hashlib.sha256(json.dumps(protected_before,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'protectedAfterSha256':hashlib.sha256(json.dumps(protected_after,sort_keys=True,separators=(',',':')).encode()).hexdigest(),'recoveryBoundaryBefore':metadata_before,'recoveryBoundaryAfter':metadata_after,'separatedObservationsOnly':True,'originalChildren':originals,'kernelChildren':h.children,'allOriginalChildrenClosed':True,'diagnosticOnly':True,'readOnly':True,'productionAdmission':False,'runtimeAccepted':False}

if __name__=='__main__':
    k={'__name__':'fixed_readonly_runtime_kernel'};exec(compile(KERNEL,'reviewed-source-install-kernel','exec'),k);h=k['NativeHost']({'sourceHost':SOURCE_HOST},None)
    try:print(json.dumps(observe_runtime(h)),flush=True)
    finally:h.close()
