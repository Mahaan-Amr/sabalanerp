"""Finite read-only diagnosis; caller prepends the hash-pinned NativeHost kernel.
Only safe literal log fragments/timestamps and hashes leave the source host.
"""
import datetime, hashlib, json, re, subprocess, threading

EXPECTED_CRON=[{'allocatedBytes': 4096, 'bytes': 302, 'ctimeNs': 1787121707013306000, 'device': 64769, 'gid': 990, 'inode': 8839, 'mode': 384, 'mtimeNs': 1787121707010306000, 'nlink': 1, 'path': '/var/spool/cron/crontabs/root', 'safeRootOwnedNonWritable': True, 'sha256': 'b5d21d4bfbec2c7ab6a3b4297cba329c6bf9e0d7989456d55d012698dd3c364c', 'uid': 0}, {'allocatedBytes': 4096, 'bytes': 571, 'ctimeNs': 1771797275420000000, 'device': 64769, 'gid': 0, 'inode': 398087, 'mode': 420, 'mtimeNs': 1771797275420000000, 'nlink': 1, 'path': '/opt/sabalanerp/deploy/scripts/renew-cert.sh', 'safeRootOwnedNonWritable': True, 'sha256': 'bf66ce1e517ff765c4756c0f14ab476dcd367f268eed7886b0c5f194e0585868', 'uid': 0}, {'allocatedBytes': 4096, 'bytes': 639, 'ctimeNs': 1792983611908000000, 'device': 64769, 'gid': 0, 'inode': 526106, 'mode': 420, 'mtimeNs': 1792983611907000000, 'nlink': 1, 'path': '/var/lib/docker/volumes/sabalanerp_certbot_conf/_data/renewal/sabalanerp.com.conf', 'safeRootOwnedNonWritable': True, 'sha256': '54814f9643c9922f03b309e2e81c06c52eed8e13012ed6bd78d0f982bb4c82a2', 'uid': 0}]
EXPECTED_CRON_SEMANTICS={'allWebrootMapPathsCanonical': True, 'authenticator': 'webroot', 'canonicalWebrootPath': True, 'cloudflareCredentialMatchesCandidate': False, 'cloudflareCredentialSettingPresent': False, 'secretOrDomainValuesReturned': False, 'webrootMapEntries': 2}

def safe_log(raw):
    patterns=[('CLAMAV_HEALTH_FAILURE',r'ClamAV unhealthy: (?:latest update failed or is incomplete|successful update evidence is stale|no verified update cycle|invalid persisted updater state|invalid update interval|no successful FreshClam result evidence|FreshClam reports cooldown or error|scanner is unavailable|(?:clamd|updater) (?:PID is missing|PID is invalid|stopped|is missing or defunct)|(?:main|daily|bytecode) has no successful update evidence)'),('EICAR',r'Win\.Test\.EICAR(?:_HDB-1|_UNOFFICIAL)? FOUND'),('CLAMD_CONNECT_REFUSED',r'Connection refused'),('CLAMD_UNAVAILABLE',r'Could not connect to clamd'),('CLAMD_SOCKET_MISSING',r'No such file or directory'),('NO_VIRUS_DATABASE',r'No supported database files found'),('CLAMAV_DATABASE_OK',r'Database status OK\.'),('NODE_HEAP_OOM',r'(?:Reached heap limit|Ineffective mark-compacts near heap limit) Allocation failed - JavaScript heap out of memory'),('NPM_COMMAND_FAILED',r'npm (?:error|ERR!) command failed'),('NODE_ADDRESS_IN_USE',r'listen EADDRINUSE'),('PRISMA_INITIALIZATION',r'PrismaClientInitializationError'),('DB_CONNECTION_REFUSED',r'ECONNREFUSED'),('DB_AUTHENTICATION_FAILED',r'password authentication failed'),('NPM_EXIT',r'npm (?:error|ERR!) (?:code|signal) (?:SIGKILL|SIGTERM|ENOMEM|137|143|1)\b'),('KILLED',r'^Killed$'),('HEALTH_TIMEOUT',r'Health check exceeded timeout'),('COMMAND_NOT_FOUND',r'not found')]
    result=[];withheld=0
    for line in raw.decode('utf8',errors='replace').splitlines():
        stamp=re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s',line)
        matches=[{'classification':name,'safeExcerpt':m.group(0)}for name,p in patterns if(m:=re.search(p,line))]
        if matches:result.append({'timestamp':stamp[1]if stamp else None,'rawLineSha256':hashlib.sha256(line.encode()).hexdigest(),'matches':matches})
        else:withheld+=1
    return {'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'safeMatches':result,'unmatchedLinesWithheld':withheld,'rawTextExported':False}

def observe_runtime(h):
    h.acquire();host={key:hashlib.sha256(k['Path'](p).read_text().strip().lower().encode()).hexdigest()for key,p in [('machineUuidSha256','/sys/class/dmi/id/product_uuid'),('kernelBootIdSha256','/proc/sys/kernel/random/boot_id')]};assert host==SOURCE_HOST
    ids=h.run(['docker','ps','-aq','--no-trunc']).decode().split();assert len(ids)==8
    containers=json.loads(h.run(['docker','container','inspect',*ids]));selected={c['Config']['Labels']['com.docker.compose.service']:c for c in containers if c['Config'].get('Labels',{}).get('com.docker.compose.project')=='sabalanerp'and c['Config']['Labels'].get('com.docker.compose.service')in['backend','clamav']};assert set(selected)=={'backend','clamav'}
    h.baseline=[{'id':c['Id'],'project':'sabalanerp','service':name}for name,c in selected.items()];h.no_lease()
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
    assert [r['path']for r in EXPECTED_CRON]==k['CRON_PATHS']
    first=[h.file_pin(row['path'])for row in EXPECTED_CRON];h.lock_guard()
    semantics=k['cron_renewal_semantics'](k['safe_read'](k['Path'](k['CRON_PATHS'][2]),first[2]['sha256']))
    second=[h.file_pin(row['path'])for row in EXPECTED_CRON];assert first==second
    cron={'expected':EXPECTED_CRON,'actual':first,'stable':True,'semanticsEqual':semantics==EXPECTED_CRON_SEMANTICS,'actualSemantics':semantics,'differences':[{'path':a['path'],'fields':[key for key in a if a[key]!=b[key]],'sameContent':a['sha256']==b['sha256']}for a,b in zip(EXPECTED_CRON,first)if a!=b],'readOnly':True,'admissionClaimed':False}
    h.lock_guard();after=json.loads(h.run(['docker','container','inspect',*[c['Id']for c in selected.values()]]));assert all(c['State']['StartedAt']==selected[c['Config']['Labels']['com.docker.compose.service']]['State']['StartedAt']and c['RestartCount']==selected[c['Config']['Labels']['com.docker.compose.service']]['RestartCount']for c in after);h.no_lease()
    assert all(v['code']==0 and v['pipesClosed']and v['observationFault']is None for v in h.children)
    return {'format':'sabalan-source-runtime-diagnostics/v1','host':{'address':'94.182.85.254','sshPort':22,**host},'observedAt':end,'containers':rows,'cronPinsObservation':cron,'originalChildren':originals,'kernelChildren':h.children,'allOriginalChildrenClosed':True,'diagnosticOnly':True,'readOnly':True,'productionAdmission':False,'runtimeAccepted':False}

if __name__=='__main__':
    k={'__name__':'fixed_readonly_runtime_kernel'};exec(compile(KERNEL,'reviewed-source-install-kernel','exec'),k);h=k['NativeHost']({'sourceHost':SOURCE_HOST},None)
    try:print(json.dumps(observe_runtime(h)),flush=True)
    finally:h.close()
