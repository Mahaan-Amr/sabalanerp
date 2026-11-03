"""Finite read-only diagnosis; caller prepends the hash-pinned NativeHost kernel.
Only safe literal log fragments/timestamps and hashes leave the source host.
"""
import datetime, hashlib, json, re, subprocess, threading

def safe_log(raw):
    patterns=[('CLAMAV_HEALTH_FAILURE',r'ClamAV unhealthy: (?:latest update failed or is incomplete|successful update evidence is stale|no verified update cycle|invalid persisted updater state|invalid update interval|no successful FreshClam result evidence|FreshClam reports cooldown or error|scanner is unavailable|(?:clamd|updater) (?:PID is missing|PID is invalid|stopped|is missing or defunct)|(?:main|daily|bytecode) has no successful update evidence)'),('EICAR',r'Win\.Test\.EICAR(?:_HDB-1|_UNOFFICIAL)? FOUND'),('CLAMD_CONNECT_REFUSED',r'Connection refused'),('CLAMD_UNAVAILABLE',r'Could not connect to clamd'),('CLAMD_SOCKET_MISSING',r'No such file or directory'),('NO_VIRUS_DATABASE',r'No supported database files found'),('CLAMAV_DATABASE_OK',r'Database status OK\.'),('NODE_HEAP_OOM',r'(?:Reached heap limit|Ineffective mark-compacts near heap limit) Allocation failed - JavaScript heap out of memory'),('NPM_COMMAND_FAILED',r'npm (?:error|ERR!) command failed'),('NODE_ADDRESS_IN_USE',r'listen EADDRINUSE'),('PRISMA_INITIALIZATION',r'PrismaClientInitializationError'),('DB_CONNECTION_REFUSED',r'ECONNREFUSED'),('DB_AUTHENTICATION_FAILED',r'password authentication failed'),('NPM_EXIT',r'npm (?:error|ERR!) (?:code|signal) (?:SIGKILL|SIGTERM|ENOMEM|137|143|1)\b'),('KILLED',r'^Killed$'),('HEALTH_TIMEOUT',r'Health check exceeded timeout'),('COMMAND_NOT_FOUND',r'not found')]
    result=[];withheld=0
    for line in raw.decode('utf8',errors='replace').splitlines():
        stamp=re.match(r'^(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z)\s',line)
        matches=[{'classification':name,'safeExcerpt':m.group(0)}for name,p in patterns if(m:=re.search(p,line))]
        if matches:result.append({'timestamp':stamp[1]if stamp else None,'rawLineSha256':hashlib.sha256(line.encode()).hexdigest(),'matches':matches})
        else:withheld+=1
    return {'rawBytes':len(raw),'rawSha256':hashlib.sha256(raw).hexdigest(),'safeMatches':result,'unmatchedLinesWithheld':withheld,'rawTextExported':False}

def observe_natural_updater(container):
    # Fixed container files and read-only VERSION/PING commands. Never RELOAD,
    # FRESHCLAM, UPDATE, updater invocation, cooldown write or health repair.
    import pathlib,stat,socket
    pid=container['State']['Pid'];assert type(pid)is int and pid>1
    root=pathlib.Path('/proc')/str(pid)/'root'
    def read(relative,maximum=4*1024**2):
        p=root/relative;a=p.lstat();assert stat.S_ISREG(a.st_mode)and not p.is_symlink()and 0<a.st_size<=maximum
        raw=p.read_bytes();b=p.lstat();assert tuple(getattr(a,k)for k in['st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])==tuple(getattr(b,k)for k in['st_dev','st_ino','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'])
        return raw,{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'device':str(a.st_dev),'inode':str(a.st_ino),'mtimeNs':str(a.st_mtime_ns)}
    state_raw,state_file=read('var/lib/clamav/.sabalan-updater-state',256);values=state_raw.decode().split();assert len(values)==4 and all(re.fullmatch('[0-9]{1,12}',v)for v in values)
    state=dict(zip(['attempted','succeeded','result','next'],map(int,values)))
    log,log_file=read('var/lib/clamav/.sabalan-freshclam-result')
    safe=[]
    for line in log.decode('utf8',errors='replace').splitlines():
        for pattern in[r'(?:main|daily|bytecode)\.(?:cvd|cld) (?:database is up-to-date|updated)',r'Database test passed',r'Database correctly reloaded',r'Clamd successfully notified about the update',r'(?:ERROR|WARNING): (?:Failed|Connection|Download|Update|FreshClam|Notified)',r'HTTP (?:403|429|200)',r'cool-down']:
            if match:=re.search(pattern,line,re.I):safe.append({'excerpt':match[0],'lineSha256':hashlib.sha256(line.encode()).hexdigest()})
    databases={}
    for name in['main','daily','bytecode']:
        choices=[root/('var/lib/clamav/'+name+ext)for ext in['.cvd','.cld']];files=[p for p in choices if p.exists()];assert len(files)==1
        p=files[0];a=p.lstat();assert stat.S_ISREG(a.st_mode)and not p.is_symlink();header=p.open('rb')
        try:raw=header.read(512)
        finally:header.close()
        b=p.lstat();assert(a.st_ino,a.st_size,a.st_mtime_ns,a.st_ctime_ns)==(b.st_ino,b.st_size,b.st_mtime_ns,b.st_ctime_ns)
        fields=raw.decode('ascii').strip().split(':');assert fields[0]=='ClamAV-VDB'and len(fields)>=8 and all(re.fullmatch('[0-9]{1,12}',fields[i])for i in[2,3,4])
        databases[name]={'filename':p.name,'bytes':a.st_size,'inode':str(a.st_ino),'mtimeNs':str(a.st_mtime_ns),'headerSha256':hashlib.sha256(raw).hexdigest(),'version':int(fields[2]),'signatures':int(fields[3]),'functionality':int(fields[4])}
    responses={}
    for command in['PING','VERSION']:
        with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM)as client:
            client.settimeout(5);client.connect(str(root/'tmp/clamd.sock'));client.sendall(b'z'+command.encode()+b'\x00');response=bytearray()
            while b'\x00'not in response and len(response)<=1024:
                part=client.recv(1024)
                if not part:break
                response.extend(part)
            assert len(response)<=1024;value=bytes(response).rstrip(b'\x00\r\n').decode('ascii');assert value=='PONG'if command=='PING'else re.fullmatch(r'ClamAV [0-9.]+/[0-9]+/[A-Za-z0-9 :]+',value)
            responses[command]=value
    repeated,_=read('var/lib/clamav/.sabalan-updater-state',256);stable=repeated==state_raw
    successful=stable and state['result']==0 and state['succeeded']>=state['attempted']>=1793185307
    all_success=all(any(re.search(name+r'\.(?:cvd|cld) (?:database is up-to-date|updated)',line,re.I)for line in log.decode('utf8',errors='replace').splitlines())for name in databases)
    return{'format':'sabalan-clamav-natural-update-observation/v1','state':state,'stateFile':state_file,'stateStable':stable,'resultFile':log_file,'safeResultLines':safe,'officialDatabaseHeaders':databases,'daemon':responses,'daemonDailyVersionMatches':int(responses['VERSION'].split('/')[1])==databases['daily']['version'],'scheduledNaturalUpdateSucceeded':successful and all_success,'updaterForced':False,'cooldownChanged':False,'readOnly':True,'healthAccepted':False}


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
    natural=observe_natural_updater(selected['clamav'])
    h.lock_guard();after=json.loads(h.run(['docker','container','inspect',*[c['Id']for c in selected.values()]]));assert all(c['State']['StartedAt']==selected[c['Config']['Labels']['com.docker.compose.service']]['State']['StartedAt']and c['RestartCount']==selected[c['Config']['Labels']['com.docker.compose.service']]['RestartCount']for c in after);h.no_lease()
    assert all(v['code']==0 and v['pipesClosed']and v['observationFault']is None for v in h.children)
    return {'format':'sabalan-source-runtime-diagnostics/v1','host':{'address':'94.182.85.254','sshPort':22,**host},'observedAt':end,'containers':rows,'naturalUpdater':natural,'originalChildren':originals,'kernelChildren':h.children,'allOriginalChildrenClosed':True,'diagnosticOnly':True,'readOnly':True,'productionAdmission':False,'runtimeAccepted':False}

if __name__=='__main__':
    k={'__name__':'fixed_readonly_runtime_kernel'};exec(compile(KERNEL,'reviewed-source-install-kernel','exec'),k);h=k['NativeHost']({'sourceHost':SOURCE_HOST},None)
    try:print(json.dumps(observe_runtime(h)),flush=True)
    finally:h.close()
