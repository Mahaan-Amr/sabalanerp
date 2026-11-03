"""Renderer fragment: finite guarded production stream phases, no archive file.
The fixed producer supplies constants, canonical NativeHost and four guards.
"""
def select_secret_root(compose,spec):
 # Canonical resolved Compose semantics, including its existing declared default.
 volumes=compose['services']['deployment']['volumes'];assert isinstance(volumes,list)
 selected=[v for v in volumes if v.get('target')=='/run/deployment-secrets']
 assert len(selected)==1 and selected[0].get('type')=='bind'and selected[0].get('read_only')is True,'CANONICAL_DEPLOYMENT_SECRET_BIND_REQUIRED'
 source=selected[0]['source'];root=pathlib.PurePosixPath(source)
 assert isinstance(source,str)and source.startswith('/')and str(root)==source and '..'not in root.parts and source!='/','CANONICAL_DEPLOYMENT_SECRET_SOURCE_REQUIRED'
 public=[m for m in spec['expectedServiceConfiguration']['backend']['mounts']if m['destination']=='/run/deployment-secrets/partner-release-trust-public.der']
 assert len(public)==1 and public[0]['type']=='bind'and public[0]['readWrite']is False
 assert pathlib.PurePosixPath(public[0]['source'])==root/'partner-release-trust-public.der','OBSERVED_BACKEND_PUBLIC_TRUST_PARENT_REQUIRED'
 return source

def parent_guard(h):
 private=pathlib.Path('/root/sabalan-recovery-private');s=private.lstat()
 assert private.resolve(strict=True)==private and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o077
 selected=json.loads(h.run(['docker','image','inspect',IMAGE]));assert len(selected)==1 and selected[0]['Id']==IMAGE
 assert type(selected[0]['Size'])is int and 0<selected[0]['Size']<2**31
 roots=[]
 for name in ['postgres_data','backend_storage_contracts','backend_storage_hr_hiring','backend_storage_accounting_contracts','backend_storage_support_tickets','backend_storage_performance_exports','backend_uploads','inquiry_data','recovery_coordination']:
  root=pathlib.Path(h.run(['docker','volume','inspect','sabalanerp_'+name,'--format','{{.Mountpoint}}']).decode().strip());assert root.is_absolute()and root.resolve(strict=True)==root;roots.append(str(root))
 k['safe_read'](CAPACITY,CAPACITY_SHA,maximum=1024**2)
 capacity=h.run(['/usr/bin/node',CAPACITY,'0',*roots]).decode().split();assert len(capacity)==2 and all(x.isdigit()for x in capacity)
 free=os.statvfs(private);assert free.f_bavail*free.f_frsize>=int(capacity[0]),'CANONICAL_RESERVE_REFUSED'
 compose=json.loads(h.run(['docker','compose','--profile','deployment','--env-file','/opt/sabalanerp/deploy/.env.prod','-f','/opt/sabalanerp/docker-compose.prod.yml','config','--format','json'],maximum=4*1024**2))
 secret=pathlib.Path(select_secret_root(compose,SPEC));assert secret.resolve(strict=True)==secret
 recipient=json.loads(h.run(['/usr/bin/node','-e',PUBLIC_PROBE,str(secret)],maximum=16384));assert recipient['format']=='sabalan-source-a-recipient-spki/v1'and recipient['sha256']=='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
 return selected[0],str(secret),{'canonicalReserveBytes':int(capacity[0]),'sourceFileSizeBound':SOURCE_WORKSPACE_BOUND,'availableBytes':free.f_bavail*free.f_frsize}

def pipeline_bytes(secret):
 assert PIPELINE.count('const BOUND=null;')==1
 assert PIPELINE.count('const COMPONENT=null;')==1
 return PIPELINE.replace('const COMPONENT=null;','const COMPONENT='+json.dumps(COMPONENT,sort_keys=True)+';').replace('const BOUND=null;','const BOUND='+json.dumps({'mode':PHASE,'secretRoot':secret},sort_keys=True)+';').encode()

def stage():
 h=k['NativeHost'](SPEC,SPEC_SHA);h.baseline=SPEC['expectedEight']
 try:
  h.acquire();boundary(h);node=current_node();selected,secret,capacity=parent_guard(h)
  root=pathlib.Path(REMOTE_ROOT);assert root.parent==pathlib.Path('/root/sabalan-recovery-private')and not os.path.lexists(root)
  payloads={'runtime.py':RUNTIME.encode(),'pipeline.cjs':pipeline_bytes(secret),'stream-codec.cjs':STREAM_CODEC.encode()}
  assert sum(map(len,payloads.values()))<=SOURCE_WORKSPACE_BOUND
  free=os.statvfs(root.parent);block=free.f_frsize
  allocated_estimate=sum(((len(raw)+block-1)//block)*block for raw in payloads.values())+2*block
  capacity.update({'codePayloadBytes':sum(map(len,payloads.values())),'codeAllocationEstimateBytes':allocated_estimate,'filesystemAllocationBlockBytes':block})
  assert free.f_bavail*block>=capacity['canonicalReserveBytes']+allocated_estimate,'CANONICAL_CODE_ONLY_WORKSPACE_CAPACITY_REFUSED'
  root.mkdir(mode=0o700);sync(root.parent);files={}
  for name,raw in payloads.items():
   target=root/name;fd=os.open(target,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o400)
   with os.fdopen(fd,'wb')as stream:stream.write(raw);stream.flush();os.fsync(stream.fileno())
   assert target.read_bytes()==raw;files[name]={'file':str(target),'sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}
  sync(root);free=os.statvfs(root);assert free.f_bavail*free.f_frsize>=capacity['canonicalReserveBytes'];capacity['actualFileAllocatedBytes']=sum((root/name).stat().st_blocks*512 for name in payloads);boundary(h);assert current_node()==node
  assert not h.interrupted and all(c['code']==0 and c['pipesClosed']and c['observationFault']is None for c in h.children)
  print(json.dumps({'format':'sabalan-source-a-stream-source-stage/v1','phase':PHASE,'operation':OPERATION,'runtimeSpecSha256':SPEC_SHA,'files':files,'image':IMAGE,'imageBytes':selected['Size'],'rootfsDiffIds':selected['RootFS']['Layers'],'capacity':capacity,'node':node,'children':h.children,'allOriginalChildrenClosed':True,'productionAdmission':False,'archiveCreated':False}),flush=True)
  return 0
 except BaseException as error:
  print(json.dumps({'format':'sabalan-source-a-stream-source-stage-negative/v1','failureType':type(error).__name__,'children':h.children,'productionAdmission':False}),flush=True);return 1
 finally:h.close()

def stream():
 h=k['NativeHost'](SPEC,SPEC_SHA);h.baseline=SPEC['expectedEight'];row=None
 try:
  h.acquire();boundary(h);node=current_node();selected,secret,capacity=parent_guard(h);root=pathlib.Path(REMOTE_ROOT)
  s=root.lstat();assert root.resolve(strict=True)==root and stat.S_ISDIR(s.st_mode)and s.st_uid==0 and not s.st_mode&0o077
  for name,raw in [('pipeline.cjs',pipeline_bytes(secret)),('stream-codec.cjs',STREAM_CODEC.encode())]:k['safe_read'](str(root/name),hashlib.sha256(raw).hexdigest(),maximum=SOURCE_WORKSPACE_BOUND)
  binary={};exec(compile(COLLECTOR,'fixed-source-a-binary-original','exec'),binary)
  row,err=binary['collect'](h,['/usr/bin/node',str(root/'pipeline.cjs')],sys.stdout.buffer,MAXIMUM_OUTPUT,stdin=sys.stdin.buffer)
  native=json.loads(err);assert native['format']=='sabalan-source-a-stream-native/v1'and native['mode']==PHASE and native['image']==IMAGE and native['recipientSpkiSha256']=='455e5a7ba5990866ca6992c0fd177fa0df5b22b5d3e985c41ee306e3a779b8af'
  result=native['result'];assert result['plainBytes']==COMPONENT['gzip']['bytes']and result['plainSha256']==COMPONENT['gzip']['sha256'];assert result['header']['version']==2 and [r['keyId']for r in result['header']['recipients']]==['local-rollback','independent-recovery']
  if PHASE=='encrypt-existing':assert row['stdoutBytes']==result['cipherBytes']and row['stdoutSha256']==result['cipherSha256']
  else:assert row['stdoutBytes']==0 and row['stdoutSha256']==hashlib.sha256(b'').hexdigest()
  if PHASE=='local-decrypt':assert result['gcmAuthenticated']is True and result['cipherBytes']==EXPECTED_CIPHER['bytes']and result['cipherSha256']==EXPECTED_CIPHER['sha256']
  boundary(h);assert current_node()==node
  assert not h.interrupted and all(c['code']==0 and c['pipesClosed']and c['observationFault']is None for c in h.children)
  proof={'format':'sabalan-source-a-closed-stream-phase/v1'if PHASE=='encrypt-existing'else'sabalan-source-a-closed-local-hash-phase/v1','phase':PHASE,'operation':OPERATION,'runtimeSpecSha256':SPEC_SHA,'image':IMAGE,'rootfsDiffIds':selected['RootFS']['Layers'],'native':native,'node':node,'capacity':capacity,'children':h.children,'allOriginalChildrenClosed':True,'productionAdmission':False,'healthyPointClaimed':False}
  if PHASE=='local-decrypt':proof.update(plaintextReturned=False,plaintextTransportBytes=0)
  print(json.dumps(proof),file=sys.stderr if PHASE=='encrypt-existing'else sys.stdout,flush=True);return 0
 except BaseException as error:
  print(json.dumps({'format':'sabalan-source-a-closed-stream-phase-negative/v1','phase':PHASE,'failureType':type(error).__name__,'children':h.children,'productionAdmission':False}),file=sys.stderr,flush=True);return 1
 finally:h.close()
