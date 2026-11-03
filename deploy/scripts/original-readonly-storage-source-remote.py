"""Production metadata/canonical plan, holding the existing Source FD9.
Only fixed read-only recovery metadata SQL is added. No old apply wrapper,
build, export, crypto, service action or database mutation is invoked.
"""


def storage_emit(value):
 raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();assert len(raw)<=2*1024**2
 assert sys.stdout.buffer.write(raw)==len(raw);sys.stdout.buffer.flush()


def storage_env(file):
 rows=pathlib.Path(file).read_text().splitlines();wanted=['DEPLOYMENT_BACKUP_HOST','DEPLOYMENT_BACKUP_USER','DEPLOYMENT_BACKUP_OPERATIONS_USER','DEPLOYMENT_BACKUP_SSH_KEY_FILE','DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE','DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE','DEPLOYMENT_REMOTE_MOUNT_HOST','DEPLOYMENT_REPORT_DIR_HOST'];result={}
 for key in wanted:
  found=[line.split('=',1)[1] for line in rows if line.startswith(key+'=')];assert len(found)==1 and found[0];result[key]=found[0]
 assert result['DEPLOYMENT_BACKUP_HOST']=='94.182.177.74' and result['DEPLOYMENT_BACKUP_USER']=='sabalan-backup' and result['DEPLOYMENT_BACKUP_OPERATIONS_USER']=='sabalan-backup-ops'
 for key in ['DEPLOYMENT_BACKUP_SSH_KEY_FILE','DEPLOYMENT_BACKUP_OPERATIONS_SSH_KEY_FILE','DEPLOYMENT_BACKUP_KNOWN_HOSTS_FILE']:
  file=pathlib.Path(result[key]);assert file.is_absolute() and file.resolve(strict=True)==file and file.is_file()
 return result


def source_recovery_readiness(host,samples):
 backend=next(row['id'] for row in SPEC['expectedEight'] if row['project']=='sabalanerp' and row['service']=='backend')
 value=json.loads(host.run(['docker','exec',backend,'node','--max-old-space-size=128','-e',RECOVERY_METADATA_PROBE],maximum=256*1024))
 assert value['transactionReadOnly'] is True and value['contentsReturned'] is False
 value['clear']=recovery_boundary_clear(value);samples.append(dict(observedAt=datetime.datetime.now(datetime.timezone.utc).isoformat(),metadata=value))
 assert value['clear'] is True,'SOURCE_SYSTEM_RECOVERY_NOT_QUIET'
 return value


def run_source_preflight():
 h=k['NativeHost'](SPEC,SPEC_SHA);h.baseline=SPEC['expectedEight'];safe=False;gate=None;failure=None;backup=False;stage='ACQUIRE';recovery_samples=[]
 original_run=h.run;h.readonly_original_pending=False
 def counted_run(*args,**kwargs):
  assert not h.readonly_original_pending
  before=len(h.children);h.readonly_original_pending=True
  try:return original_run(*args,**kwargs)
  finally:
   if len(h.children)==before+1:h.readonly_original_pending=False
 h.run=counted_run
 try:
  enter_source_working_directory();h.acquire();stage='CURRENT_BOUNDARY';boundary(h);node=current_node();head_before=h.git('application','rev-parse','HEAD').decode().strip()
  stage='CURRENT_SYSTEM_RECOVERY';source_recovery_readiness(h,recovery_samples)
  # Retain all existing independent operations/prerequisite checks; inspect
  # never starts SSH and performs no retention request.
  operations=pathlib.Path(CAPACITY).parents[1]
  stage='BACKUP_PREREQUISITES';prerequisite=json.loads(h.run(['/usr/bin/node','--max-old-space-size=128',str(operations/'deploy/scripts/backup-retention-host.mjs'),'--inspect','/opt/sabalanerp/deploy/.env.prod']))
  assert prerequisite=={'format':'sabalan-host-backup-retention-prerequisites/v1','inspected':True,'sshStarted':False,'mutation':False}
  stage='COMPOSE_MODEL';config=json.loads(h.run(['docker','compose','--env-file','/opt/sabalanerp/deploy/.env.prod','-f','/opt/sabalanerp/docker-compose.prod.yml','config','--format','json']))
  assert config['name']=='sabalanerp'
  stage='ENV_AND_MOUNT';env=storage_env('/opt/sabalanerp/deploy/.env.prod');remote=pathlib.Path(env['DEPLOYMENT_REMOTE_MOUNT_HOST']);assert remote.resolve(strict=True)==remote
  mount=h.run(['findmnt','--noheadings','--output','SOURCE','--target',str(remote)]).decode().strip();assert mount=='sabalan-backup@94.182.177.74:/checkpoints'
  stage='SOURCE_VOLUME_ROOTS';roots=[]
  for name in ['postgres_data','backend_storage_contracts','backend_storage_hr_hiring','backend_storage_accounting_contracts','backend_storage_support_tickets','backend_storage_performance_exports','backend_uploads','inquiry_data','recovery_coordination']:
   file=pathlib.Path(h.run(['docker','volume','inspect','sabalanerp_'+name,'--format','{{.Mountpoint}}']).decode().strip());assert file.is_absolute() and file.resolve(strict=True)==file;roots.append(str(file))
  k['safe_read'](CAPACITY,CAPACITY_SHA,maximum=1024**2)
  stage='CANONICAL_RESERVES';measured=h.run(['/usr/bin/node','--max-old-space-size=128',CAPACITY,'0',*roots]).decode().split();assert len(measured)==2 and all(value.isdigit() for value in measured)
  local_required,backup_reserve=map(int,measured);assert local_required>0 and backup_reserve>0
  stage='STORAGE_ROOTS';docker_root=pathlib.Path(h.run(['docker','info','--format','{{.DockerRootDir}}']).decode().strip());assert docker_root.resolve(strict=True)==docker_root
  recovery=pathlib.Path(h.run(['docker','volume','inspect','sabalanerp_backend_recovery','--format','{{.Mountpoint}}']).decode().strip());coordination=pathlib.Path(h.run(['docker','volume','inspect','sabalanerp_recovery_coordination','--format','{{.Mountpoint}}']).decode().strip())
  args=['--mode','plan','--project','sabalanerp','--lock-file','/opt/sabalanerp/.deploy-state/deployment.lock','--lock-fd','9','--storage-root',str(docker_root),'--required-bytes',str(local_required),'--checkpoint-root',str(recovery/'packages'),'--checkpoint-root',str(remote),'--journal-root',env['DEPLOYMENT_REPORT_DIR_HOST'],'--document',str(coordination/'deployment-checkpoint.json'),'--document',str(coordination/'pending-restore.json'),'--document',str(pathlib.Path(env['DEPLOYMENT_REPORT_DIR_HOST'])/'active-deployment-session.json'),'--audit',str(pathlib.Path(env['DEPLOYMENT_REPORT_DIR_HOST'])/'storage-cleanup-local.jsonl')]
  for image in sorted(set(row['image'] for row in SPEC['expectedEight'])):args+=['--protected-image',image]
  code=canonical_plan_code(CANONICAL,args)
  stage='CANONICAL_PLAN';gate=json.loads(h.run(['/usr/bin/node','--max-old-space-size=128','--input-type=module','-e',code],maximum=2*1024**2));assert gate['mode']=='plan' and gate['removed']==[] and gate['project']=='sabalanerp' and gate['requiredBytes']==local_required
  boundary(h);assert current_node()==node
  stage='SYSTEM_RECOVERY_BEFORE_BACKUP';source_recovery_readiness(h,recovery_samples)
  storage_emit(dict(format='sabalan-source-readonly-storage-held/v1',operation=STORAGE_OPERATION,runtimeSpecSha256=SPEC_SHA,source=gate,backupCanonicalReserveBytes=backup_reserve,productionCommitBefore=head_before,sourceLockHeld=True,recoveryReadiness=recovery_samples,storagePolicyChanged=False,productionAdmission=False))
  stage='BACKUP_ACK';raw=sys.stdin.buffer.readline(65537);assert raw.endswith(b'\n') and len(raw)<=65536
  ack=json.loads(raw);assert set(ack)=={'format','operation','backupSucceeded','backupOriginalClosed','backupResultSha256'}
  assert ack['format']=='sabalan-readonly-storage-backup-ack/v1' and ack['operation']==STORAGE_OPERATION and type(ack['backupSucceeded']) is bool and ack['backupOriginalClosed'] is True
  assert isinstance(ack['backupResultSha256'],str) and len(ack['backupResultSha256'])==64
  backup=ack['backupSucceeded'];assert sys.stdin.buffer.read(1)==b''
  boundary(h);assert current_node()==node;head_after=h.git('application','rev-parse','HEAD').decode().strip();assert head_after==head_before
  stage='SYSTEM_RECOVERY_AFTER_BACKUP';source_recovery_readiness(h,recovery_samples)
 except BaseException as error:failure=type(error).__name__
 finally:
  safe=source_originals_known_closed(h)
  summary=[dict(pid=row.get('pid'),code=row.get('code'),pipesClosed=row.get('pipesClosed'),observationFault=row.get('observationFault'),stdoutSha256=row.get('stdoutSha256'),stderrSha256=row.get('stderrSha256')) for row in h.children]
  if not safe:
   try:storage_emit(dict(format='sabalan-source-readonly-storage-held-unknown/v1',operation=STORAGE_OPERATION,originalCustodyKnown=False,failureStage=stage,failureType=failure,originalClosureSummary=summary,originalRunPending=h.readonly_original_pending,productionAdmission=False))
   finally:retain_unknown_source_owner()
   raise AssertionError('UNKNOWN_SOURCE_RETAINER_RETURNED')
  storage_emit(dict(format='sabalan-source-readonly-storage-closed/v1',operation=STORAGE_OPERATION,runtimeSpecSha256=SPEC_SHA,preflightSucceeded=failure is None and gate is not None and gate['ok'] is True and backup,source=gate,productionCommitBefore=locals().get('head_before'),productionCommitAfter=locals().get('head_after'),originalChildren=h.children,allOriginalChildrenClosed=True,storagePolicyChanged=False,deletionApplied=False,recoveryReadiness=recovery_samples,failureStage=stage if failure else None,failureType=failure,productionAdmission=False))
  h.close()
 return 0


def source_originals_known_closed(host):
 # Work success and original closure are separate. NativeHost.run records the
 # SAME communicate()/wait result; its nonzero exit still raises into failure.
 # Signals, observation faults or an unaccounted allocation remain unknown.
 if host.interrupted or host.readonly_original_pending:return False
 return all(type(row.get('pid'))is int and row['pid']>0 and type(row.get('code'))is int and 0<=row['code']<=255 and row.get('pipesClosed')is True and row.get('observationFault')is None and all(isinstance(row.get(key),str) and len(row[key])==64 for key in ['stdoutSha256','stderrSha256']) for row in host.children)


def retain_unknown_source_owner():
 import time
 while True:
  try:time.sleep(30)
  except BaseException:pass


def enter_source_working_directory():
 # Canonical backup-retention-host --inspect requires this exact cwd in
 # addition to its inherited genuine FD9. SSH's login cwd is not that contract.
 root=pathlib.Path('/opt/sabalanerp');assert root.resolve(strict=True)==root and root.is_dir()
 os.chdir(root);assert pathlib.Path.cwd()==root
