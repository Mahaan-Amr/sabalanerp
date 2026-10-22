"""SOURCE ONLY: fixed FEUP TLS tunnel in one explicitly enrolled AV netns.

No container commands, TLS termination, updater requests or bank/config writes.
`serve` proves the gateway without NAT. `route` proves it first, then owns one
IPv4 OUTPUT NAT chain. Both modes require an independently pinned private profile.
"""
import argparse,errno,hashlib,ipaddress,json,os,pathlib,re,select,shlex,signal,socket,stat,struct,subprocess,sys,threading,time,uuid
if sys.platform=='linux':import fcntl

HOST='mirrors.fe.up.pt';PORT=443;PROXY=('172.17.0.1',10808);LISTEN=('127.0.0.1',10443)
IMAGE='sha256:269ade6b36a74a2e188dc26265385a13141276d8acdab80c65f09df3b106f355'
CHAIN='SABALAN_AV_FEUP';MARK='sabalan-clamav-feup-tunnel/v1'
STOP=threading.Event();MAX_CONNECTIONS=8;BUFFER=65536;IDLE=180
EXECUTABLES={'python':'/usr/bin/python3','docker':'/usr/bin/docker','nsenter':'/usr/bin/nsenter','save':'/usr/sbin/iptables-save','restore':'/usr/sbin/iptables-restore','curl':'/usr/bin/curl','iptables':'/usr/sbin/iptables','ip':'/usr/sbin/ip'}
RUNTIME='/run/sabalan-clamav-feup-tunnel'

def require(value,message):
 if not value:raise RuntimeError(message)
def sha(raw):return hashlib.sha256(raw).hexdigest()
def private_file(file,mode=None,limit=1024*1024):
 p=pathlib.Path(file);require(p.is_absolute()and p.resolve(strict=True)==p,'NONCANONICAL_PRIVATE_FILE')
 for directory in (p.parent,*p.parent.parents):
  s=directory.lstat();require(directory.resolve(strict=True)==directory and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o022,'WRITABLE_OR_UNOWNED_ANCESTOR')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  a=os.fstat(fd);require(stat.S_ISREG(a.st_mode)and a.st_uid==0 and a.st_nlink==1 and not a.st_mode&0o022 and a.st_size<=limit,'PRIVATE_FILE_CUSTODY')
  if mode is not None:require(stat.S_IMODE(a.st_mode)==mode,'PRIVATE_FILE_MODE')
  chunks=[];total=0
  while chunk:=os.read(fd,65536):total+=len(chunk);require(total<=limit,'PRIVATE_FILE_BOUND');chunks.append(chunk)
  b=os.fstat(fd);c=p.lstat();key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_uid,s.st_mode,s.st_nlink)
  require(key(a)==key(b)==key(c),'PRIVATE_FILE_CHANGED');return b''.join(chunks)
 finally:os.close(fd)
def executable_digest(file):
 p=pathlib.Path(file);require(p.resolve(strict=True)==p,'EXECUTABLE_CANONICAL');fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode)and before.st_uid==0 and before.st_nlink==1 and not before.st_mode&0o022 and before.st_size<=256*1024**2,'EXECUTABLE_CUSTODY');h=hashlib.sha256()
  while chunk:=os.read(fd,65536):h.update(chunk)
  key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
  require(key(before)==key(os.fstat(fd))==key(p.lstat()),'EXECUTABLE_MUTATED');return h.hexdigest()
 finally:os.close(fd)
def executable_identity(p):
 result={}
 for name,logical in EXECUTABLES.items():
  resolved=pathlib.Path(logical).resolve(strict=True);require(str(resolved)==p['executables'][name]['resolved'],'EXECUTABLE_PATH_CHANGED');s=resolved.lstat()
  result[name]=(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
 return result
def profile(file,digest,verify_executables=True):
 require(re.fullmatch('[a-f0-9]{64}',digest),'PROFILE_DIGEST')
 raw=private_file(file,0o600);require(sha(raw)==digest,'PROFILE_CHANGED');p=json.loads(raw)
 keys={'format','role','containerId','image','startedAt','hostPid','hostStartTicks','netnsInode','networkId','networkName','containerAddress','project','service','resolvConfPath','resolvConfSha256','helperSha256','executables','ipv6Isolation','xtablesLockIdentity'}
 require(set(p)==keys and p['format']=='sabalan-clamav-feup-tunnel/v1','PROFILE_SCHEMA')
 require(p['role']in ('production-live','independent-restore')and p['image']==IMAGE and p['service']=='clamav','TARGET_ROLE')
 for key in ('containerId','networkId'):require(re.fullmatch('[a-f0-9]{64}',p[key]),'TARGET_ID')
 require(p['project']=='sabalanerp'if p['role']=='production-live'else bool(re.fullmatch('[a-z0-9][a-z0-9_-]{0,62}',p['project'])),'TARGET_PROJECT')
 for key in ('hostPid','hostStartTicks','netnsInode'):require(type(p[key])is int and p[key]>1,'TARGET_BIRTH')
 require(isinstance(p['startedAt'],str)and 0<len(p['startedAt'])<=64,'TARGET_START')
 require(re.fullmatch('[A-Za-z0-9_.-]{1,80}',p['networkName']),'TARGET_NETWORK_NAME')
 ip=ipaddress.IPv4Address(p['containerAddress']);require(ip.is_private and not ip.is_loopback,'TARGET_ADDRESS')
 require(pathlib.Path(p['resolvConfPath']).is_absolute()and re.fullmatch('[a-f0-9]{64}',p['resolvConfSha256']),'TARGET_RESOLVER')
 require(set(p['ipv6Isolation'])=={'interfaces','settings'}and p['ipv6Isolation']['interfaces']and all(re.fullmatch('[A-Za-z0-9_.-]{1,15}',x)for x in p['ipv6Isolation']['interfaces']),'IPV6_ISOLATION_PROFILE')
 require(set(p['xtablesLockIdentity'])=={'device','inode'},'XTABLES_LOCK_PROFILE');lock=pathlib.Path('/run/xtables.lock');require(lock.resolve(strict=True)==lock,'XTABLES_LOCK_CANONICAL');s=lock.lstat()
 require(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and not s.st_mode&0o022 and {'device':str(s.st_dev),'inode':str(s.st_ino)}==p['xtablesLockIdentity'],'XTABLES_LOCK_CHANGED')
 require(sha(private_file(__file__,limit=1024*1024))==p['helperSha256'],'HELPER_CHANGED')
 require(set(p['executables'])==set(EXECUTABLES),'EXECUTABLE_SET')
 for name,logical in EXECUTABLES.items():
  pin=p['executables'][name];resolved=pathlib.Path(logical).resolve(strict=True)
  require(set(pin)=={'resolved','sha256'}and str(resolved)==pin['resolved'],'EXECUTABLE_PATH')
  if verify_executables:require(executable_digest(resolved)==pin['sha256'],'EXECUTABLE_CHANGED')
 return p
def birth(pid):
 return int(pathlib.Path('/proc/'+str(pid)+'/stat').read_text().rsplit(') ',1)[1].split()[19])
def command(argv,fd=None,data=None,timeout=15):
 environment=dict(os.environ)
 for k in list(environment):
  if k in ('LD_PRELOAD','LD_LIBRARY_PATH','PYTHONPATH','PYTHONHOME')or k.startswith('DOCKER_'):environment.pop(k,None)
 p=subprocess.Popen(argv,stdin=subprocess.PIPE if data is not None else subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=()if fd is None else(fd,),env=environment)
 try:out,err=p.communicate(data,timeout=timeout)
 except subprocess.TimeoutExpired:
  p.terminate()
  try:p.communicate(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.communicate()
  raise RuntimeError('OWNED_QUERY_TIMEOUT:'+pathlib.Path(argv[0]).name)
 require(len(out)+len(err)<=1024*1024,'COMMAND_OUTPUT_BOUND')
 require(p.returncode==0,'COMMAND_FAILED:'+pathlib.Path(argv[0]).name+':'+str(p.returncode))
 return out
def observe(p):
 value=json.loads(command([EXECUTABLES['docker'],'--host','unix:///var/run/docker.sock','inspect',p['containerId']]))
 require(len(value)==1,'TARGET_COUNT');v=value[0]
 require(v['Id']==p['containerId']and v['Image']==p['image']and v['State']['Running']and v['State']['StartedAt']==p['startedAt']and v['State']['Pid']==p['hostPid'],'TARGET_INCARNATION_CHANGED')
 labels=v['Config']['Labels'];require(labels.get('com.docker.compose.project')==p['project']and labels.get('com.docker.compose.service')==p['service'],'TARGET_LABELS')
 require(v['HostConfig'].get('NetworkMode')not in ('host','none')and not v['HostConfig'].get('Privileged')and v['ResolvConfPath']==p['resolvConfPath'],'TARGET_NETWORK_MODE')
 nets=v['NetworkSettings']['Networks'];require(set(nets)=={p['networkName']},'TARGET_NETWORKS')
 n=nets[p['networkName']];require(n['NetworkID']==p['networkId']and n['IPAddress']==p['containerAddress']and not n.get('GlobalIPv6Address'),'TARGET_NETWORK_CHANGED')
 require(birth(p['hostPid'])==p['hostStartTicks'],'TARGET_PID_REUSED')
 require(os.stat('/proc/'+str(p['hostPid'])+'/ns/net').st_ino==p['netnsInode'],'TARGET_NETNS_CHANGED')
 raw=private_file(p['resolvConfPath']);require(sha(raw)==p['resolvConfSha256'],'TARGET_RESOLVER_CHANGED')
 require([line.split()[1]for line in raw.decode().splitlines()if line.strip().startswith('nameserver ')]==['127.0.0.11'],'DOCKER_RESOLVER_REQUIRED')
 return {'containerId':p['containerId'],'image':p['image'],'startedAt':p['startedAt'],'hostPid':p['hostPid'],'hostStartTicks':p['hostStartTicks'],'netnsInode':p['netnsInode'],'containerAddress':p['containerAddress']}
def namespace(p):
 observe(p);fd=os.open('/proc/'+str(p['hostPid'])+'/ns/net',os.O_RDONLY|os.O_CLOEXEC)
 require(os.fstat(fd).st_ino==p['netnsInode'],'NETNS_FD_CHANGED');observe(p);return fd
def inside(fd,*args):return[EXECUTABLES['nsenter'],'--net=/proc/self/fd/'+str(fd),'--',*args]

def dns_name(raw,offset):
 labels=[];end=None;seen=set()
 for _ in range(128):
  require(offset<len(raw)and offset not in seen,'DNS_NAME');seen.add(offset);size=raw[offset]
  if size&0xc0==0xc0:
   require(offset+1<len(raw),'DNS_POINTER');end=end if end is not None else offset+2;offset=((size&63)<<8)|raw[offset+1];continue
  require(not size&0xc0 and size<=63,'DNS_LABEL');offset+=1
  if size==0:return '.'.join(labels).lower(),end if end is not None else offset
  require(offset+size<=len(raw),'DNS_LABEL_BOUND');labels.append(raw[offset:offset+size].decode('ascii'));offset+=size
 raise RuntimeError('DNS_NAME_DEPTH')
def dns_answer(raw,identifier,qtype):
 require(len(raw)>=12,'DNS_HEADER');ident,flags,questions,answers,authorities,additionals=struct.unpack('!6H',raw[:12])
 require(ident==identifier and flags&0x8000 and not flags&0x0200 and flags&15==0 and questions==1,'DNS_RESPONSE')
 name,offset=dns_name(raw,12);require(name==HOST and raw[offset:offset+4]==struct.pack('!HH',qtype,1),'DNS_QUESTION');offset+=4;records=[]
 for index in range(answers+authorities+additionals):
  owner,offset=dns_name(raw,offset);require(offset+10<=len(raw),'DNS_RR');kind,klass,ttl,size=struct.unpack('!HHIH',raw[offset:offset+10]);offset+=10;end=offset+size;require(end<=len(raw),'DNS_RDATA')
  if index<answers and klass==1:
   if kind==5:
    cname,used=dns_name(raw,offset);require(used==end,'DNS_CNAME_BOUND');records.append((owner,kind,cname,ttl))
   elif kind in (1,28):
    require(size==(4 if kind==1 else 16),'DNS_IP_LENGTH');records.append((owner,kind,str(ipaddress.ip_address(raw[offset:end])),ttl))
  offset=end
 require(offset==len(raw),'DNS_TRAILING')
 chain={HOST};ttls=[];current=HOST
 for _ in range(8):
  aliases=[r for r in records if r[0]==current and r[1]==5]
  if not aliases:break
  require(len(aliases)==1 and aliases[0][2]not in chain,'DNS_CNAME_CHAIN');current=aliases[0][2];chain.add(current);ttls.append(aliases[0][3])
 else:raise RuntimeError('DNS_CNAME_DEPTH')
 addresses=[]
 for owner,kind,value,ttl in records:
  if owner in chain and kind==qtype:
   require(ipaddress.ip_address(value).is_global,'DNS_PUBLIC_ADDRESS_REQUIRED');addresses.append(value);ttls.append(ttl)
 return sorted(set(addresses)),min(ttls)if ttls else 60
def resolve():
 result={};deadlines=[]
 for kind,key in ((1,'ipv4'),(28,'ipv6')):
  identifier=int.from_bytes(os.urandom(2),'big');question=b''.join(bytes([len(x)])+x.encode()for x in HOST.split('.'))+b'\0'+struct.pack('!HH',kind,1)
  query=struct.pack('!6H',identifier,0x0100,1,0,0,0)+question
  with socket.socket(socket.AF_INET,socket.SOCK_DGRAM)as stream:
   stream.settimeout(5);stream.connect(('127.0.0.11',53));stream.send(query);raw=stream.recv(65535);received=time.monotonic()
  result[key],ttl=dns_answer(raw,identifier,kind);require(ttl>=5,'DNS_TTL_TOO_SHORT');deadlines.append(received+min(ttl,300))
 require(result['ipv4']and len(result['ipv4'])<=16,'NO_BOUNDED_FEUP_IPV4')
 require(len(result['ipv6'])<=16,'DNS_IPV6_BOUND');result['expiresMonotonic']=min(deadlines);require(time.monotonic()<result['expiresMonotonic'],'DNS_EXPIRED_DURING_QUERY');return result

def validate_ipv6_snapshot(snapshot,expected):
 require(set(expected)=={'interfaces','settings'},'IPV6_EXPECTATION')
 interfaces=sorted(v['ifname']for v in snapshot['links']if 'LOOPBACK'not in v.get('flags',[]))
 require(interfaces==sorted(expected['interfaces'])and len(interfaces)==len(set(interfaces)),'IPV6_INTERFACE_SET_CHANGED')
 require(snapshot['settings']==expected['settings'],'IPV6_SETTINGS_CHANGED')
 for interface in interfaces:require(snapshot['settings'][interface]['disable_ipv6']=='1','NONLOOPBACK_IPV6_ENABLED')
 for row in snapshot['addresses']:
  require(row['ifname']=='lo','NONLOOPBACK_IPV6_ADDRESS')
  for address in row.get('addr_info',[]):require(address.get('family')=='inet6'and address.get('local')=='::1'and address.get('prefixlen')==128 and address.get('scope')=='host','EXTERNAL_IPV6_ADDRESS')
 for row in snapshot['routes']:require(row.get('dev')=='lo'and row.get('type')=='local'and row.get('dst')=='::1','EXTERNAL_IPV6_ROUTE')
 return True
def ipv6_snapshot():
 settings={};directory=pathlib.Path('/proc/sys/net/ipv6/conf')
 require(directory.is_dir(),'IPV6_SYSCTL_UNAVAILABLE')
 for item in directory.iterdir():
  if item.is_dir():settings[item.name]={key:(item/key).read_text().strip()for key in ('disable_ipv6','accept_ra','forwarding')}
 return {'settings':settings,'links':json.loads(command([EXECUTABLES['ip'],'-j','link','show'])),'addresses':json.loads(command([EXECUTABLES['ip'],'-j','-6','address','show'])),'routes':json.loads(command([EXECUTABLES['ip'],'-j','-6','route','show','table','all']))}
def prove_ipv6_unreachable(p,addresses):
 before=ipv6_snapshot();validate_ipv6_snapshot(before,p['ipv6Isolation']);attempts=[]
 for address in addresses:
  require(ipaddress.IPv6Address(address).is_global,'IPV6_PUBLIC_ADDRESS')
  with socket.socket(socket.AF_INET6,socket.SOCK_STREAM)as stream:
   stream.settimeout(1);started=time.monotonic();code=stream.connect_ex((address,443,0,0));elapsed=time.monotonic()-started
  require(code==errno.ENETUNREACH and elapsed<=1,'IPV6_KERNEL_UNREACHABILITY_UNPROVEN');attempts.append({'address':address,'errno':code,'errnoName':'ENETUNREACH','elapsedSeconds':elapsed,'originalSocketClosed':True})
 after=ipv6_snapshot();validate_ipv6_snapshot(after,p['ipv6Isolation']);require(before==after,'IPV6_CHANGED_DURING_PROOF')
 return {'policy':'existing-disabled-nonloopback-v1','snapshot':before,'attempts':attempts,'operatorChangedFlags':False,'allActualAAAAProvenUnreachable':True}

def connect_proxy(stream):
 stream.settimeout(10);stream.sendall(('CONNECT '+HOST+':443 HTTP/1.1\r\nHost: '+HOST+':443\r\n\r\n').encode());header=b''
 while b'\r\n\r\n'not in header:
  part=stream.recv(4096);require(part,'PROXY_EOF');header+=part;require(len(header)<=32768,'PROXY_HEADER_BOUND')
 top,tail=header.split(b'\r\n\r\n',1);first=top.split(b'\r\n',1)[0]
 require(re.fullmatch(rb'HTTP/1\.[01] 2[0-9][0-9](?: [\x20-\x7e]*)?',first),'PROXY_CONNECT_REFUSED');return tail
def relay(left,right,pending=b'',stop=STOP,idle=IDLE):
 streams=(left,right);buffers={left:bytearray(pending),right:bytearray()};eof={left:False,right:False};shut={left:False,right:False};last=time.monotonic()
 for stream in streams:stream.setblocking(False)
 while not stop.is_set():
  for source,dest in ((left,right),(right,left)):
   if eof[source]and not buffers[dest]and not shut[dest]:
    try:dest.shutdown(socket.SHUT_WR)
    except OSError:pass
    shut[dest]=True
  if all(eof.values())and not any(buffers.values()):return
  require(time.monotonic()-last<idle,'TUNNEL_IDLE')
  readers=[s for s,d in ((left,right),(right,left))if not eof[s]and len(buffers[d])<BUFFER]
  writers=[s for s in streams if buffers[s]]
  ready,writable,errors=select.select(readers,writers,list(streams),1)
  require(not errors,'TUNNEL_SOCKET_ERROR')
  for source in ready:
   dest=right if source is left else left
   try:data=source.recv(BUFFER-len(buffers[dest]))
   except BlockingIOError:continue
   if data:buffers[dest].extend(data);last=time.monotonic()
   else:eof[source]=True
  for dest in writable:
   try:sent=dest.send(buffers[dest])
   except BlockingIOError:continue
   require(sent>0,'TUNNEL_SEND_EOF');del buffers[dest][:sent];last=time.monotonic()
def gateway(p,ready):
 listener=socket.socket();listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1);listener.bind(LISTEN);listener.listen(MAX_CONNECTIONS);listener.settimeout(1)
 # Only this host-owned child drops privilege. It never joins target PID/mount namespaces.
 os.setgroups([]);os.setgid(65534);os.setuid(65534)
 os.write(ready,json.dumps({'pid':os.getpid(),'address':LISTEN[0],'port':LISTEN[1],'uid':os.getuid(),'pidNamespace':os.readlink('/proc/self/ns/pid'),'mountNamespace':os.readlink('/proc/self/ns/mnt'),'networkNamespaceInode':os.stat('/proc/self/ns/net').st_ino}).encode());os.close(ready)
 capacity=threading.BoundedSemaphore(MAX_CONNECTIONS);threads=[]
 def handle(client):
  try:
   with client,socket.create_connection(PROXY,timeout=10)as upstream:relay(client,upstream,connect_proxy(upstream))
  except (OSError,RuntimeError)as error:print(json.dumps({'event':'tunnel-connection-failed','errorType':type(error).__name__}),flush=True)
  finally:capacity.release()
 try:
  while not STOP.is_set():
   try:client,peer=listener.accept()
   except socket.timeout:continue
   if peer[0]not in ('127.0.0.1',p['containerAddress'])or not capacity.acquire(blocking=False):client.close();continue
   thread=threading.Thread(target=handle,args=(client,));thread.start();threads=[t for t in threads if t.is_alive()]+[thread]
 finally:
  listener.close();STOP.set()
  for thread in threads:thread.join(12)

def tag(token):require(re.fullmatch('[a-f0-9]{32}',token),'OWNER_TOKEN');return MARK+':'+token
def jump(address,token):return '-A OUTPUT -d '+address+'/32 -p tcp -m tcp --dport 443 -m comment --comment "'+tag(token)+':jump" -j '+CHAIN
def redirect_rule(token):return '-A '+CHAIN+' -p tcp -m tcp --dport 443 -m comment --comment "'+tag(token)+':redirect" -j REDIRECT --to-ports 10443'
def marker_rule(token):return '-A '+CHAIN+' -m comment --comment "'+tag(token)+':owner" -j RETURN'
def owned_rules(saved,token=None,empty=False):
 declarations=[];jumps=[];rules=[]
 for line in saved.splitlines():
  if line.startswith(':'+CHAIN+' '):declarations.append(line)
  elif line.startswith('-A '):
   row=shlex.split(line)
   if len(row)>1 and row[1]==CHAIN:rules.append(row)
   elif any(flag in row and row.index(flag)+1<len(row)and row[row.index(flag)+1]==CHAIN for flag in ('-j','-g')):
    require(token is not None and len(row)==16 and row[:3]==['-A','OUTPUT','-d']and row[4:]==['-p','tcp','-m','tcp','--dport','443','-m','comment','--comment',tag(token)+':jump','-j',CHAIN],'FOREIGN_CHAIN_REFERENCE')
    require(row[3].endswith('/32'),'FOREIGN_CHAIN_REFERENCE');address=row[3][:-3];require(ipaddress.IPv4Address(address).is_global,'FOREIGN_CHAIN_REFERENCE');jumps.append(address)
 require(len(declarations)<=1 and len(jumps)==len(set(jumps))and len(jumps)<=16,'OWNED_CHAIN_AMBIGUOUS')
 require(not declarations or re.fullmatch(':'+CHAIN+r' - \[[0-9]+:[0-9]+\]',declarations[0]),'OWNED_CHAIN_POLICY')
 require(token is not None or not(declarations or rules or jumps),'EXISTING_NAT_CHAIN_REQUIRES_RECONCILIATION')
 expected=[]if empty or not declarations else[shlex.split(redirect_rule(token)),shlex.split(marker_rule(token))]
 require(rules==expected,'FOREIGN_RULE_IN_OWNED_CHAIN');require(bool(declarations)or not(rules or jumps),'OWNED_CHAIN_MISSING')
 if empty:require(not jumps,'UNOWNED_EMPTY_CHAIN_REFERENCE')
 return bool(declarations),sorted(jumps),rules
def foreign_rules(saved):
 result=[]
 for line in saved.splitlines():
  if not line or line.startswith('#'):continue
  if line.startswith(':'+CHAIN+' '):continue
  if line.startswith('-A '):
   row=shlex.split(line)
   if row[1]==CHAIN or any(flag in row and row.index(flag)+1<len(row)and row[row.index(flag)+1]==CHAIN for flag in ('-j','-g')):continue
  result.append(re.sub(r' \[[0-9]+:[0-9]+\]$',' [COUNTERS]',line)if line.startswith(':')else line)
 return result
def nat_transaction(saved,addresses,token,phase):
 require(phase in ('initialize','update','remove'),'NAT_PHASE');exists,old,rules=owned_rules(saved,token,empty=phase=='initialize');require(exists,'ORIGINAL_CHAIN_REQUIRED');require(len(addresses)==len(set(addresses))and len(addresses)<=16,'NAT_ADDRESS_SET')
 for address in addresses:require(ipaddress.IPv4Address(address).is_global,'NAT_PUBLIC_ADDRESS')
 lines=['*nat']
 lines +=[jump(address,token).replace('-A OUTPUT','-D OUTPUT',1)for address in old]
 if phase=='initialize':lines+=[redirect_rule(token),marker_rule(token)]
 if phase=='remove':lines+=[redirect_rule(token).replace('-A ','-D ',1),marker_rule(token).replace('-A ','-D ',1),'-X '+CHAIN]
 else:lines+=[jump(address,token)for address in sorted(addresses)]
 return '\n'.join(lines+['COMMIT',''])
class NatOwner:
 def __init__(self,fd):self.fd=fd;self.token=uuid.uuid4().hex;self.created=False;self.initialized=False;self.guard=threading.RLock()
 def snapshot(self):return command(inside(self.fd,EXECUTABLES['save'],'-t','nat'),self.fd).decode()
 def create(self,addresses,deadline):
  with self.guard:
   deadline.check();owned_rules(self.snapshot());require(b'(nf_tables)'in command(inside(self.fd,EXECUTABLES['iptables'],'--version'),self.fd),'NFT_BACKEND_REQUIRED')
   deadline.check();command(inside(self.fd,EXECUTABLES['iptables'],'--wait','5','-t','nat','-N',CHAIN),self.fd)
   self.created=True;deadline.check();self.change(addresses,'initialize',deadline)
 def change(self,addresses,phase,deadline=None):
  with self.guard:
   require(self.created,'ORIGINAL_CREATE_REQUIRED')
   if deadline is not None:deadline.check()
   before=self.snapshot();transaction=nat_transaction(before,addresses,self.token,phase)
   if deadline is not None:deadline.check()
   command(inside(self.fd,EXECUTABLES['restore'],'--wait','5','--noflush'),self.fd,transaction.encode())
   if phase=='initialize':self.initialized=True
   after=self.snapshot()
   if phase=='remove':owned_rules(after);self.created=False;self.initialized=False
   else:require(owned_rules(after,self.token)[1]==sorted(addresses),'NAT_REOBSERVATION_FAILED')
   require(foreign_rules(before)==foreign_rules(after),'FOREIGN_NAT_CHANGED_REQUIRES_RECONCILIATION')
   if deadline is not None:deadline.check()
 def remove(self):
  with self.guard:
   if not self.created:return
   if self.initialized:self.change([],'remove')
   else:
    # A partial original creation can delete only its still-empty chain.
    owned_rules(self.snapshot(),self.token,empty=True)
    command(inside(self.fd,EXECUTABLES['iptables'],'--wait','5','-t','nat','-X',CHAIN),self.fd);self.created=False
def original_namespace_lock(p):
 directory=pathlib.Path(RUNTIME);require(directory.resolve(strict=True)==directory,'OWNERSHIP_DIRECTORY');s=directory.lstat()
 require(stat.S_ISDIR(s.st_mode)and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'OWNERSHIP_DIRECTORY_CUSTODY')
 file=directory/('namespace-'+str(p['netnsInode'])+'.lock');fd=os.open(file,os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW,0o600);s=os.fstat(fd)
 require(stat.S_ISREG(s.st_mode)and s.st_uid==0 and s.st_nlink==1 and s.st_size==0 and stat.S_IMODE(s.st_mode)==0o600,'OWNERSHIP_LOCK_CUSTODY');fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
 return fd,file,(s.st_dev,s.st_ino)
class DnsDeadline:
 def __init__(self,expires,on_expire,clock=time.monotonic):
  self.clock=clock;self.expires=expires;self.callback=on_expire;self.failed=threading.Event();self.done=threading.Event();self.guard=threading.Lock();self.thread=None;self.check()
 def check(self):
  with self.guard:require(not self.failed.is_set()and self.clock()<self.expires,'DNS_ABSOLUTE_DEADLINE_EXPIRED')
 def replace(self,expires):
  with self.guard:
   require(not self.failed.is_set()and self.clock()<self.expires and self.clock()<expires,'EXPIRED_DNS_CANNOT_BE_RENEWED');self.expires=expires
 def poll(self):
  fire=False
  with self.guard:
   if not self.failed.is_set()and self.clock()>=self.expires:self.failed.set();fire=True
  if fire:self.callback()
  return fire
 def start(self):
  self.poll();self.check()
  def watch():
   while not self.done.wait(.02):
    if self.poll():return
  self.thread=threading.Thread(target=watch,daemon=True);self.thread.start()
 def close(self):
  self.done.set()
  if self.thread is not None:self.thread.join(90);require(not self.thread.is_alive(),'DNS_WATCHDOG_CLOSURE_UNKNOWN')
def stop_child(child,pidfd=None):
 if child is None:return
 if child.poll()is None:
  require(pidfd is not None,'ORIGINAL_GATEWAY_PIDFD_REQUIRED')
  try:signal.pidfd_send_signal(pidfd,signal.SIGTERM)
  except ProcessLookupError:pass
  try:child.wait(timeout=15)
  except subprocess.TimeoutExpired:signal.pidfd_send_signal(pidfd,signal.SIGKILL);child.wait()
 require(child.returncode is not None,'OWNED_GATEWAY_CLOSURE_UNKNOWN')
def redirect_packets(fd,token):
 saved=command(inside(fd,EXECUTABLES['save'],'-c','-t','nat'),fd).decode();counts=[]
 for line in saved.splitlines():
  match=re.match(r'^\[([0-9]+):([0-9]+)\] (.*)$',line)
  if match and shlex.split(match[3])==shlex.split(redirect_rule(token)):counts.append(int(match[1]))
 require(len(counts)==1,'OWNED_REDIRECT_COUNTER_UNPROVEN');return counts[0]
def qualification(fd,address=None):
 url='https://'+HOST+'/pub/clamav/daily.cvd'
 selection=['--connect-to',HOST+':443:127.0.0.1:10443']if address is None else['--resolve',HOST+':443:'+address]
 args=inside(fd,EXECUTABLES['curl'],'--silent','--show-error','--noproxy','*','--proto','=https','--head','--max-redirs','0','--connect-timeout','10','--max-time','30',*selection,'--write-out','\nSABALAN_TLS_RESULT %{http_code} %{ssl_verify_result} %{remote_ip} %{remote_port}\n',url)
 raw=command(args,fd,timeout=40).decode();last=raw.rstrip().splitlines()[-1];fields=last.split()
 require(len(fields)==5 and fields[:3]==['SABALAN_TLS_RESULT','200','0'],'GATEWAY_TLS_HEAD_UNPROVEN')
 if address is None:require(fields[3:]==['127.0.0.1','10443'],'GATEWAY_LOOPBACK_UNPROVEN')
 return {'origin':url,'httpStatus':200,'tlsVerificationResult':0,'remoteAddress':fields[3],'remotePort':int(fields[4]),'testClientResolveOverride':address,'headOnly':True,'redirectsAllowed':False,'originalClientClosed':True,'responseSha256':sha(raw.encode())}
def guarded_target(p,child,deadline):
 deadline.check();value=observe(p);deadline.check();require(child.poll()is None,'GATEWAY_DIED');return value
def guarded_gateway_proof(fd,p,child,deadline):
 deadline.check();value=qualification(fd);deadline.check();return value,guarded_target(p,child,deadline)
def monitor(p,file,digest,mode):
 fd=namespace(p);child=None;pidfd=None;owner=NatOwner(fd);deadline=None;lockfd=None;executable_pins=executable_identity(p)
 try:
  lockfd,lockfile,lockidentity=original_namespace_lock(p)
  # A pre-existing chain is a collision, not permission to adopt another run.
  saved=command(inside(fd,EXECUTABLES['save'],'-t','nat'),fd).decode();require(owned_rules(saved)==(False,[],[]),'EXISTING_NAT_CHAIN_REQUIRES_RECONCILIATION')
  def child_query(mode,addresses=None):
   if deadline is not None:deadline.check()
   extra=[]if addresses is None else['--addresses-json',json.dumps(addresses)]
   value=json.loads(command(inside(fd,EXECUTABLES['python'],'-I','-B',str(pathlib.Path(__file__).resolve()),mode,'--profile',file,'--sha256',digest,*extra),fd))
   if deadline is not None:deadline.check()
   return value
  dns=child_query('dns')
  def expire():
   STOP.set()
   try:
    try:signal.pidfd_send_signal(pidfd,signal.SIGKILL)
    except ProcessLookupError:pass
    print(json.dumps({'event':'absolute-dns-expired-original-gateway-killed','netnsInode':p['netnsInode'],'ownerToken':owner.token}),flush=True)
   finally:
    try:owner.remove()
    except BaseException as error:print(json.dumps({'event':'expired-route-reconciliation-required','errorType':type(error).__name__}),flush=True)
  require(time.monotonic()<dns['expiresMonotonic'],'INITIAL_DNS_EXPIRED_BEFORE_GATEWAY_CREATION')
  readfd,writefd=os.pipe()
  try:
   argv=inside(fd,EXECUTABLES['python'],'-I','-B',str(pathlib.Path(__file__).resolve()),'gateway','--profile',file,'--sha256',digest,'--ready-fd',str(writefd))
   child=subprocess.Popen(argv,stdin=subprocess.DEVNULL,pass_fds=(fd,writefd));pidfd=os.pidfd_open(child.pid,0)
   # Protect INITIAL packet receipt expiry before readiness waits or TLS.
   deadline=DnsDeadline(dns['expiresMonotonic'],expire);deadline.start()
   os.close(writefd);writefd=None
   require(select.select([readfd],[],[],20)[0],'GATEWAY_READY_TIMEOUT');ready=json.loads(os.read(readfd,4096));require(ready=={'pid':child.pid,'address':LISTEN[0],'port':LISTEN[1],'uid':65534,'pidNamespace':os.readlink('/proc/self/ns/pid'),'mountNamespace':os.readlink('/proc/self/ns/mnt'),'networkNamespaceInode':p['netnsInode']},'GATEWAY_READY_UNPROVEN')
  finally:
   os.close(readfd)
   if writefd is not None:os.close(writefd)
  proof,_=guarded_gateway_proof(fd,p,child,deadline)
  updated=child_query('dns');deadline.replace(updated['expiresMonotonic']);dns=updated
  ipv6=child_query('ipv6',dns['ipv6']);deadline.check()
  target=guarded_target(p,child,deadline)
  print(json.dumps({'event':'gateway-qualified-before-nat','mode':mode,'target':target,'dns':dns,'ipv6PhysicalProof':ipv6,'proof':proof,'gatewayPid':child.pid,'gatewayBirth':birth(child.pid),'hostPidNamespace':os.readlink('/proc/self/ns/pid'),'hostMountNamespace':os.readlink('/proc/self/ns/mnt')}),flush=True)
  if mode=='route':
   require(dns['ipv4'],'NO_QUALIFIED_IPV4_ROUTE');owner.create(dns['ipv4'],deadline)
   deadline.check();packets=redirect_packets(fd,owner.token);routeproof=qualification(fd,dns['ipv4'][0]);deadline.check();require(redirect_packets(fd,owner.token)>packets,'ACTUAL_NAT_PATH_UNPROVEN');observe(p);deadline.check();require(child.poll()is None,'GATEWAY_DIED')
   print(json.dumps({'event':'owned-route-installed','addresses':dns['ipv4'],'target':p['containerId'],'actualNatTlsHead':routeproof,'ownedRedirectCounterAdvanced':True}),flush=True)
  refresh=time.monotonic()+(dns['expiresMonotonic']-time.monotonic())/2
  while not STOP.wait(2):
   deadline.check();require(child.poll()is None,'GATEWAY_DIED');require(profile(file,digest,False)==p,'PROFILE_CHANGED');require(executable_identity(p)==executable_pins,'EXECUTABLE_IDENTITY_CHANGED');observe(p);deadline.check();require(os.fstat(fd).st_ino==p['netnsInode'],'PINNED_NETNS_CHANGED')
   named=lockfile.lstat();held=os.fstat(lockfd);require((named.st_dev,named.st_ino)==lockidentity==(held.st_dev,held.st_ino),'ORIGINAL_OWNERSHIP_LOCK_CHANGED')
   child_query('ipv6',dns['ipv6'])
   if time.monotonic()>=refresh:
    updated=child_query('dns');child_query('ipv6',updated['ipv6']);deadline.check()
    if mode=='route'and updated['ipv4']!=dns['ipv4']:owner.change(updated['ipv4'],'update',deadline)
    deadline.replace(updated['expiresMonotonic']);dns=updated;refresh=time.monotonic()+(dns['expiresMonotonic']-time.monotonic())/2
  require(not deadline.failed.is_set(),'DNS_EXPIRY_IS_NOT_SUCCESSFUL_SHUTDOWN')
 finally:
  # Only the original child and this run's own namespace/chain are touched.
  try:
   # Keep the independent expiry watchdog active until all forwarding is closed.
   stop_child(child,pidfd)
  finally:
   try:
    if deadline is not None:deadline.close()
    owner.remove()
   finally:
    if pidfd is not None:os.close(pidfd)
    if lockfd is not None:os.close(lockfd)
    os.close(fd)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['serve','route','gateway','dns','ipv6']);parser.add_argument('--profile',required=True);parser.add_argument('--sha256',required=True);parser.add_argument('--ready-fd',type=int);parser.add_argument('--addresses-json')
 args=parser.parse_args();require(sys.platform=='linux'and os.getuid()==0 and not sys.flags.optimize,'LINUX_ROOT_REQUIRED')
 for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,lambda *_:STOP.set())
 p=profile(args.profile,args.sha256)
 if args.mode in ('serve','route'):monitor(p,args.profile,args.sha256,args.mode)
 else:
  require(os.stat('/proc/self/ns/net').st_ino==p['netnsInode'],'CHILD_NOT_IN_TARGET_NETNS')
  if args.mode=='dns':print(json.dumps(resolve()))
  elif args.mode=='ipv6':
   addresses=json.loads(args.addresses_json);require(isinstance(addresses,list)and len(addresses)<=16 and len(addresses)==len(set(addresses)),'IPV6_ADDRESS_ARGUMENT');print(json.dumps(prove_ipv6_unreachable(p,addresses)))
  else:require(args.ready_fd is not None and args.ready_fd>=3,'READY_FD_REQUIRED');gateway(p,args.ready_fd)
if __name__=='__main__':main()
