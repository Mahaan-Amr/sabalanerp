"""Exact C16 negative-only recovery predicates; never grants qualification."""
import ast,base64,hashlib,json,math,os,pathlib,re,stat,sys,tarfile
CONTEXT_SHA='d174122c8a6a8d64bb6e1f3db529dba17a8d9a9221b411c3f3b9fa6acedebc9c'
def sha(raw): return hashlib.sha256(raw).hexdigest()
def context(raw):
 assert sha(raw)==CONTEXT_SHA,'CURRENT_CONTEXT_CHANGED'
 value=json.loads(raw);validate_namespace_context(value);return value
def exact(a,b):
 if type(a)is not type(b):return False
 if isinstance(a,dict):return a.keys()==b.keys()and all(exact(a[k],b[k])for k in a)
 if isinstance(a,list):return len(a)==len(b)and all(exact(x,y)for x,y in zip(a,b))
 return a==b
def same(a,b,message): assert exact(a,b),message

def validate_services(ctx,services,stopped=(),fresh=None):
 same(len(services),10,'EXACT_TEN_SERVICES_REQUIRED');by={v['service']:v for v in services};same(len(by),10,'DUPLICATE_SERVICE')
 for expected in ctx['protectedEight']:
  same(by[expected['service']],expected,'PROTECTED_SERVICE_CHANGED')
 for expected in ctx['targets']:
  row=by[expected['service']]
  if fresh is None:
   for key in ['id','image','startedAt','configurationSha256']:same(row[key],expected[key],'QA_IDENTITY_CHANGED:'+key)
   if expected['service']in stopped:
    same(row['running'],False,'TARGET_STILL_RUNNING');same(row['pid'],0,'TARGET_PID_NOT_ZERO');same(row['status'],'exited','TARGET_NOT_EXITED')
    assert row['ips'] in (expected['ips'],['']*len(expected['ips'])),'UNKNOWN_STOP_NETWORK_TRANSITION'
   else:same(row,expected,'LIVE_TARGET_CHANGED')
  else:
   assert row['id']!=expected['id'] and row['startedAt']!=expected['startedAt'],'FRESH_PHYSICAL_INCARNATION_REQUIRED'
   same(row['image'],expected['image'],'IMMUTABLE_IMAGE_CHANGED');same(row['running'],True,'FRESH_NOT_RUNNING');same(row['health'],'healthy','FRESH_NOT_HEALTHY')
   same(row['configurationSha256'],fresh[expected['service']]['configurationSha256'],'FRESH_CONFIG_CHANGED')
 return by

def validate_sql(ctx,value,after_stops=False,fresh=False):
 same(set(value),{'visible','systemIdentifier','databases','sessions','prepared'},'SQL_SHAPE_UNKNOWN')
 same(value['visible'],True,'SQL_VISIBILITY_UNKNOWN');same(str(value['systemIdentifier']),ctx['sqlScopes']['systemIdentifier'],'SQL_SYSTEM_CHANGED')
 wanted={v['name']:v['oid']for k,v in ctx['sqlScopes'].items()if isinstance(v,dict)and 'name'in v}
 same({v['name']:str(v['oid'])for v in value['databases']},wanted,'SQL_DATABASE_IDENTITY_CHANGED');same(value['prepared'],[],'PREPARED_TRANSACTIONS_EXIST')
 target_ips={ip for v in ctx['targets']for ip in v['ips']};names=set(ctx['sqlScopes']['nativeRuntimeNamespaces'])|{ctx['sqlScopes']['catalogApplicationName']};seen=set()
 for row in value['sessions']:
  same(set(row),{'pid','database','client','application','state','transactionOpen','backendXid','queryMd5'},'SQL_SESSION_SHAPE_UNKNOWN')
  assert row['client']in target_ips,'FOREIGN_SQL_IN_TEST_SCOPE';same(row['state'],'idle','SQL_NOT_IDLE');same(row['transactionOpen'],False,'SQL_TRANSACTION_OPEN');same(row['backendXid'],False,'SQL_BACKEND_XID')
  if row['database']=='sabalanerp' and row['application']=='sabalanerp-online-candidate':
   same(row['queryMd5'],hashlib.md5(b'SELECT 1').hexdigest(),'UNKNOWN_BASELINE_HEALTH_QUERY');assert row['client']not in seen,'DUPLICATE_HEALTH_POOL';seen.add(row['client'])
  else:
   assert not after_stops and not fresh,'SCOPED_SQL_NOT_ZERO';assert row['database']in wanted and row['application']in names,'UNKNOWN_NATIVE_SQL_SESSION'
 if after_stops:same(value['sessions'],[],'POST_STOP_SQL_NOT_ZERO')
 return value

def validate_child(row,allowed=(0,)):
 assert type(row['originalPid'])is int and row['originalPid']>0,'ORIGINAL_CHILD_UNKNOWN'
 assert type(row['code'])is int and row['code']in allowed and row['signal']is None,'ORIGINAL_CHILD_FAILED'
 assert row['stdoutEof']is True and row['stderrEof']is True and row['interrupted']is False,'ORIGINAL_CHILD_NOT_CLOSED'
 return row

def validate_stopped_full(before,after,stopped):
 old={v['Config']['Labels']['com.docker.compose.service']:v for v in before}
 for current in after:
  role=current['Config']['Labels']['com.docker.compose.service']
  if role not in stopped:continue
  expected=old[role]
  for key in ('Id','Image','Config','HostConfig','Mounts'):same(current[key],expected[key],'STOP_CHANGED_CONTAINER_CONFIGURATION')
  state=current['State'];same(state['StartedAt'],expected['State']['StartedAt'],'STOP_BIRTH_CHANGED');same(state['Running'],False,'STOP_RUNNING');same(state['Pid'],0,'STOP_PID');same(state['Status'],'exited','STOP_STATUS')
  same(state['OOMKilled'],False,'STOP_OOM');same(state['Dead'],False,'STOP_DEAD');same(state['Error'],'','STOP_ERROR');assert state['ExitCode']in (0,143),'STOP_UNCLEAN_EXIT'
  networks=current['NetworkSettings']['Networks'];prior=expected['NetworkSettings']['Networks'];same(set(networks),set(prior),'STOP_NETWORK_MEMBERSHIP_CHANGED')
  for name,row in networks.items():
   same(row['NetworkID'],prior[name]['NetworkID'],'STOP_NETWORK_ID_CHANGED');assert row['IPAddress']in ('',prior[name]['IPAddress']),'STOP_UNKNOWN_NETWORK_ADDRESS'

def validate_empty_native(value):
 same(value,{'originalNativeProcesses':0,'denyUnknownGrantRecordsChecked':0,'unusedGrantRecords':0,'negativelyCancelledGrantRecords':0,'adoptsOriginalPopen':False},'FRESH_NAMESPACE_NOT_TRULY_EMPTY')
 return value

def validate_namespace_context(ctx):
 derivation=ctx['nativeNamespaceDerivation'];same(set(derivation),{'format','algorithm','indexRef','sourceRefs','proofRef'},'NAMESPACE_DERIVATION_SCHEMA');same(derivation['format'],'sabalan-c16-pinned-grant-sql-namespace/v1','NAMESPACE_DERIVATION_FORMAT');same(derivation['algorithm'],'sabalan-rt-plus-sha256-utf8-runtimeId-first48','NAMESPACE_DERIVATION_ALGORITHM');same(derivation['indexRef'],ctx['indexRef'],'NAMESPACE_DERIVATION_INDEX_JOIN')
 scopes=ctx['grantScopes'];assert isinstance(scopes,list)and scopes,'PINNED_GRANT_SCOPES_MISSING';ids=[v['runtimeId']for v in scopes];assert all(isinstance(v,str)and re.fullmatch('[a-f0-9]{64}',v)for v in ids)and len(set(ids))==len(ids),'GRANT_RUNTIME_ID_UNKNOWN'
 expected=['sabalan-rt-'+hashlib.sha256(v.encode('utf-8')).hexdigest()[:48]for v in ids];same(ctx['sqlScopes']['nativeRuntimeNamespaces'],expected,'PINNED_GRANT_NAMESPACE_DERIVATION_CHANGED')
 same(len(derivation['sourceRefs']),1,'NAMESPACE_DERIVATION_SOURCE_COUNT');assert derivation['sourceRefs'][0]['file'].replace('\\','/').endswith('/tests/online-deployment/application-native.fixture.py'),'NAMESPACE_CANONICAL_SOURCE_CLASS'
 return expected

def validate_index_scopes(ctx,index):
 observed={}
 def visit(value):
  if isinstance(value,dict):
   scope=value.get('scope')
   if isinstance(scope,dict)and'runtimeId'in scope:
    projection={k:scope.get(k)for k in ('runtimeId','purpose','nativeDirectory','boundaryDirectory','database','manifestSha256','image','container')};runtime=scope['runtimeId']
    if runtime in observed:same(observed[runtime],projection,'INDEX_DUPLICATE_GRANT_SCOPE_CHANGED')
    observed[runtime]=projection
   for child in value.values():visit(child)
  elif isinstance(value,list):
   for child in value:visit(child)
 visit(index);same({v['runtimeId']:v for v in ctx['grantScopes']},observed,'PINNED_INDEX_GRANT_SCOPE_JOIN');validate_namespace_context(ctx);return observed

def validate_namespace_source(raw):
 tree=ast.parse(raw.decode('utf-8'));expected=ast.dump(ast.parse("namespace='sabalan-rt-'+hashlib.sha256(runtime_id.encode()).hexdigest()[:48]").body[0].value,include_attributes=False)
 matches=[v for v in ast.walk(tree)if isinstance(v,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='namespace'for t in v.targets)and ast.dump(v.value,include_attributes=False)==expected];same(len(matches),2,'CANONICAL_NAMESPACE_DERIVATION_SOURCE_CHANGED')

def validate_original_negative_closed(ctx,start,closed):
 same(start['originalPid'],ctx['master']['pid'],'WRONG_ORIGINAL_MASTER');same(start['planSha256'],ctx['originalSupervisor']['plan']['sha256'],'WRONG_ORIGINAL_PLAN')
 same(closed['format'],'sabalan-external-original-master-closed/v1','WRONG_ORIGINAL_CLOSURE_FORMAT');same(closed['originalPid'],ctx['master']['pid'],'WRONG_CLOSED_MASTER');same(closed['code'],125,'NEGATIVE_EXIT_REQUIRED');same(closed['pipesClosed'],True,'ORIGINAL_MASTER_PIPES_OPEN');same(closed['readerErrors'],[],'ORIGINAL_READER_FAILURE')
 for stream in ['stdout','stderr']:same(closed['logs'][stream]['closed'],True,'ORIGINAL_LOG_OPEN');same(closed['logs'][stream]['truncated'],False,'ORIGINAL_LOG_TRUNCATED')
 return closed

def validate_fresh_config(old,new,nonce,old_nonce):
 assert re.fullmatch('[a-f0-9]{32}',nonce)and nonce!=old_nonce,'NEW_AUTHORITY_NONCE_REQUIRED'
 def normalize(v):
  if isinstance(v,dict):return {k:normalize(x)for k,x in v.items()}
  if isinstance(v,list):return [normalize(x)for x in v]
  if isinstance(v,str)and v=='cohort-'+nonce:return 'cohort-'+old_nonce
  return v
 stripped=json.loads(json.dumps(new));acceptance=0
 for role in ['backend-candidate','backend-retained']:
  for mount in stripped['services'][role]['volumes']:
   if mount.get('target')=='/app/online-runtime-acceptance':
    same(mount.get('type'),'volume','ACCEPTANCE_NOT_NAMED_VOLUME');same(mount['source'],next(x['source']for x in old['services'][role]['volumes']if x.get('target')==mount['target']),'ACCEPTANCE_VOLUME_CHANGED')
    same(mount.get('volume',{}),{'nocopy':True,'subpath':'c16-recovery-'+nonce},'ACCEPTANCE_SUBPATH_CHANGED');original=next(x for x in old['services'][role]['volumes']if x.get('target')==mount['target']);mount.clear();mount.update(json.loads(json.dumps(original)))
    acceptance+=1
 same(acceptance,2,'EXACT_TWO_ACCEPTANCE_MOUNTS_REQUIRED')
 same(normalize(stripped),old,'UNRELATED_COMPOSE_CONFIGURATION_CHANGED')
 changed=0
 for role in ['backend-candidate','backend-retained']:
  a=old['services'][role];b=new['services'][role]
  for av,bv in zip(a['volumes'],b['volumes']):
   if av.get('volume',{}).get('subpath')=='cohort-'+old_nonce:same(bv['volume']['subpath'],'cohort-'+nonce,'AUTHORITY_SUBPATH_NOT_ROTATED');changed+=1
 same(changed,4,'EXACT_FOUR_AUTHORITY_MOUNTS_REQUIRED')
 return new

# Exact reviewed pure namespace/material helper 32f7a4aa... follows.
"""Pure C16 installed-byte and empty-namespace predicates. No runtime I/O."""
import hashlib,json,re

ROLES=('backend-candidate','backend-retained')
VOLUMES={'runtime':'sabalanerp-local_online_runtime_authority','jobs':'sabalanerp-local_online_runtime_jobs_authority'}
MOUNTS={ROLES[0]:(('/app/runtime-authority','runtime',True,True),('/run/sabalan-online','jobs',False,True),('/app/qualification-authority-root','runtime',True,False)),ROLES[1]:(('/run/sabalan-online','runtime',False,True),('/app/jobs-authority','jobs',True,True),('/app/qualification-jobs-root','jobs',True,False))}
NAMESPACE_FIELDS={'st_dev','st_ino','st_uid','st_gid','st_mode','st_nlink','st_size','st_mtime_ns','st_ctime_ns'}
ACCEPTANCE_VOLUME='sabalanerp-local_online_runtime_acceptance'
ACCEPTANCE_TARGET='/app/online-runtime-acceptance'

def equal(a,b):
 # Python otherwise treats True==1 and False==0. The source predicates use
 # JavaScript strict equality, including for nested negative/admission flags.
 if type(a)is bool or type(b)is bool:return type(a)is type(b)and a is b
 if a is None or b is None:return a is b
 if isinstance(a,dict)or isinstance(b,dict):return type(a)is dict and type(b)is dict and a.keys()==b.keys()and all(equal(a[k],b[k])for k in a)
 if isinstance(a,list)or isinstance(b,list):return type(a)is list and type(b)is list and len(a)==len(b)and all(equal(x,y)for x,y in zip(a,b))
 if type(a)in(int,float)and type(b)in(int,float):return a==b
 return type(a)is type(b)and a==b
def same(a,b,message):
 assert equal(a,b),message
def digest(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return json.dumps(value,ensure_ascii=False,separators=(',',':')).encode('utf-8')
def one(rows,predicate,message):
 found=[v for v in rows if predicate(v)];same(len(found),1,message);return found[0]
def nonce(value):assert isinstance(value,str)and re.fullmatch('[a-f0-9]{32}',value),'COHORT_NONCE_INVALID';return value

def namespace_identity(value):
 same(set(value),NAMESPACE_FIELDS,'NAMESPACE_IDENTITY_SCHEMA')
 for v in value.values():assert isinstance(v,str)and re.fullmatch('(?:0|[1-9][0-9]{0,19})',v),'NAMESPACE_LOSSY_IDENTITY'
 same(value['st_uid'],'0','NAMESPACE_OWNER');same(value['st_mode'],str(0o40700),'NAMESPACE_MODE');return value

def native_material(material):
 def inventory(prefix):
  entries=[{'bytes':v['bytes'],'path':v['path'][len(prefix):],'sha256':v['sha256']}for v in material['files']if v['path'].startswith(prefix)]
  entries.sort(key=lambda v:v['path'].encode('utf-16-be','surrogatepass'))
  assert entries and len({v['path']for v in entries})==len(entries),'MATERIAL_INVENTORY_MISSING_OR_DUPLICATE'
  for v in entries:
   assert type(v['bytes'])is int and 0<=v['bytes']<=9007199254740991,'MATERIAL_BYTES_INVALID'
   assert isinstance(v['path'],str)and v['path']and not v['path'].startswith('/')and '\\'not in v['path']and all(p not in ('','.','..')for p in v['path'].split('/')),'MATERIAL_PATH_INVALID'
   assert isinstance(v['sha256'],str)and re.fullmatch('[a-f0-9]{64}',v['sha256']),'MATERIAL_HASH_INVALID'
  return {'sha256':digest(encoded(entries)),'entries':entries}
 dist=inventory('app/dist/');client=inventory('app/node_modules/@prisma/client/')
 entry=one(material['files'],lambda v:v['path']=='app/dist/onlinePrivateQualification.js','MATERIAL_ENTRY_INVALID')
 assert re.fullmatch('[a-f0-9]{64}',material['schemaSha256']),'MATERIAL_SCHEMA_HASH'
 return {'dist':dist,'client':client,'entry':entry,'runtime':{'entryPath':'/app/dist/onlinePrivateQualification.js','entrySha256':entry['sha256'],'distTreeSha256':dist['sha256'],'schemaSha256':material['schemaSha256'],'clientInventorySha256':client['sha256']}}

def validate_installed(result,material):
 expected=native_material(material)
 same(set(result),{'format','entryPath','entrySha256','schemaSha256','dist','client','models','tools','entryExportPresent','applicationStarted','databaseConnected','productionAdmission'},'INSTALLED_SCHEMA')
 same(result['format'],'sabalan-actual-installed-native-image/v1','INSTALLED_FORMAT')
 for key in ('entryPath','entrySha256','schemaSha256'):same(result[key],expected['runtime'][key],'INSTALLED_RUNTIME_BYTES:'+key)
 for key,root in (('dist','/app/dist'),('client','/app/node_modules/@prisma/client')):
  v=result[key];same(set(v),{'relativeTo','algorithm','sha256','files','bytes','entries'},'INSTALLED_INVENTORY_SCHEMA')
  same(v['relativeTo'],root,'INSTALLED_TREE_ROOT');same(v['algorithm'],'sha256-json-array-bytes-path-sha256-codepoint-noLF/v1','INSTALLED_TREE_ALGORITHM')
  same(v['entries'],expected[key]['entries'],'INSTALLED_TREE_ENTRIES');same(v['sha256'],expected[key]['sha256'],'INSTALLED_TREE_HASH');same(v['files'],len(v['entries']),'INSTALLED_FILE_COUNT');same(v['bytes'],sum(x['bytes']for x in v['entries']),'INSTALLED_BYTE_COUNT')
 same(result['entryExportPresent'],True,'INSTALLED_ENTRY_EXPORT');same(result['applicationStarted'],False,'INSTALLED_STARTED_APPLICATION');same(result['databaseConnected'],False,'INSTALLED_CONNECTED_DATABASE');same(result['productionAdmission'],False,'INSTALLED_ADMISSION')
 assert type(result['models'])is int and result['models']>0,'INSTALLED_MODELS'
 same(set(result['tools']),{'python','psql','chromium'},'INSTALLED_TOOLS')
 for v in result['tools'].values():
  same(set(v),{'originalPid','code','signal','version'},'INSTALLED_TOOL_SCHEMA');assert type(v['originalPid'])is int and v['originalPid']>0,'INSTALLED_TOOL_PID';same(v['code'],0,'INSTALLED_TOOL_CODE');same(v['signal'],None,'INSTALLED_TOOL_SIGNAL');assert isinstance(v['version'],str)and 0<len(v['version'])<=4096,'INSTALLED_TOOL_VERSION'
 return expected

def validate_image_inspection(images,receipts):
 same(len(images),len(receipts),'IMAGE_INSPECTION_COUNT');same(len({v['Id']for v in images}),len(images),'IMAGE_INSPECTION_DUPLICATE')
 for receipt in receipts:
  v=one(images,lambda v:v['Id']==receipt['image']['id'],'IMAGE_INSPECTION_ID');same(v['RootFS']['Layers'],receipt['image']['layers'],'IMAGE_IMMUTABLE_LAYERS')

def validate_authority_configuration(configuration,cohort_nonce):
 leaf='cohort-'+nonce(cohort_nonce);same(configuration['name'],'sabalanerp-local','AUTHORITY_PROJECT')
 for role,mounts in MOUNTS.items():
  for target,kind,rw,subpath in mounts:
   v=one(configuration['services'][role]['volumes'],lambda v:v['target']==target,'AUTHORITY_CONFIG_MOUNT')
   same(v['type'],'volume','AUTHORITY_CONFIG_TYPE');same(configuration['volumes'][v['source']]['name'],VOLUMES[kind],'AUTHORITY_CONFIG_VOLUME');same(not v.get('read_only',False),rw,'AUTHORITY_CONFIG_RW');same(v.get('volume',{}).get('nocopy'),True,'AUTHORITY_CONFIG_NOCOPY');same(v.get('volume',{}).get('subpath',''),leaf if subpath else '','AUTHORITY_CONFIG_SUBPATH')

def validate_authority_slots(containers,cohort_nonce):
 leaf='cohort-'+nonce(cohort_nonce)
 for role,mounts in MOUNTS.items():
  c=containers[role];same(c['Config']['Labels']['com.docker.compose.project'],'sabalanerp-local','AUTHORITY_ENGINE_PROJECT');same(c['Config']['Labels']['com.docker.compose.service'],role,'AUTHORITY_ENGINE_ROLE')
  for target,kind,rw,subpath in mounts:
   a=one(c['Mounts'],lambda v:v['Destination']==target,'AUTHORITY_VISIBLE_MOUNT');b=one(c['HostConfig'].get('Mounts',[]),lambda v:v['Target']==target,'AUTHORITY_EXPLICIT_ENGINE_MOUNT')
   same(a['Type'],'volume','AUTHORITY_ENGINE_TYPE');same(a['Name'],VOLUMES[kind],'AUTHORITY_ENGINE_VOLUME');same(a['RW'],rw,'AUTHORITY_ENGINE_RW');same(b['Type'],'volume','AUTHORITY_REQUEST_TYPE');same(b['Source'],VOLUMES[kind],'AUTHORITY_REQUEST_VOLUME');same(not b.get('ReadOnly',False),rw,'AUTHORITY_REQUEST_RW');same(b.get('VolumeOptions',{}).get('NoCopy'),True,'AUTHORITY_REQUEST_NOCOPY');same(b.get('VolumeOptions',{}).get('Subpath',''),leaf if subpath else '','AUTHORITY_REQUEST_SUBPATH')
  forbidden=VOLUMES['jobs'if role==ROLES[0]else'runtime'];assert not any(v.get('Name')==forbidden and v.get('RW')for v in c['Mounts']),'PEER_AUTHORITY_WRITABLE'
 for writer,producer,reader in ((ROLES[0],'/app/runtime-authority',ROLES[1]),(ROLES[1],'/app/jobs-authority',ROLES[0])):
  same(one(containers[writer]['Mounts'],lambda v:v['Destination']==producer,'AUTHORITY_WRITER')['Source'],one(containers[reader]['Mounts'],lambda v:v['Destination']=='/run/sabalan-online','AUTHORITY_READER')['Source'],'AUTHORITY_PEER_PHYSICAL_NAMESPACE')

def validate_authority_results(prepared,verified,cohort_nonce):
 nonce(cohort_nonce);identities={}
 for role in ROLES:
  kind='runtime'if role==ROLES[0]else'jobs';a,b=prepared[role],verified[role]
  for value,mode in ((a,'create'),(b,'verify')):
   same(set(value),{'format','mode','nonce','kind','namespace','consumerNamespace','exclusivelyCreated','empty','productionAdmission'},'AUTHORITY_RESULT_SCHEMA');same(value['format'],'sabalan-authority-cohort-directory/v1','AUTHORITY_RESULT_FORMAT');same(value['mode'],mode,'AUTHORITY_RESULT_MODE');same(value['nonce'],cohort_nonce,'AUTHORITY_RESULT_NONCE');same(value['kind'],kind,'AUTHORITY_RESULT_KIND');same(value['empty'],True,'AUTHORITY_NOT_EMPTY');same(value['productionAdmission'],False,'AUTHORITY_RESULT_ADMISSION');same(value['exclusivelyCreated'],mode=='create','AUTHORITY_RESULT_EXCLUSIVE');namespace_identity(value['namespace'])
  same(a['consumerNamespace'],None,'AUTHORITY_CREATE_PEER_CLAIM');same(a['namespace'],b['namespace'],'AUTHORITY_IDENTITY_CHANGED');identities[role]=a['namespace']
 for role in ROLES:same(verified[role]['consumerNamespace'],identities[ROLES[1]if role==ROLES[0]else ROLES[0]],'AUTHORITY_PEER_NAMESPACE_CHANGED')
 return identities

def validate_acceptance_configuration(configuration,cohort_nonce):
 leaf='c16-recovery-'+nonce(cohort_nonce);same(configuration['name'],'sabalanerp-local','ACCEPTANCE_PROJECT')
 for role in ROLES:
  v=one(configuration['services'][role]['volumes'],lambda v:v['target']==ACCEPTANCE_TARGET,'ACCEPTANCE_CONFIG_MOUNT');same(v['type'],'volume','ACCEPTANCE_CONFIG_TYPE');same(configuration['volumes'][v['source']]['name'],ACCEPTANCE_VOLUME,'ACCEPTANCE_CONFIG_VOLUME');same(v.get('read_only',False),False,'ACCEPTANCE_CONFIG_RW');same(v.get('volume',{}),{'nocopy':True,'subpath':leaf},'ACCEPTANCE_CONFIG_OPTIONS')

def validate_acceptance_slots(containers,cohort_nonce):
 leaf='c16-recovery-'+nonce(cohort_nonce);sources=[]
 for role in ROLES:
  c=containers[role];a=one(c['Mounts'],lambda v:v['Destination']==ACCEPTANCE_TARGET,'ACCEPTANCE_VISIBLE_MOUNT');b=one(c['HostConfig'].get('Mounts',[]),lambda v:v['Target']==ACCEPTANCE_TARGET,'ACCEPTANCE_ENGINE_MOUNT')
  same(a['Type'],'volume','ACCEPTANCE_ENGINE_TYPE');same(a['Name'],ACCEPTANCE_VOLUME,'ACCEPTANCE_ENGINE_VOLUME');same(a['RW'],True,'ACCEPTANCE_ENGINE_RW');same(b['Type'],'volume','ACCEPTANCE_REQUEST_TYPE');same(b['Source'],ACCEPTANCE_VOLUME,'ACCEPTANCE_REQUEST_VOLUME');same(b.get('ReadOnly',False),False,'ACCEPTANCE_REQUEST_RW');same(b.get('VolumeOptions',{}).get('NoCopy'),True,'ACCEPTANCE_REQUEST_NOCOPY');same(b.get('VolumeOptions',{}).get('Subpath'),leaf,'ACCEPTANCE_REQUEST_SUBPATH');sources.append(a['Source'])
 same(sources[0],sources[1],'ACCEPTANCE_PHYSICAL_VIEW_CHANGED')

def validate_acceptance_results(created,verified,cohort_nonce):
 nonce(cohort_nonce)
 for value,mode in [(created,'create')]+[(verified[role],'verify')for role in ROLES]:
  same(set(value),{'format','mode','nonce','namespace','empty','exclusivelyCreated','productionAdmission'},'ACCEPTANCE_RESULT_SCHEMA');same(value['format'],'sabalan-c16-empty-acceptance-namespace/v1','ACCEPTANCE_RESULT_FORMAT');same(value['mode'],mode,'ACCEPTANCE_RESULT_MODE');same(value['nonce'],cohort_nonce,'ACCEPTANCE_RESULT_NONCE');namespace_identity(value['namespace']);same(value['empty'],True,'ACCEPTANCE_NOT_EMPTY');same(value['exclusivelyCreated'],mode=='create','ACCEPTANCE_EXCLUSIVE_CREATE');same(value['productionAdmission'],False,'ACCEPTANCE_ADMISSION');same(value['namespace'],created['namespace'],'ACCEPTANCE_NAMESPACE_CHANGED')
 return created['namespace']

# All functions below are pure validation / bounded read-only file operations.
# No Docker, SQL, SSH, subprocess, native control or mutable source import.
FORMATS={'handoff':'sabalan-c16-negative-recovery-handoff/v1','cancellation':'sabalan-c16-negative-cancellation/v1','baseline':'sabalan-c16-fresh-unqualified-physical-baseline/v1','restoration':'sabalan-c16-external-negative-dev-restoration/v1'}
SHAPES={
 'handoff':'format cancellationRef baselineRef restorationRef contextRef sourcePins qualificationSucceeded productionAdmission',
 'cancellation':'format sourceCommit operationRoot contextRef historicalCandidateReplacement oldTargets protectedEight indexRef evidenceRefs originalChildrenRef classification qualificationSucceeded productionAdmission successfulNativeClosure nativeReapedClaimed adoptsOriginalPopen',
 'baseline':'format contextRef cancellationRef historicalCandidateReplacement oldTargets protectedEight authorityCohort acceptance freshServices freshConfigurations evidenceRefs originalChildrenRef sourceCommit qualificationSucceeded productionAdmission adoptsOriginalPopen',
 'restoration':'format contextRef cancellationRef baselineRef stopRef pendingRef bindingRef originalOwnerSourceRef originalVerifierSourceRef externalRestorerSourceRef evidenceRefs originalChildrenRef sameFrontendId sameFrontendConfig sameFrontendImage restoredFrontend protectedOtherNine pendingSettled nativeCompletionClaimed qualificationSucceeded productionAdmission'}
EVIDENCE={
 'cancellation':'initialInspection oldOperationInventory stopCandidate stopRetained postStopInspection postStopSql windowsControl supervisorPlan originalStart originalClosed',
 'baseline':'freshComposeConfigBefore freshComposeConfigAfter freshUp freshInspection installedCandidate installedRetained imageInspection freshNativeQuietCandidate freshNativeQuietRetained freshSql',
 'restoration':'frontendBefore startFrontend frontendAfter restorationSql originalClosed'}
CHILD_FIELDS=set('format argv originalPid code signal stdoutEof stderrEof interrupted inputSha256 inputBase64 stdoutBase64 stderrBase64 stdoutSha256 stderrSha256'.split())
def shape(value,keys,message):same(set(value),set(keys.split())if isinstance(keys,str)else set(keys),message)
def normalize_path(file):
 p=pathlib.Path(file);assert p.is_absolute(),'ABSOLUTE_INPUT_REQUIRED';return str(p.resolve(strict=False))
class Reader:
 def __init__(self):self.inputs={};self.streaming={};self.archived={};self.cache={}
 def raw(self,reference,maximum=32*1024**2):
  shape(reference,'file sha256','REF_SHAPE');assert re.fullmatch('[a-f0-9]{64}',reference['sha256']),'REF_HASH'
  selected=self.archived.get((normalize_path(reference['file']),reference['sha256']),reference);p=pathlib.Path(selected['file']);assert p.is_absolute()and p.resolve(strict=True)==p and not p.is_symlink(),'ALIASED_INPUT'
  a=p.lstat();assert stat.S_ISREG(a.st_mode)and a.st_nlink==1 and a.st_size<=maximum,'INPUT_BOUND_OR_LINK'
  fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
  with os.fdopen(fd,'rb')as stream:d=os.fstat(stream.fileno());raw=stream.read(maximum+1);b=os.fstat(stream.fileno())
  c=p.lstat();identity=lambda s:(s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink)
  cross=lambda s:(s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink)
  same(identity(d),identity(b),'INPUT_FD_CHANGED');same(cross(a),cross(b),'INPUT_NAMED_FD_CHANGED');same(identity(a),identity(c),'INPUT_NAMED_CHANGED');same(a.st_dev,c.st_dev,'INPUT_DEVICE_CHANGED')
  if os.name!='nt':same(a.st_ctime_ns,b.st_ctime_ns,'INPUT_CTIME_CHANGED')
  assert os.name=='nt'or a.st_dev==b.st_dev,'INPUT_FD_DEVICE_CHANGED';same(sha(raw),selected['sha256'],'INPUT_HASH_CHANGED');assert len(raw)<=maximum
  self.inputs[str(p)]=selected['sha256'];return raw
 def json(self,reference):return json.loads(self.raw(reference))
 def inventory(self,reference,ctx):
  same(reference,ctx['resume']['oldOperationInventoryRef'],'EXACT_ARCHIVE_INVENTORY_REQUIRED')
  same(reference['sha256'],'70968d0900e5bb463d6ac35b1b455ff2a01f7837da666500ebf07e1418271197','ARCHIVE_INVENTORY_IDENTITY_CHANGED')
  raw=self.raw(reference,maximum=64*1024**2);same(len(raw),42144060,'ARCHIVE_INVENTORY_SIZE_CHANGED');value=json.loads(raw)
  selected=self.archived.get((normalize_path(reference['file']),reference['sha256']),reference);self.inputs.pop(str(pathlib.Path(selected['file'])),None)
  self.stream(selected,len(raw),kind='archive-inventory');return value
 def sources(self,pins,original_plan):
  assert isinstance(pins,list)and pins,'SOURCE_ARCHIVE_MISSING';seen=set()
  for pin in pins:
   shape(pin,'originalPath sha256 snapshotRef','SOURCE_ARCHIVE_SHAPE');key=(normalize_path(pin['originalPath']),pin['sha256']);assert key[0]not in seen,'DUPLICATE_SOURCE_ARCHIVE';seen.add(key[0]);same(pin['sha256'],pin['snapshotRef']['sha256'],'SOURCE_ARCHIVE_HASH')
   size=pathlib.Path(pin['snapshotRef']['file']).lstat().st_size
   if size>16*1024**2:
    authenticated={normalize_path(file):digest for file,digest in original_plan['sourceFiles'].items()};same(authenticated.get(key[0]),pin['sha256'],'LARGE_SOURCE_NOT_IN_AUTHENTICATED_PLAN');assert key[0].replace('\\','/').endswith('/host-pack/deploy/scripts/online-release-host-dependencies/node_modules/@prisma/client/index.d.ts')and size<=64*1024**2,'UNKNOWN_LARGE_SOURCE_CLASS';self.stream(pin['snapshotRef'],size,kind='source-snapshot',originalPath=pin['originalPath'])
   else:self.raw(pin['snapshotRef'],maximum=16*1024**2)
   self.archived[key]=pin['snapshotRef']
 def recheck(self):
  for file,digest in list(self.inputs.items()):self.raw({'file':file,'sha256':digest})
  for file,row in list(self.streaming.items()):self.stream({'file':file,'sha256':row['sha256']},row['bytes'],kind=row['kind'],originalPath=row.get('originalPath'))
 def stream(self,reference,expected_bytes,kind='archive',originalPath=None):
  p=pathlib.Path(reference['file']);assert p.is_absolute()and p.resolve(strict=True)==p and not p.is_symlink();a=p.lstat();assert stat.S_ISREG(a.st_mode)and a.st_nlink==1 and type(expected_bytes)is int and 0<expected_bytes<=4*1024**3 and a.st_size==expected_bytes,'ARCHIVE_STREAM_BOUND'
  digest=hashlib.sha256();count=0;fd=os.open(p,os.O_RDONLY|getattr(os,'O_NOFOLLOW',0))
  with os.fdopen(fd,'rb')as stream:
   d=os.fstat(stream.fileno())
   while True:
    part=stream.read(1024**2)
    if not part:break
    digest.update(part);count+=len(part)
   b=os.fstat(stream.fileno())
  c=p.lstat();ident=lambda s:(s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_nlink);cross=lambda s:(s.st_ino,s.st_size,s.st_mtime_ns,s.st_nlink);same(ident(d),ident(b),'ARCHIVE_FD_CHANGED');same(cross(a),cross(b),'ARCHIVE_NAMED_FD_CHANGED');same(ident(a),ident(c),'ARCHIVE_CHANGED');same(a.st_dev,c.st_dev,'ARCHIVE_DEVICE_CHANGED');same(count,expected_bytes,'ARCHIVE_BYTES_CHANGED');same(digest.hexdigest(),reference['sha256'],'ARCHIVE_HASH_CHANGED');assert kind in ('archive','source-snapshot','archive-inventory');self.streaming[str(p)]={'kind':kind,'sha256':reference['sha256'],'bytes':count,**({'originalPath':originalPath}if kind=='source-snapshot'else{})}
  if os.name!='nt':same(a.st_dev,b.st_dev,'ARCHIVE_FD_DEVICE_CHANGED');same(a.st_ctime_ns,b.st_ctime_ns,'ARCHIVE_FD_CTIME_CHANGED')
def decode64(text):
 assert isinstance(text,str),'BASE64_NOT_STRING';raw=base64.b64decode(text,validate=True);same(base64.b64encode(raw).decode(),text,'NONCANONICAL_BASE64');return raw
def child(reader,reference,argv=None,input_bytes=None):
 row=reader.json(reference);shape(row,CHILD_FIELDS,'ORIGINAL_CHILD_SCHEMA');same(row['format'],'sabalan-c16-original-child/v1','ORIGINAL_CHILD_FORMAT');validate_child(row)
 assert isinstance(row['argv'],list)and row['argv']and all(isinstance(v,str)for v in row['argv']),'ORIGINAL_ARGV_UNKNOWN'
 if argv is not None:same(row['argv'],argv,'ORIGINAL_ARGV_CHANGED')
 for name in ('stdout','stderr'):same(sha(decode64(row[name+'Base64'])),row[name+'Sha256'],'ORIGINAL_STREAM_HASH')
 if row['inputBase64']is None:same(row['inputSha256'],None,'ORIGINAL_INPUT_HASH_WITHOUT_BYTES');actual_input=None
 else:actual_input=decode64(row['inputBase64']);same(sha(actual_input),row['inputSha256'],'ORIGINAL_INPUT_BYTES_CHANGED')
 if input_bytes is not None:same(actual_input,input_bytes,'ORIGINAL_INPUT_SELECTION_CHANGED')
 return row,decode64(row['stdoutBase64']),actual_input
def child_json(reader,reference,argv=None,input_bytes=None):return json.loads(child(reader,reference,argv,input_bytes)[1])
def normalize_inspection(values):
 result=[]
 for v in values:
  same(v['Config']['Labels']['com.docker.compose.project'],'sabalanerp-local','FOREIGN_COMPOSE_PROJECT')
  result.append({'service':v['Config']['Labels']['com.docker.compose.service'],'id':v['Id'],'image':v['Image'],'startedAt':v['State']['StartedAt'],'running':v['State']['Running'],'pid':v['State']['Pid'],'status':v['State']['Status'],'health':v['State'].get('Health',{}).get('Status'),'configurationSha256':sha(json.dumps({k:v[k]for k in ('Config','HostConfig','Mounts')},sort_keys=True,separators=(',',':')).encode()),'ips':[v['IPAddress']for v in v['NetworkSettings']['Networks'].values()]})
 return result
def inspect_child(reader,reference):
 row,raw,_=child(reader,reference);same(row['argv'][0:2],['docker','inspect'],'NOT_INSPECTION_CHILD');value=json.loads(raw);same(len(value),10,'INSPECTION_EXACT_TEN');same(row['argv'][2:],[v['Id']for v in value],'INSPECTED_IDS_CHANGED');return value,normalize_inspection(value)
def source_raw(reader,handoff,suffix):
 if suffix=='tests/online-deployment/installed-native-image-probe.fixture.mjs':
  # This exact C16 source was absent from the original source-map archive.
  # Both genuine original installed probes retained its complete stdin bytes.
  baseline=reader.json(handoff['baselineRef']);sources=[]
  for role,key in zip(ROLES,('installedCandidate','installedRetained')):
   reference=baseline['evidenceRefs'][key];_,_,raw=child(reader,reference,['docker','exec','-i',baseline['freshConfigurations'][role]['id'],'node','--input-type=module']);assert raw is not None,'C16_INSTALLED_SOURCE_STDIN_MISSING';same(len(raw),3639,'C16_INSTALLED_SOURCE_BYTES_CHANGED');same(sha(raw),'599c0cee1021356d6fd9503aabf929b6347d9665304452f6cd292f6a90f360b4','C16_INSTALLED_SOURCE_CHANGED');sources.append(raw)
  same(sources[0],sources[1],'C16_INSTALLED_SOURCE_ORIGINALS_DIFFER');return sources[0]
 found=[v for v in handoff['sourcePins']if v['originalPath'].replace('\\','/').endswith('/'+suffix)];same(len(found),1,'EXACT_SOURCE_ARCHIVE_REQUIRED:'+suffix);return reader.raw(found[0]['snapshotRef'])
def quiet_source(reader,handoff):
 source=source_raw(reader,handoff,'scripts/replace-qualified-application-native-candidate-local.mjs').decode('utf-8')
 start=source.index('export function qualifiedCandidateNativeQuietProbe(negativeRetirement){return String.raw`')+len('export function qualifiedCandidateNativeQuietProbe(negativeRetirement){return String.raw`');end=source.index('`;',start);value=source[start:end].replace('\r\n','\n');same(value.count('${JSON.stringify(JSON.stringify(negativeRetirement))}'),1,'QUIET_SOURCE_TEMPLATE_CHANGED');return value.replace('${JSON.stringify(JSON.stringify(negativeRetirement))}',json.dumps('null'))
def sql_source(ctx,targets):
 names=sorted({v['name']for v in ctx['sqlScopes'].values()if isinstance(v,dict)and'name'in v});quote=lambda s:"'"+s.replace("'","''")+"'";dbs=','.join(map(quote,names));ips=','.join(map(quote,sorted({ip for v in targets for ip in v['ips']})));catalog=ctx['sqlScopes']['catalogApplicationName']
 return "SELECT json_build_object('visible',(SELECT rolsuper OR pg_has_role(current_user,'pg_read_all_stats','member') FROM pg_roles WHERE rolname=current_user),'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),'databases',(SELECT json_agg(json_build_object('name',datname,'oid',oid::text)) FROM pg_database WHERE datname IN ("+dbs+")),'sessions',COALESCE((SELECT json_agg(json_build_object('pid',pid,'database',datname,'client',host(client_addr),'application',application_name,'state',state,'transactionOpen',xact_start IS NOT NULL,'backendXid',backend_xid IS NOT NULL,'queryMd5',md5(query))) FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND backend_type='client backend' AND (datname IN ("+dbs+") OR application_name LIKE 'sabalan-rt-%' OR application_name="+quote(catalog)+" OR host(client_addr) IN ("+ips+"))),'[]'::json),'prepared',COALESCE((SELECT json_agg(json_build_object('database',database,'gid',gid)) FROM pg_prepared_xacts WHERE database IN ("+dbs+")),'[]'::json))"
def sql_child(reader,reference,ctx,targets,after_stops=False):
 postgres=next(v['id']for v in ctx['protectedEight']if v['service']=='postgres');value=child_json(reader,reference,['docker','exec',postgres,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql_source(ctx,targets)]);validate_sql({**ctx,'targets':targets},value,after_stops=after_stops,fresh=not after_stops);return value
def metadata_child(reader,reference,source,expected_spec,cid):
 bootstrap="import base64,hashlib,io,json,sys;p=json.load(sys.stdin);s=base64.b64decode(p['sourceBase64'],validate=True);assert hashlib.sha256(s).hexdigest()=="+repr(sha(source))+";sys.stdin=io.StringIO(json.dumps(p['spec']));exec(compile(s,'source-owned-c16-namespace-metadata','exec'),{'__name__':'__main__'})"
 row,raw,stdin=child(reader,reference,['docker','exec','-i',cid,'/usr/bin/python3','-I','-B','-c',bootstrap]);p=json.loads(stdin);shape(p,'sourceBase64 spec','METADATA_INPUT_SCHEMA');same(decode64(p['sourceBase64']),source,'METADATA_SOURCE_CHANGED');same(p['spec'],expected_spec,'METADATA_SPEC_CHANGED');return json.loads(raw)
def record(reader,reference,kind):
 value=reader.json(reference);shape(value,SHAPES[kind],'NEGATIVE_RECORD_SCHEMA:'+kind);same(value['format'],FORMATS[kind],'NEGATIVE_RECORD_FORMAT')
 for key in ('qualificationSucceeded','productionAdmission'):same(value[key],False,'NEGATIVE_ADMISSION_CLAIM')
 if kind!='handoff':shape(value['evidenceRefs'],EVIDENCE[kind],'NEGATIVE_EVIDENCE_KEYSET')
 return value

def validate_log_projection(ctx,stream,raw,closed):
 assert stream in ('stdout','stderr')and type(raw)is bytes,'LOG_PROJECTION_INPUT'
 selection=ctx['resume']['originalLogs'][stream]
 shape(selection,'physicalRef physicalBytes logicalBytes logicalSha256 translation','LOG_PROJECTION_SCHEMA')
 same(selection['translation'],'windows-crt-text-lf-to-crlf/v1','UNKNOWN_LOG_TRANSLATION')
 same(sha(raw),selection['physicalRef']['sha256'],'PHYSICAL_LOG_HASH_CHANGED');same(len(raw),selection['physicalBytes'],'PHYSICAL_LOG_BYTES_CHANGED')
 logical=raw.replace(b'\r\n',b'\n')
 same(logical.replace(b'\n',b'\r\n'),raw,'LOG_TRANSLATION_NOT_REVERSIBLE')
 same(len(logical),selection['logicalBytes'],'LOGICAL_LOG_BYTES_CHANGED');same(sha(logical),selection['logicalSha256'],'LOGICAL_LOG_HASH_CHANGED')
 row=closed['logs'][stream]
 same(row['closed'],True,'ORIGINAL_LOG_OPEN');same(row['truncated'],False,'ORIGINAL_LOG_TRUNCATED')
 same(row['bytesSeen'],len(logical),'ORIGINAL_LOGICAL_SEEN_CHANGED');same(row['bytesRetained'],len(logical),'ORIGINAL_LOGICAL_RETAINED_CHANGED')
 return {'physicalRef':selection['physicalRef'],'physicalBytes':len(raw),'logicalBytes':len(logical),'logicalSha256':sha(logical),'translation':selection['translation'],'physicalPreserved':True}

def read_inventory_child(reader,reference):
 raw=reader.json(reference)
 if raw['format']=='sabalan-c16-original-child/v1':return child(reader,reference)[0]
 shape(raw,'format argv originalPid code signal stdoutEof stderrEof interrupted inputSha256 inputBase64 stdoutRef stdoutBytes stderrBase64 stderrSha256','ARCHIVE_CHILD_SCHEMA')
 same(raw['format'],'sabalan-c16-original-archive-child/v1','UNKNOWN_ORIGINAL_CHILD_FORMAT');validate_child(raw)
 assert isinstance(raw['argv'],list)and raw['argv']and all(isinstance(v,str)for v in raw['argv']),'ORIGINAL_ARGV_UNKNOWN'
 same(raw['inputSha256'],None,'ARCHIVE_STDIN');same(raw['inputBase64'],None,'ARCHIVE_STDIN');same(sha(decode64(raw['stderrBase64'])),raw['stderrSha256'],'ARCHIVE_STDERR_HASH');reader.stream(raw['stdoutRef'],raw['stdoutBytes']);return raw

def validate_resume_prefix(ctx,reader=None):
 reader=Reader()if reader is None else reader;r=ctx['resume']
 same(r['format'],'sabalan-c16-exact-failed-owner-resume/v1','RESUME_CONTEXT_FORMAT')
 old=reader.json(r['failedContextRef']);same({k:v for k,v in ctx.items()if k!='resume'},old,'RESUME_CONTEXT_EXPANDED_SCOPE')
 review=reader.json(r['failedSourceReviewRef']);same(review['originalSourceCommit'],ctx['sourceCommit'],'HISTORICAL_SOURCE_COMMIT')
 for file,digest in review['files'].items():reader.raw({'file':file,'sha256':digest})
 failure=reader.json(r['failureRef']);shape(failure,'format errorType error originalChildren interrupted qualificationSucceeded productionAdmission','FAILED_PREFIX_SCHEMA')
 same(failure['format'],'sabalan-c16-negative-recovery-failed/v1','FAILED_PREFIX_FORMAT');same(failure['errorType'],'AssertionError','FAILED_PREFIX_CAUSE');same(failure['error'],'ORIGINAL_SUPERVISOR_LOG_BYTES_CHANGED','FAILED_PREFIX_CAUSE')
 for key in ('interrupted','qualificationSucceeded','productionAdmission'):same(failure[key],False,'FAILED_PREFIX_FALSE_CLAIM')
 refs=failure['originalChildren'];same(len(refs),r['originalChildCount'],'HISTORICAL_PREFIX_COUNT');same(len(refs),69,'EXACT_FAILED_PREFIX_REQUIRED');seen=set();pids=set();rows=[]
 for selected in refs:
  key=(normalize_path(selected['file']),selected['sha256']);assert key not in seen,'DUPLICATE_HISTORICAL_CHILD';seen.add(key)
  same(normalize_path(str(pathlib.Path(selected['file']).parent)),normalize_path(r['originalEvidenceDirectory']),'HISTORICAL_CHILD_OUTSIDE_OWNER')
  row=read_inventory_child(reader,selected);assert row['originalPid']not in pids,'DUPLICATE_HISTORICAL_PID';pids.add(row['originalPid']);rows.append(row)
  assert not(row['argv'][:2]==['docker','start']or(row['argv'][:2]==['docker','compose']and 'up'in row['argv'])),'HISTORICAL_PREFIX_ALREADY_RECREATED'
 stops=[v for v in rows if v['argv'][:3]==['docker','container','stop']]
 same([v['argv']for v in stops],[['docker','container','stop','--signal=SIGTERM','--timeout=-1',v['id']]for v in ctx['targets']],'EXACT_TWO_HISTORICAL_STOPS_REQUIRED')
 for row,target in zip(stops,ctx['targets']):same(decode64(row['stdoutBase64']).decode().strip(),target['id'],'HISTORICAL_STOP_OUTPUT')
 inventory=reader.inventory(r['oldOperationInventoryRef'],ctx);archive_inventory(reader,inventory,ctx)
 archive_refs=[v['originalChildRef']for v in inventory['archives'].values()]
 same(len([v for v in rows if v['format']=='sabalan-c16-original-archive-child/v1']),3,'EXACT_THREE_HISTORICAL_ARCHIVES')
 for selected in archive_refs:assert (normalize_path(selected['file']),selected['sha256'])in seen,'HISTORICAL_ARCHIVE_CHILD_OMITTED'
 tool=reader.json(r['toolClosureRef'])
 shape(tool,'format observationKind toolSessionId completionChunkId toolReportedExitCode toolReportedCompleted requestedArgv sourceReviewRef failureRef capturedToolOutput nativePid originalPopenAdopted originalNativeParentReapingClaimed originalNativeParentPipeEofClaimed separateStdoutAndStderrClaimed qualificationSucceeded productionAdmission limits','TOOL_CLOSURE_SCHEMA')
 same(tool['format'],'sabalan-c16-negative-wrapper-tool-closure-observation/v1','TOOL_CLOSURE_FORMAT');same(tool['observationKind'],'UNIFIED_EXEC_COMPLETION_NOT_NATIVE_POPEN_CUSTODY','TOOL_NOT_NATIVE_CUSTODY')
 same(tool['toolSessionId'],67080,'WRONG_HISTORICAL_TOOL');same(tool['toolReportedExitCode'],1,'WRONG_TOOL_NEGATIVE');same(tool['toolReportedCompleted'],True,'HISTORICAL_TOOL_NOT_CLOSED');same(tool['nativePid'],None,'INVENTED_HISTORICAL_NATIVE_PID')
 for key in ('originalPopenAdopted','originalNativeParentReapingClaimed','originalNativeParentPipeEofClaimed','separateStdoutAndStderrClaimed','qualificationSucceeded','productionAdmission'):same(tool[key],False,'FALSE_HISTORICAL_NATIVE_CLAIM')
 same(tool['sourceReviewRef'],r['failedSourceReviewRef'],'TOOL_REVIEW_JOIN');same(tool['failureRef'],r['failureRef'],'TOOL_FAILURE_JOIN')
 expected_argv=['C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe','-I','-B',str(pathlib.Path(r['originalSourceDirectory'])/'operator.py'),'--apply-reviewed',r['failedSourceReviewRef']['file'],r['failedSourceReviewRef']['sha256'],'--output',r['originalEvidenceDirectory']]
 same(len(tool['requestedArgv']),len(expected_argv),'TOOL_ARGV_LENGTH');same([normalize_path(v)if i in (0,3,5,8)else v for i,v in enumerate(tool['requestedArgv'])],[normalize_path(v)if i in (0,3,5,8)else v for i,v in enumerate(expected_argv)],'TOOL_INVOCATION_CHANGED')
 proof=reader.json(r['independentPrefixProofRef']);same(proof['format'],'sabalan-independent-readonly-negative-prefix-source-proof/v1','PREFIX_PROOF_FORMAT');same(proof['runtimeActions'],0,'PREFIX_PROOF_RUNTIME_ACTIONS')
 for key in ('qualificationClaimed','originalOwnershipAdopted'):same(proof[key],False,'PREFIX_PROOF_ADMISSION')
 same(proof['failedRecord'],r['failureRef'],'PREFIX_PROOF_FAILURE_JOIN');same(proof['originalClosed'],r['originalClosedRef'],'PREFIX_PROOF_CLOSURE_JOIN');same(proof['supervisorSource'],r['supervisorSourceRef'],'PREFIX_PROOF_SOURCE_JOIN')
 plan=reader.json(ctx['originalSupervisor']['plan']);start=reader.json(ctx['originalSupervisor']['started']);closed=reader.json(r['originalClosedRef']);validate_original_negative_closed(ctx,start,closed)
 same(plan['sourceCommit'],ctx['sourceCommit'],'ORIGINAL_PLAN_SOURCE_JOIN');same(start['sourceCommit'],ctx['sourceCommit'],'ORIGINAL_START_SOURCE_JOIN');same(start['masterSha256'],plan['masterSha256'],'ORIGINAL_MASTER_SOURCE_JOIN')
 source=reader.raw(r['supervisorSourceRef']);same(sha(source),'97ef6804033ea0468d67045d56df9da583e4cfb051b7b961477f0dd272f268e7','ORIGINAL_LOG_WRITER_SOURCE_CHANGED')
 same({normalize_path(k):v for k,v in plan['sourceFiles'].items()}.get(normalize_path(r['supervisorSourceRef']['file'])),r['supervisorSourceRef']['sha256'],'ORIGINAL_LOG_WRITER_NOT_FROZEN')
 projections={stream:validate_log_projection(ctx,stream,reader.raw(r['originalLogs'][stream]['physicalRef']),closed)for stream in ('stdout','stderr')}
 windows=reader.json(r['windowsControlRef']);same(windows,{'format':'sabalan-c16-exact-windows-negative-control/v1','originalMasterPid':ctx['master']['pid'],'originalMasterBirth':ctx['master']['creationFiletime'],'kernelExitCode':125,'externallyCancelled':True,'originalSupervisorUntouched':True,'originalPopenAdopted':False,'originalExecKernelExitObserved':True,'originalExecParentReapingClaimed':False,'originalExecParentEofClaimed':False,'originalMasterParentEofClaimed':False,'nativeReapedClaimed':False,'qualificationClaimed':False,'productionAdmission':False},'WINDOWS_NEGATIVE_PREFIX_JOIN')
 return {'childRefs':refs,'logProjections':projections}

def validate_historical_prefix_record(ctx,reader,reference,prefix):
 value=reader.json(reference)
 expected={'format':'sabalan-c16-historical-closed-owner-prefix/v1',**{k:ctx['resume'][k]for k in ('failedSourceReviewRef','failureRef','toolClosureRef','independentPrefixProofRef')},'originalChildren':prefix['childRefs'],'historicalChildrenCount':len(prefix['childRefs']),'ownerClosureKind':'TOOL_OBSERVED_COMPLETED','originalOwnerNativePid':None,'originalPopenAdopted':False,'nativeParentPipeEofClaimed':False}
 same(value,expected,'HISTORICAL_PREFIX_CUSTODY_CHANGED');return value

def inventories(reader,records,ctx):
 all_refs=set();all_pids={'historical':set(),'current':set()};end=0;decoded=[];prefix=validate_resume_prefix(ctx,reader)
 for phase in ('cancellation','baseline','restoration'):
  value=reader.json(records[phase]['originalChildrenRef']);fields='format phase firstOrdinal endOrdinal children allOriginalChildrenClosed interrupted';shape(value,fields+(' historicalPrefixRef'if phase=='cancellation'else''),'ORIGINAL_INVENTORY_SCHEMA');same(value['format'],'sabalan-c16-resumed-original-child-inventory/v1'if phase=='cancellation'else'sabalan-c16-original-child-inventory/v1','ORIGINAL_INVENTORY_FORMAT')
  if phase=='cancellation':validate_historical_prefix_record(ctx,reader,value['historicalPrefixRef'],prefix);same([v['ref']for v in value['children'][:len(prefix['childRefs'])]],prefix['childRefs'],'HISTORICAL_PREFIX_SEQUENCE_CHANGED');assert len(value['children'])>len(prefix['childRefs']),'RESUME_HAS_NO_OWN_CHILDREN'
  same(value['phase'],phase,'ORIGINAL_INVENTORY_PHASE');same(value['firstOrdinal'],end+1,'ORIGINAL_SEQUENCE_GAP');same(value['allOriginalChildrenClosed'],True,'ORIGINAL_OWNER_NOT_CLOSED');same(value['interrupted'],False,'ORIGINAL_OWNER_INTERRUPTED');assert value['children'],'EMPTY_PHASE_CHILD_INVENTORY'
  for item in value['children']:
   shape(item,'ordinal key ref','ORIGINAL_INVENTORY_ITEM');end+=1;same(item['ordinal'],end,'ORIGINAL_SEQUENCE_GAP');key=(normalize_path(item['ref']['file']),item['ref']['sha256']);assert key not in all_refs,'DUPLICATE_ORIGINAL_CHILD';all_refs.add(key);raw=reader.json(item['ref'])
   if raw['format']=='sabalan-c16-original-child/v1':row,_,_=child(reader,item['ref'])
   else:
    shape(raw,'format argv originalPid code signal stdoutEof stderrEof interrupted inputSha256 inputBase64 stdoutRef stdoutBytes stderrBase64 stderrSha256','ARCHIVE_CHILD_SCHEMA');same(raw['format'],'sabalan-c16-original-archive-child/v1','UNKNOWN_ORIGINAL_CHILD_FORMAT');validate_child(raw);same(raw['inputSha256'],None,'ARCHIVE_STDIN');same(raw['inputBase64'],None,'ARCHIVE_STDIN');same(sha(decode64(raw['stderrBase64'])),raw['stderrSha256'],'ARCHIVE_STDERR_HASH');reader.stream(raw['stdoutRef'],raw['stdoutBytes']);row=raw
   origin='historical'if end<=len(prefix['childRefs'])else'current';assert row['originalPid']not in all_pids[origin],'DUPLICATE_ORIGINAL_CHILD_PID';all_pids[origin].add(row['originalPid']);decoded.append((phase,item['key'],item['ref'],row))
  same(value['endOrdinal'],end,'ORIGINAL_SEQUENCE_END')
 return decoded,all_refs
def archive_inventory(reader,value,ctx):
 shape(value,'format operationRoot archives oldVolumesDeleted oldRecordsRewritten','OLD_ARCHIVE_SCHEMA');same(value['format'],'sabalan-c16-preserved-old-operation-inventory/v1','OLD_ARCHIVE_FORMAT');same(value['operationRoot'],ctx['operationRoot'],'OLD_ARCHIVE_OPERATION');same(value['oldVolumesDeleted'],False,'OLD_VOLUMES_DELETED');same(value['oldRecordsRewritten'],False,'OLD_RECORDS_REWRITTEN');shape(value['archives'],'operation backend-candidate backend-retained','EXACT_THREE_OLD_ARCHIVES')
 for key,row in value['archives'].items():
  shape(row,'originalChildRef archiveRef entries','OLD_ARCHIVE_ENTRY_SCHEMA');actual=reader.json(row['originalChildRef']);same(actual['stdoutRef'],row['archiveRef'],'ARCHIVE_CHILD_FILE_JOIN');cid=ctx['targets'][0]['id']if key in ('operation','backend-candidate')else ctx['targets'][1]['id'];target=ctx['operationRoot']if key=='operation'else'/app/qualification-authority-root'if key=='backend-candidate'else'/app/qualification-jobs-root';same(actual['argv'],['docker','cp',cid+':'+target,'-'],'OLD_ARCHIVE_ARGV_CHANGED')
  entries=[];total=0
  with tarfile.open(row['archiveRef']['file'],mode='r|*')as archive:
   for member in archive:
    p=pathlib.PurePosixPath(member.name);assert not p.is_absolute()and '..'not in p.parts and not member.isdev()and not member.isfifo(),'UNSAFE_ARCHIVE_MEMBER';total+=member.size;assert total<=4*1024**3
    item={'path':member.name,'type':member.type.decode('ascii'),'size':member.size,'mode':member.mode,'uid':member.uid,'gid':member.gid,'linkname':member.linkname}
    if member.isfile():
     digest=hashlib.sha256();stream=archive.extractfile(member);count=0
     while True:
      part=stream.read(1024**2)
      if not part:break
      digest.update(part);count+=len(part)
     same(count,member.size,'ARCHIVE_MEMBER_TRUNCATED');item['sha256']=digest.hexdigest()
    entries.append(item)
  same(entries,row['entries'],'ARCHIVE_MEMBER_INVENTORY_CHANGED');assert len({x['path']for x in entries})==len(entries),'DUPLICATE_ARCHIVE_MEMBER'
  if key=='operation':
   index=[x for x in entries if x['path'].rstrip('/').endswith('/index.json')and x['path'].count('/')==1];same(len(index),1,'OLD_OPERATION_INDEX_MISSING');same(index[0]['sha256'],ctx['indexSha256'],'OLD_OPERATION_INDEX_CHANGED')

def validate_fresh_engine(old,actual,cohort_nonce):
 for role in ROLES:
  before=old[role];after=actual[role];same(after['Image'],before['Image'],'FRESH_IMMUTABLE_IMAGE_CHANGED')
  a=json.loads(json.dumps(before['Config']));b=json.loads(json.dumps(after['Config']))
  if a['Hostname']==before['Id'][:12]:same(b['Hostname'],after['Id'][:12],'FRESH_HOSTNAME_NOT_OWNED');a.pop('Hostname');b.pop('Hostname')
  for key in ('com.docker.compose.config-hash','com.docker.compose.project.config_files'):
   assert key in a['Labels']and key in b['Labels'];a['Labels'].pop(key);b['Labels'].pop(key)
  # Compose/Engine may reorder environment entries; variable identity and all
  # exact values remain strict, including refusal of duplicate variable names.
  for config in (a,b):
   values=config.get('Env');assert isinstance(values,list),'FRESH_ENV_ARRAY_REQUIRED';names=[]
   for value in values:
    assert isinstance(value,str)and '='in value and '\x00'not in value,'FRESH_ENV_ENTRY_INVALID';name=value.split('=',1)[0];assert re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*',name),'FRESH_ENV_NAME_INVALID';names.append(name)
   same(len(names),len(set(names)),'FRESH_ENV_DUPLICATE_NAME');config['Env']=sorted(values)
  same(a,b,'FRESH_APPLICATION_CONFIG_CHANGED')
  a=json.loads(json.dumps(before['HostConfig']));b=json.loads(json.dumps(after['HostConfig']))
  for mount in a.get('Mounts',[]):
   if mount.get('Target')in ('/app/runtime-authority','/app/jobs-authority','/run/sabalan-online'):
    mount['VolumeOptions']['Subpath']='cohort-'+cohort_nonce
   if mount.get('Target')==ACCEPTANCE_TARGET:mount.setdefault('VolumeOptions',{})['Subpath']='c16-recovery-'+cohort_nonce;mount['VolumeOptions']['NoCopy']=True
  # Legacy acceptance binds are not accepted: source review requires an exact
  # explicit Engine volume mount after the finite configuration transformation.
  if not any(v.get('Target')==ACCEPTANCE_TARGET for v in a.get('Mounts',[])):
   binds=a.get('Binds',[]);matched=[v for v in binds if v.split(':')[1]==ACCEPTANCE_TARGET];same(len(matched),1,'LEGACY_ACCEPTANCE_BIND_UNKNOWN');a['Binds']=[v for v in binds if v not in matched];a.setdefault('Mounts',[]).append({'Type':'volume','Source':ACCEPTANCE_VOLUME,'Target':ACCEPTANCE_TARGET,'VolumeOptions':{'NoCopy':True,'Subpath':'c16-recovery-'+cohort_nonce}})
  # Docker preserves list order per canonical compose config; comparing by
  # target avoids treating an order-only Engine mount representation as a change.
  for value in (a,b):value['Mounts']=sorted(value.get('Mounts',[]),key=lambda v:v['Target'])
  for value in (a,b):
   for mount in value['Mounts']:
    if mount['Target']==ACCEPTANCE_TARGET:mount.setdefault('ReadOnly',False)
  # Docker may reorder bind declarations; preserve every exact declaration
  # and reject ambiguous duplicate targets before comparing their sets.
  for config in (a,b):
   binds=config.get('Binds');assert isinstance(binds,list),'FRESH_BINDS_ARRAY_REQUIRED';targets=[]
   for bind in binds:
    assert isinstance(bind,str)and '\x00'not in bind,'FRESH_BIND_ENTRY_INVALID';parts=bind.split(':');assert len(parts)in (2,3)and all(parts)and parts[1].startswith('/'),'FRESH_BIND_DECLARATION_INVALID';targets.append(parts[1])
   same(len(targets),len(set(targets)),'FRESH_BIND_DUPLICATE_TARGET');config['Binds']=sorted(binds)
  same(a,b,'FRESH_HOST_CONFIGURATION_CHANGED')

def source_method_script(source,name):
 tree=ast.parse(source.decode('utf-8'));method=next(v for v in ast.walk(tree)if isinstance(v,ast.FunctionDef)and v.name==name)
 assignments=[v for v in ast.walk(method)if isinstance(v,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='script'for t in v.targets)];same(len(assignments),1,'SOURCE_SCRIPT_ASSIGNMENT');return ast.literal_eval(assignments[0].value)
def audit_all_children(reader,handoff,ctx,decoded,initial,slots,baseline):
 base='D:/sabalanerp/docker-compose.local.yml';root=pathlib.Path('C:/Users/mahan/.codex/worktrees/online-deployment/sabalanerp');overlays=['docker-compose.online-acceptance.yml','docker-compose.online-runtime-authority-acceptance.yml','docker-compose.application-native-role-isolation.yml','docker-compose.application-native-mixed-images.yml','docker-compose.application-native-authority-cohort.yml'];prefix=['docker','compose','-f',base,*[v for name in overlays for v in ('-f',str(root/name))]]
 source=source_raw(reader,handoff,'recovery_ops.py');scripts={name:source_method_script(source,name)for name in ('unknown_windows_descendants','master_absent','host_memory')};scripts['supervisor_absent']=source_method_script(source_raw(reader,handoff,'resume_owner.py'),'supervisor_absent');expected_windows={v['ProcessId']:v for v in reader.json(ctx['originalIdentitiesRef'])['windows']};fresh=list(baseline['freshConfigurations'].values());old_ids={v['Id']for v in initial};new_ids={v['Id']for v in slots.values()};all_ids=old_ids|new_ids;ps=['docker','compose','-f',base,'ps','--all','--no-trunc','--format','json'];memory={'before':[],'after':[]};old_configuration=None;new_overlay=None;new_hashes={};old_hashes={};bridge_stop=[];up_count=0;archive_count=0
 metadata_refs={baseline['acceptance']['createdRef']['sha256'],*[v['sha256']for v in baseline['acceptance']['verified'].values()],*[v['sha256']for v in baseline['authorityCohort']['prepared'].values()],*[v['sha256']for v in baseline['authorityCohort']['verified'].values()]}
 previous_argv=None
 for phase,key,reference,row in decoded:
  argv=row['argv']
  if argv and argv[0]=='docker'and argv!=ps:same(previous_argv,ps,'DOCKER_ACTION_WITHOUT_IMMEDIATE_CANONICAL_PS')
  previous_argv=argv
  if row['format']=='sabalan-c16-original-archive-child/v1':archive_count+=1;continue
  _,raw,stdin=child(reader,reference)
  if argv==ps:
   values=[json.loads(v)for v in raw.decode().splitlines()if v.strip()];same(len(values),10,'AUXILIARY_PS_CENSUS');same({v['Service']for v in values},{v['service']for v in ctx['targets']+ctx['protectedEight']},'AUXILIARY_PS_SCOPE');assert all(v['Project']=='sabalanerp-local'and v['ID']in all_ids for v in values),'AUXILIARY_PS_UNKNOWN_ID'
  elif argv[:2]==['docker','inspect']:
   values,rows=inspect_child(reader,reference);assert all(v['Id']in all_ids for v in values),'AUXILIARY_INSPECT_UNKNOWN_ID'
  elif argv[:3]==['docker','container','stop']:same(len(argv),6,'STOP_ARGV_LENGTH');assert argv[-1]in {v['id']for v in ctx['targets']},'STOP_SCOPE_UNKNOWN';same(argv,['docker','container','stop','--signal=SIGTERM','--timeout=-1',argv[-1]],'STOP_SCOPE_UNKNOWN')
  elif argv[:2]==['docker','start']:same(argv,['docker','start',next(v['id']for v in ctx['protectedEight']if v['service']=='frontend')],'START_SCOPE_UNKNOWN')
  elif argv[:3]==['docker','image','inspect']:same(argv[3:],[v['image']for v in ctx['targets']],'IMAGE_SCOPE_UNKNOWN')
  elif argv[:2]==['docker','exec']:
   if reference['sha256']in metadata_refs:continue
   if len(argv)>3 and argv[2]=='-i':same(argv,['docker','exec','-i',argv[3],'node','--input-type=module'],'UNRECOGNIZED_EXEC_ACTION');assert argv[3]in new_ids,'INSTALLED_EXEC_SCOPE';same(stdin,source_raw(reader,handoff,'tests/online-deployment/installed-native-image-probe.fixture.mjs'),'INSTALLED_EXEC_SOURCE')
   elif len(argv)>3 and argv[3]=='psql':
    targets=fresh if argv[-1]==sql_source(ctx,fresh)else ctx['targets'];same(argv,['docker','exec',next(v['id']for v in ctx['protectedEight']if v['service']=='postgres'),'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',sql_source(ctx,targets)],'AUXILIARY_SQL_SCOPE');validate_sql({**ctx,'targets':targets},json.loads(raw),fresh=phase!='cancellation')
   else:same(argv,['docker','exec',argv[2],'/usr/bin/python3','-I','-B','-c',quiet_source(reader,handoff)],'UNRECOGNIZED_EXEC_ACTION');assert argv[2]in new_ids,'QUIET_EXEC_SCOPE';validate_empty_native(json.loads(raw))
  elif argv[:len(prefix)]==prefix:
   tail=argv[len(prefix):];extra=False
   if tail[:1]==['-f']:
    assert len(tail)>=2;overlay=tail[1];assert pathlib.Path(overlay).is_absolute()and pathlib.Path(overlay).name=='acceptance-isolation.json','UNKNOWN_COMPOSE_OVERLAY';new_overlay=overlay;tail=tail[2:];extra=True
   same(tail[:2],['--profile','online-acceptance'],'UNKNOWN_COMPOSE_PROFILE');tail=tail[2:]
   if tail==['config','--format','json']:
    value=json.loads(raw);same(value['name'],'sabalanerp-local','COMPOSE_PROJECT_UNKNOWN')
    if not extra:assert old_configuration is None,'DUPLICATE_OLD_CONFIG';old_configuration=value
   elif tail[:2]==['config','--hash']:
    same(len(tail),3,'COMPOSE_HASH_ARGV');assert tail[2]in ROLES,'COMPOSE_HASH_SCOPE';(new_hashes if extra else old_hashes)[tail[2]]=raw.decode().strip().split()[-1]
   else:same(tail,['up','-d','--no-deps','--no-build','--pull','never','--wait','--wait-timeout','120',*ROLES],'UNKNOWN_COMPOSE_ACTION');same(extra,True,'FRESH_UP_WITHOUT_ACCEPTANCE_SUBPATH');up_count+=1
  elif argv[:1]==['powershell']:
   same(argv[:4],['powershell','-NoProfile','-NonInteractive','-Command'],'UNKNOWN_WINDOWS_OBSERVER');same(len(argv),5,'UNKNOWN_WINDOWS_OBSERVER_ARGV');name=next((k for k,v in scripts.items()if v==argv[4]),None);assert name,'UNKNOWN_WINDOWS_SCRIPT'
   if name in ('master_absent','supervisor_absent'):same(raw.decode().strip(),'ABSENT','ORIGINAL_MASTER_NOT_ABSENT')
   elif name=='host_memory':
    value=json.loads(raw);shape(value,'observedAt physicalFreeBytes','MEMORY_OBSERVATION_SCHEMA');assert type(value['physicalFreeBytes'])is int and value['physicalFreeBytes']>=0 and isinstance(value['observedAt'],str);memory['after'if up_count else'before'].append(value)
   else:
    values=json.loads(raw);values=values if isinstance(values,list)else[values];assert values and any(v['ProcessId']==ctx['master']['pid']for v in values),'WINDOWS_MASTER_OBSERVER_EMPTY'
    for value in values:
     assert value['ProcessId']in expected_windows and value['ProcessId']!=30272,'UNKNOWN_WINDOWS_DESCENDANT';same(value,{k:expected_windows[value['ProcessId']][k]for k in value},'WINDOWS_DESCENDANT_INCARCERATION_CHANGED')
  elif argv==['C:/Program Files/nodejs/node.exe',next(v['originalPath']for v in handoff['sourcePins']if v['originalPath'].replace('\\','/').endswith('/canonical_bridge.mjs'))]:
   value=json.loads(stdin);assert value['mode']in ('roots','validate-config','validate-slots','quiet-source','installed','stop-provenance'),'UNKNOWN_CANONICAL_BRIDGE_MODE'
   if value['mode']=='quiet-source':same(raw.decode(),quiet_source(reader,handoff),'CANONICAL_QUIET_SOURCE_MISMATCH')
   if value['mode']=='stop-provenance':bridge_stop.append(value)
  else:raise AssertionError('UNKNOWN_ORIGINAL_ACTION:'+repr(argv[:4]))
 same(up_count,1,'EXACT_ONE_FRESH_UP');same(archive_count,3,'EXACT_THREE_ARCHIVE_CHILDREN');same(set(old_hashes),set(ROLES),'OLD_CONFIG_HASH_CHILDREN_MISSING');same(set(new_hashes),set(ROLES),'NEW_CONFIG_HASH_CHILDREN_MISSING');assert old_configuration is not None and new_overlay,'CONFIG_GRAPH_INCOMPLETE'
 for role in ROLES:same(old_hashes[role],next(v for v in initial if v['Config']['Labels']['com.docker.compose.service']==role)['Config']['Labels']['com.docker.compose.config-hash'],'OLD_ACTUAL_CONFIG_HASH');same(new_hashes[role],slots[role]['Config']['Labels']['com.docker.compose.config-hash'],'NEW_ACTUAL_CONFIG_HASH')
 config=child_json(reader,baseline['evidenceRefs']['freshComposeConfigBefore']);previous=reader.json(ctx['historicalCandidateReplacement']);validate_fresh_config(old_configuration,config,baseline['authorityCohort']['nonce'],previous['authorityCohort']['nonce'])
 for stage,values in memory.items():
  assert len(values)>=2 and values[-1]['observedAt']!=values[-2]['observedAt']and all(v['physicalFreeBytes']>=2*1024**3 for v in values[-2:]),'STRICT_TWO_MEMORY_SAMPLES_MISSING:'+stage
 same(len(bridge_stop),1,'EXACT_CANONICAL_STOP_PROVENANCE_VALIDATION');return bridge_stop[0]
def validate_handoff(file,digest):
 reader=Reader();handoff_ref={'file':str(pathlib.Path(file)),'sha256':digest};handoff=record(reader,handoff_ref,'handoff');ctx=context(reader.raw(handoff['contextRef']));plan_pins=[v for v in handoff['sourcePins']if normalize_path(v['originalPath'])==normalize_path(ctx['originalSupervisor']['plan']['file'])];same(len(plan_pins),1,'ORIGINAL_PLAN_SNAPSHOT_MISSING');same(plan_pins[0]['sha256'],ctx['originalSupervisor']['plan']['sha256'],'ORIGINAL_PLAN_SNAPSHOT_HASH');original_plan=reader.json(plan_pins[0]['snapshotRef']);reader.sources(handoff['sourcePins'],original_plan)
 records={kind:record(reader,handoff[kind+'Ref'],kind)for kind in ('cancellation','baseline','restoration')};cancel,baseline,restore=(records[k]for k in ('cancellation','baseline','restoration'))
 validate_index_scopes(ctx,reader.json(ctx['indexRef']))
 frozen_map={normalize_path(file):digest for file,digest in original_plan['sourceFiles'].items()}
 for selected in ctx['nativeNamespaceDerivation']['sourceRefs']:same(frozen_map.get(normalize_path(selected['file'])),selected['sha256'],'NAMESPACE_DERIVATION_SOURCE_NOT_FROZEN');validate_namespace_source(reader.raw(selected))
 reader.json(ctx['nativeNamespaceDerivation']['proofRef'])
 for value in records.values():same(value['contextRef'],handoff['contextRef'],'NEGATIVE_CONTEXT_JOIN')
 same(baseline['cancellationRef'],handoff['cancellationRef'],'BASELINE_CANCEL_JOIN');same(restore['cancellationRef'],handoff['cancellationRef'],'RESTORE_CANCEL_JOIN');same(restore['baselineRef'],handoff['baselineRef'],'RESTORE_BASELINE_JOIN')
 for value in (cancel,baseline):
  same(value['sourceCommit'],ctx['sourceCommit'],'NEGATIVE_SOURCE_JOIN');same(value['historicalCandidateReplacement'],ctx['historicalCandidateReplacement'],'HISTORICAL_IMAGE_HISTORY_JOIN');same(value['oldTargets'],ctx['targets'],'OLD_TARGET_JOIN');same(value['protectedEight'],ctx['protectedEight'],'PROTECTED_EIGHT_JOIN')
 same(cancel['operationRoot'],ctx['operationRoot'],'CANCEL_OPERATION');same(cancel['indexRef'],ctx['indexRef'],'CANCEL_INDEX');same(cancel['classification'],'KNOWN_NEGATIVE_CANCELLED','CANCEL_CLASSIFICATION')
 for key in ('successfulNativeClosure','nativeReapedClaimed','adoptsOriginalPopen'):same(cancel[key],False,'CANCEL_FALSE_NATIVE_CLAIM')
 same(baseline['adoptsOriginalPopen'],False,'BASELINE_ADOPTION');same(restore['nativeCompletionClaimed'],False,'RESTORE_NATIVE_CLAIM');same(restore['pendingSettled'],True,'RESTORE_PENDING_NOT_SETTLED')
 decoded,all_refs=inventories(reader,records,ctx)
 def required_child(reference):
  assert (normalize_path(reference['file']),reference['sha256'])in all_refs,'SEMANTIC_CHILD_OMITTED_FROM_INVENTORY'
 for kind,value in records.items():
  for key,reference in value['evidenceRefs'].items():
   if key not in ('oldOperationInventory','windowsControl','supervisorPlan','originalStart','originalClosed'):required_child(reference)
 c=cancel['evidenceRefs'];b=baseline['evidenceRefs'];r=restore['evidenceRefs'];initial,initial_rows=inspect_child(reader,c['initialInspection']);validate_services(ctx,initial_rows)
 old={v['Config']['Labels']['com.docker.compose.service']:v for v in initial if v['Config']['Labels']['com.docker.compose.service']in ROLES}
 for role,key in zip(ROLES,('stopCandidate','stopRetained')):
  cid=next(v['id']for v in ctx['targets']if v['service']==role);row,out,stdin=child(reader,c[key],['docker','container','stop','--signal=SIGTERM','--timeout=-1',cid]);same(out.decode().strip(),cid,'STOP_OUTPUT_ID_CHANGED');same(stdin,None,'STOP_STDIN')
 stopped,stopped_rows=inspect_child(reader,c['postStopInspection']);validate_services(ctx,stopped_rows,stopped=ROLES);validate_stopped_full(initial,stopped,ROLES);sql_child(reader,c['postStopSql'],ctx,ctx['targets'],after_stops=True)
 archive_inventory(reader,reader.inventory(c['oldOperationInventory'],ctx),ctx)
 windows=reader.json(c['windowsControl']);expected_windows={'format':'sabalan-c16-exact-windows-negative-control/v1','originalMasterPid':ctx['master']['pid'],'originalMasterBirth':ctx['master']['creationFiletime'],'kernelExitCode':125,'externallyCancelled':True,'originalSupervisorUntouched':True,'originalPopenAdopted':False,'originalExecKernelExitObserved':True,'originalExecParentReapingClaimed':False,'originalExecParentEofClaimed':False,'originalMasterParentEofClaimed':False,'nativeReapedClaimed':False,'qualificationClaimed':False,'productionAdmission':False};same(windows,expected_windows,'WINDOWS_NEGATIVE_CONTROL_JOIN')
 same(c['supervisorPlan'],ctx['originalSupervisor']['plan'],'SUPERVISOR_PLAN_JOIN');same(c['originalStart'],ctx['originalSupervisor']['started'],'ORIGINAL_START_JOIN');same(normalize_path(c['originalClosed']['file']),normalize_path(ctx['originalSupervisor']['futureClosedFile']),'ORIGINAL_CLOSED_PATH');plan=reader.json(c['supervisorPlan']);start=reader.json(c['originalStart']);closed=reader.json(c['originalClosed']);validate_original_negative_closed(ctx,start,closed);same(r['originalClosed'],c['originalClosed'],'RESTORE_ORIGINAL_CLOSURE_JOIN')
 same(plan['sourceCommit'],ctx['sourceCommit'],'ORIGINAL_PLAN_SOURCE_JOIN');same(start['sourceCommit'],ctx['sourceCommit'],'ORIGINAL_START_SOURCE_JOIN');same(start['masterSha256'],plan['masterSha256'],'ORIGINAL_MASTER_BYTES_JOIN');same(closed['passwordStored'],False,'ORIGINAL_PASSWORD_PERSISTED')
 for stream in ('stdout','stderr'):
  path=normalize_path(str(pathlib.Path(ctx['originalSupervisor']['futureClosedFile']).parent/(stream+'.log')));pins=[v for v in handoff['sourcePins']if normalize_path(v['originalPath'])==path];same(len(pins),1,'ORIGINAL_CLOSED_LOG_NOT_PRESERVED');raw=reader.raw(pins[0]['snapshotRef']);validate_log_projection(ctx,stream,raw,closed)
 # Every frozen application source was physically archived before cancellation.
 archived={normalize_path(x['originalPath']):x['sha256']for x in handoff['sourcePins']}
 for source,source_sha in plan['sourceFiles'].items():same(archived.get(normalize_path(source)),source_sha,'FROZEN_SOURCE_ARCHIVE_MISSING')
 actual,fresh_rows=inspect_child(reader,b['freshInspection']);same(fresh_rows,baseline['freshServices'],'FRESH_SERVICE_READBACK_JOIN');fresh={v['service']:v for v in fresh_rows if v['service']in ROLES};same(fresh,baseline['freshConfigurations'],'FRESH_CONFIGURATION_FINGERPRINT_JOIN');validate_services(ctx,fresh_rows,fresh=fresh);slots={v['Config']['Labels']['com.docker.compose.service']:v for v in actual if v['Config']['Labels']['com.docker.compose.service']in ROLES}
 cohort=baseline['authorityCohort'];shape(cohort,'nonce prepared verified','BASELINE_AUTHORITY_SCHEMA');cohort_nonce=nonce(cohort['nonce']);same(set(cohort['prepared']),set(ROLES),'AUTHORITY_PREPARED_ROLES');same(set(cohort['verified']),set(ROLES),'AUTHORITY_VERIFIED_ROLES')
 acceptance=baseline['acceptance'];shape(acceptance,'namedVolume subpath target createdRef verified empty','BASELINE_ACCEPTANCE_SCHEMA');same(acceptance['namedVolume'],ACCEPTANCE_VOLUME,'ACCEPTANCE_VOLUME');same(acceptance['target'],ACCEPTANCE_TARGET,'ACCEPTANCE_TARGET');same(acceptance['subpath'],'c16-recovery-'+cohort_nonce,'ACCEPTANCE_SUBPATH');same(acceptance['empty'],True,'ACCEPTANCE_EMPTY_CLAIM')
 configuration=child_json(reader,b['freshComposeConfigBefore']);same(child_json(reader,b['freshComposeConfigAfter']),configuration,'FRESH_COMPOSE_CHANGED_DURING_UP');validate_authority_configuration(configuration,cohort_nonce);validate_acceptance_configuration(configuration,cohort_nonce);validate_authority_slots(slots,cohort_nonce);validate_acceptance_slots(slots,cohort_nonce);validate_fresh_engine(old,slots,cohort_nonce)
 previous=reader.json(ctx['historicalCandidateReplacement']);same(previous['pass'],True,'HISTORIC_IMAGE_HISTORY_NOT_COMPLETED');same(previous['phase'],'COMPLETE','HISTORIC_IMAGE_HISTORY_NOT_COMPLETE')
 images=[];installed_source=source_raw(reader,handoff,'tests/online-deployment/installed-native-image-probe.fixture.mjs');quiet=quiet_source(reader,handoff)
 for role,key in zip(ROLES,('installedCandidate','installedRetained')):
  evidence=previous['roleEvidence']['candidate'if role==ROLES[0]else'main'];same(slots[role]['Image'],evidence['image'],'HISTORICAL_IMAGE_JOIN');material=reader.json({'file':evidence['materialReceiptFile'],'sha256':evidence['materialReceiptSha256']});image=reader.json({'file':evidence['imageReceiptFile'],'sha256':evidence['imageReceiptSha256']});images.append(image);value=child_json(reader,b[key],['docker','exec','-i',fresh[role]['id'],'node','--input-type=module'],installed_source);validate_installed(value,material)
  key='freshNativeQuietCandidate'if role==ROLES[0]else'freshNativeQuietRetained';validate_empty_native(child_json(reader,b[key],['docker','exec',fresh[role]['id'],'/usr/bin/python3','-I','-B','-c',quiet]))
 validate_image_inspection(child_json(reader,b['imageInspection'],['docker','image','inspect',*[v['image']for v in ctx['targets']]]),images);sql_child(reader,b['freshSql'],ctx,list(fresh.values()))
 authority_source=source_raw(reader,handoff,'tests/online-deployment/application-native-authority-cohort.fixture.py');namespace_source=source_raw(reader,handoff,'namespace_metadata.py');prepared={};verified={};acceptance_verified={}
 for role in ROLES:
  required_child(cohort['prepared'][role]);required_child(cohort['verified'][role]);required_child(acceptance['verified'][role]);kind='runtime'if role==ROLES[0]else'jobs';root='/app/qualification-authority-root'if kind=='runtime'else'/app/qualification-jobs-root';old_cid=next(v['id']for v in ctx['targets']if v['service']==role)
  prepared[role]=metadata_child(reader,cohort['prepared'][role],authority_source,{'mode':'create','kind':kind,'nonce':cohort_nonce,'root':root,'expected':None,'peerExpected':None},old_cid)
 for role in ROLES:
  peer=ROLES[1]if role==ROLES[0]else ROLES[0];kind='runtime'if role==ROLES[0]else'jobs';root='/app/qualification-authority-root'if kind=='runtime'else'/app/qualification-jobs-root'
  verified[role]=metadata_child(reader,cohort['verified'][role],authority_source,{'mode':'verify','kind':kind,'nonce':cohort_nonce,'root':root,'expected':prepared[role]['namespace'],'peerExpected':prepared[peer]['namespace']},fresh[role]['id'])
 required_child(acceptance['createdRef']);created=metadata_child(reader,acceptance['createdRef'],namespace_source,{'mode':'create','nonce':cohort_nonce,'expected':None},ctx['targets'][0]['id'])
 for role in ROLES:acceptance_verified[role]=metadata_child(reader,acceptance['verified'][role],namespace_source,{'mode':'verify','nonce':cohort_nonce,'expected':created['namespace']},fresh[role]['id'])
 authority_namespaces=validate_authority_results(prepared,verified,cohort_nonce);acceptance_namespace=validate_acceptance_results(created,acceptance_verified,cohort_nonce)
 for key in ('stopRef','pendingRef','bindingRef','originalOwnerSourceRef','originalVerifierSourceRef'):same(restore[key],ctx[key],'RESTORE_PROVENANCE_JOIN');reader.json(restore[key])if key.endswith('Ref')and key not in ('originalOwnerSourceRef','originalVerifierSourceRef')else reader.raw(restore[key])
 same(reader.raw(restore['externalRestorerSourceRef']),source_raw(reader,handoff,'resume_owner.py'),'EXTERNAL_RESTORER_SOURCE_JOIN')
 before,before_rows=inspect_child(reader,r['frontendBefore']);validate_services(ctx,before_rows,fresh=fresh);front=next(v for v in before if v['Config']['Labels']['com.docker.compose.service']=='frontend');stop=reader.json(ctx['stopRef']);same(front['Id'],stop['frontend']['id'],'ORIGINAL_STOP_FRONTEND_ID');same(front['State']['FinishedAt'],stop['stopped']['finishedAt'],'ORIGINAL_STOP_FINISH');same(front['State']['ExitCode'],stop['stopped']['exitCode'],'ORIGINAL_STOP_EXIT')
 child(reader,r['startFrontend'],['docker','start',front['Id']]);after,after_rows=inspect_child(reader,r['frontendAfter']);by={v['service']:v for v in after_rows};restored=by['frontend']
 for key in ('id','image','configurationSha256'):same(restored[key],next(v for v in ctx['protectedEight']if v['service']=='frontend')[key],'RESTORED_FRONTEND_CHANGED:'+key)
 assert restored['startedAt']!=next(v['startedAt']for v in ctx['protectedEight']if v['service']=='frontend'),'FRONTEND_NOT_NEWLY_STARTED';same(restored['running'],True,'RESTORED_FRONTEND_NOT_RUNNING');same(restored['health'],'healthy','RESTORED_FRONTEND_NOT_HEALTHY');assert type(restored['pid'])is int and restored['pid']>0
 for expected in ctx['protectedEight']:
  if expected['service']!='frontend':same(by[expected['service']],expected,'FOREIGN_RESTORE_IDENTITY_CHANGED')
 for role in ROLES:same(by[role],fresh[role],'FRESH_SLOT_CHANGED_DURING_RESTORE')
 for key in ('sameFrontendId','sameFrontendConfig','sameFrontendImage'):same(restore[key],True,'RESTORE_SAME_FRONTEND_CLAIM')
 same(restore['restoredFrontend'],restored,'RESTORED_FRONTEND_READBACK_JOIN');same(restore['protectedOtherNine'],[v for v in after_rows if v['service']!='frontend'],'RESTORED_OTHER_NINE_JOIN');sql_child(reader,r['restorationSql'],ctx,list(fresh.values()))
 bridge_stop=audit_all_children(reader,handoff,ctx,decoded,initial,slots,baseline)
 same(bridge_stop['stop'],stop,'CANONICAL_STOP_INPUT_JOIN');same(bridge_stop['frontend'],front,'CANONICAL_STOP_PHYSICAL_JOIN');same(bridge_stop['binding'],reader.json(ctx['bindingRef']),'CANONICAL_BINDING_JOIN');same(bridge_stop['plan'],plan,'CANONICAL_PLAN_JOIN');same(bridge_stop['start'],start,'CANONICAL_ORIGINAL_START_JOIN');same(bridge_stop['closed'],closed,'CANONICAL_ORIGINAL_CLOSED_JOIN');same(bridge_stop['currentBirth'],'ABSENT','CANONICAL_MASTER_ABSENCE_INPUT');same(bridge_stop['originalOwnerSha256'],ctx['originalOwnerSourceRef']['sha256'],'CANONICAL_OWNER_SOURCE_JOIN');same(bridge_stop['originalVerifierSha256'],ctx['originalVerifierSourceRef']['sha256'],'CANONICAL_VERIFIER_SOURCE_JOIN')
 assert not pathlib.Path(ctx['pendingRef']['file']).exists(),'PENDING_RESTORATION_NOT_ACTUALLY_SETTLED'
 reader.recheck()
 return {'format':'sabalan-c16-verified-negative-predecessor/v1','sourceCommit':ctx['sourceCommit'],'operationRoot':ctx['operationRoot'],'historicalCandidateReplacement':ctx['historicalCandidateReplacement'],'identities':{role:{k:fresh[role][k]for k in ('id','image','startedAt')}for role in ROLES},'qualificationSlots':fresh,'protectedEight':[v for v in after_rows if v['service']not in ROLES],'acceptance':{'namedVolume':ACCEPTANCE_VOLUME,'subpath':'c16-recovery-'+cohort_nonce,'target':ACCEPTANCE_TARGET,'nonce':cohort_nonce,'namespace':acceptance_namespace},'authorityCohort':{'nonce':cohort_nonce,'namespaces':authority_namespaces},'inputs':reader.inputs,'streamingInputs':reader.streaming,'qualificationSucceeded':False,'productionAdmission':False,'adoptsOriginalPopen':False}

def main():
 assert not sys.flags.optimize,'NONOPTIMIZED_VERIFIER_REQUIRED';same(len(sys.argv),4,'EXACT_VERIFIER_ARGUMENTS');same(sys.argv[1],'--verify-handoff','EXACT_VERIFIER_MODE');result=validate_handoff(sys.argv[2],sys.argv[3]);print(json.dumps(result,separators=(',',':')))
if __name__=='__main__':main()

