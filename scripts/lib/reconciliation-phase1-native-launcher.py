"""Fixed reviewed Phase 1 native parent. SOURCE-REVIEW ONLY; no live run.

External anchor must independently bind this bootstrap, manifest and review.
The hard stop remains until a reviewed anchor is supplied and the Node-side
parent/Job/guard witness verifier is connected and reviewed.
"""
from pathlib import Path
import ctypes as C, hashlib, importlib.util, json, os, re, subprocess, sys, tempfile, time, uuid, _winapi, msvcrt, threading, struct
from ctypes import wintypes as W

if os.name!='nt':raise SystemExit('WINDOWS_ONLY')
ROOT=Path(r'C:\Users\mahan\.codex\worktrees\phase1-existing-lease\sabalanerp')
REVIEW_ANCHOR=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102\phase1-reviewed-external-anchor.json')
# Digest is supplied by the separately reviewed fixed bootstrap, which must
# independently validate the external record and this source before spawn.
REVIEWED_EXTERNAL_ANCHOR_SHA256=None
NODE=Path(r'C:\Program Files\nodejs\node.exe')
NODE_SHA256='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9'
SUPPORT=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102\finite-bridge-windows-v11-UNEXECUTED.py')
SUPPORT_SHA256='8250681666ea5f5ac6859fb8967d26c1c7720b32821c6c52ec12c964182a88e6'
SOURCE_NAMES=('reconciliation-phase1-operational.mjs','reconciliation-phase1-core.mjs','reconciliation-readonly-phase1-cli.mjs','reconciliation-phase1-census.ps1','reconciliation-phase1-evidence.ps1','reconciliation-phase1-lock-identity.ps1','serial-physical/host-lease.mjs','serial-physical/host-lease.ps1','reconciliation-phase1-verify.mjs','reconciliation-phase1-source-proof.ps1','reconciliation-phase1-launcher.mjs','reconciliation-phase1-review-anchor.mjs')
K=C.WinDLL('kernel32',use_last_error=True)
K.CreateJobObjectW.argtypes=[C.c_void_p,W.LPCWSTR];K.CreateJobObjectW.restype=W.HANDLE
K.AssignProcessToJobObject.argtypes=[W.HANDLE,W.HANDLE];K.AssignProcessToJobObject.restype=W.BOOL
K.ResumeThread.argtypes=[W.HANDLE];K.ResumeThread.restype=W.DWORD
K.TerminateJobObject.argtypes=[W.HANDLE,W.UINT];K.TerminateJobObject.restype=W.BOOL
K.TerminateProcess.argtypes=[W.HANDLE,W.UINT];K.TerminateProcess.restype=W.BOOL
K.WaitForSingleObject.argtypes=[W.HANDLE,W.DWORD];K.WaitForSingleObject.restype=W.DWORD
K.GetExitCodeProcess.argtypes=[W.HANDLE,C.POINTER(W.DWORD)];K.GetExitCodeProcess.restype=W.BOOL
K.CloseHandle.argtypes=[W.HANDLE];K.CloseHandle.restype=W.BOOL
class JobAccounting(C.Structure):
 _fields_=[('user',C.c_longlong),('kernel',C.c_longlong),('periodUser',C.c_longlong),('periodKernel',C.c_longlong),('faults',W.DWORD),('total',W.DWORD),('active',W.DWORD),('terminated',W.DWORD)]
K.QueryInformationJobObject.argtypes=[W.HANDLE,C.c_int,C.c_void_p,W.DWORD,C.c_void_p];K.QueryInformationJobObject.restype=W.BOOL
K.GetProcessTimes.argtypes=[W.HANDLE,C.POINTER(W.FILETIME),C.POINTER(W.FILETIME),C.POINTER(W.FILETIME),C.POINTER(W.FILETIME)];K.GetProcessTimes.restype=W.BOOL
K.GetCurrentProcess.argtypes=[];K.GetCurrentProcess.restype=W.HANDLE

def process_birth(handle):
 created,exited,kernel,user=W.FILETIME(),W.FILETIME(),W.FILETIME(),W.FILETIME()
 if not K.GetProcessTimes(handle,C.byref(created),C.byref(exited),C.byref(kernel),C.byref(user)):raise OSError(C.get_last_error(),'PROCESS_BIRTH')
 return (int(created.dwHighDateTime)<<32)|int(created.dwLowDateTime)

def job_members(job):
 raw=C.create_string_buffer(8+128*C.sizeof(C.c_size_t))
 if not K.QueryInformationJobObject(job,3,raw,len(raw),None):raise OSError(C.get_last_error(),'JOB_MEMBER_QUERY')
 assigned,count=struct.unpack_from('<II',raw.raw,0)
 if assigned!=count or count>128:raise RuntimeError('JOB_MEMBERS_UNPROVEN')
 fmt='<Q' if C.sizeof(C.c_size_t)==8 else '<I'
 return [struct.unpack_from(fmt,raw.raw,8+i*C.sizeof(C.c_size_t))[0] for i in range(count)]

K.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];K.OpenProcess.restype=W.HANDLE
K.QueryFullProcessImageNameW.argtypes=[W.HANDLE,W.DWORD,W.LPWSTR,C.POINTER(W.DWORD)];K.QueryFullProcessImageNameW.restype=W.BOOL
N=C.WinDLL('ntdll',use_last_error=True)
class ProcessBasic(C.Structure):
 _fields_=[('status',C.c_void_p),('peb',C.c_void_p),('affinity',C.c_void_p),('priority',C.c_void_p),('pid',C.c_void_p),('parent',C.c_void_p)]
N.NtQueryInformationProcess.argtypes=[W.HANDLE,W.DWORD,C.c_void_p,W.ULONG,C.POINTER(W.ULONG)];N.NtQueryInformationProcess.restype=C.c_long

def witness_fixture_helper(job,launcherPid,fixtureRoot,fixtureRun,sourceDir):
 src=fixtureRoot/'fixture-lease-self.json';target=fixtureRoot/'fixture-lease-job-proof.json'
 if target.exists() or not src.exists():return
 st=src.lstat()
 if not src.is_file() or src.is_symlink() or st.st_nlink!=1 or st.st_size>16384:raise RuntimeError('FIXTURE_SELF_INVALID')
 proof=json.loads(src.read_bytes());pid=proof.get('pid');members=job_members(job)
 if proof.get('format')!='phase1-fixture-lease-self/v1' or proof.get('fixtureOnly') is not True or proof.get('runId')!=fixtureRun or proof.get('parentPid')!=launcherPid or not isinstance(pid,int) or pid not in members:raise RuntimeError('FIXTURE_SELF_BINDING')
 handle=K.OpenProcess(0x1000,False,pid)
 if not handle:raise OSError(C.get_last_error(),'FIXTURE_HELPER_OPEN')
 try:
  info=ProcessBasic();returned=W.ULONG();name=C.create_unicode_buffer(32768);length=W.DWORD(len(name))
  if N.NtQueryInformationProcess(handle,0,C.byref(info),C.sizeof(info),C.byref(returned))!=0 or not K.QueryFullProcessImageNameW(handle,0,name,C.byref(length)):raise RuntimeError('FIXTURE_HELPER_IDENTITY')
  birth=str(process_birth(handle));exeHash=sha(Path(name.value));helperHash=sha(sourceDir/'serial-physical/host-lease.ps1')
  if birth!=proof.get('birth100ns') or int(info.parent or 0)!=launcherPid or exeHash!=proof.get('executableSha256') or helperHash!=proof.get('helperSha256'):raise RuntimeError('FIXTURE_HELPER_MISMATCH')
  record={'format':'phase1-fixture-lease-job-proof/v1','fixtureOnly':True,'runId':fixtureRun,'pid':pid,'birth100ns':birth,'parentPid':launcherPid,'jobMembers':members,'jobEvidence':'SUPERVISOR_HANDLE_QUERY','helperSha256':helperHash,'executableSha256':exeHash,'source':'PARENT_REPORTED','pathRace':'UNPROVEN'}
 finally:
  if not K.CloseHandle(handle):raise OSError(C.get_last_error(),'FIXTURE_HELPER_CLOSE')
 raw=json.dumps(record,sort_keys=True).encode()
 with target.open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())

def active(job):
 info=JobAccounting()
 if not K.QueryInformationJobObject(job,1,C.byref(info),C.sizeof(info),None):raise OSError(C.get_last_error(),'JOB_QUERY')
 return info.active

def validate_receipts(a,b,outputFileId):
 required={'format','stage','oldObligation','historicalEof','safeState','ownLeaseClosure','scopeReuse','productionAdmission','outputRootFileId','newLease','actorCoverage','closure','evidence','directoryDurability','acl'}
 if set(a)!=required or set(b)!=required or a.get('format')!='phase1-audit-record/v1' or b.get('format')!='phase1-audit-record/v1':raise RuntimeError('AUDIT_SCHEMA_INVALID')
 if a.get('outputRootFileId')!=outputFileId or b.get('outputRootFileId')!=outputFileId or a.get('safeState')!='UNKNOWN' or b.get('safeState')!='UNKNOWN' or a.get('scopeReuse') is not False or b.get('scopeReuse') is not False or a.get('productionAdmission') is not False or b.get('productionAdmission') is not False:raise RuntimeError('AUDIT_POLICY_INVALID')
 if a.get('ownLeaseClosure')!='UNKNOWN' or a.get('closure') is not None or a.get('evidence')!=b.get('evidence') or a.get('actorCoverage')!=b.get('actorCoverage'):raise RuntimeError('AUDIT_RECORD_MISMATCH')
 coverage=a.get('actorCoverage')
 if not isinstance(coverage,dict) or set(coverage)!={'scope','knownMatches','unreadableRelevant','unreadableRelevance','wslNative','processSourceSha256'} or coverage.get('scope')!='KNOWN_OPERATION_ENTRIES_ONLY' or coverage.get('knownMatches')!=0 or not isinstance(coverage.get('unreadableRelevant'),int) or coverage['unreadableRelevant']<0 or coverage.get('unreadableRelevance')!='UNKNOWN' or coverage.get('wslNative')!='NOT_GLOBAL_CENSUS' or not re.fullmatch('[a-f0-9]{64}',coverage.get('processSourceSha256','')):raise RuntimeError('AUDIT_COVERAGE_INVALID')
 if a.get('directoryDurability')!='UNKNOWN' or b.get('directoryDurability')!='UNKNOWN' or a.get('acl')!='UNVERIFIED_DEFAULT' or b.get('acl')!='UNVERIFIED_DEFAULT':raise RuntimeError('AUDIT_LIMITATIONS_INVALID')
 evidence=a.get('evidence')
 if not isinstance(evidence,list) or len(evidence)!=2 or [x.get('label') for x in evidence]!=['baseline','roleHeld']:raise RuntimeError('AUDIT_EVIDENCE_INVALID')
 for item in evidence:
  if set(item)!={'label','bytes','sha256','fileId','sourceSha256','pathSnapshot','concurrentContentMutation'} or not isinstance(item['bytes'],int) or not 0<=item['bytes']<=16777216 or not re.fullmatch('[a-f0-9]{64}',item['sha256']) or not re.fullmatch('[a-f0-9]{64}',item['sourceSha256']) or not re.fullmatch(r'\d+:[a-f0-9]{32}',item['fileId']) or item['pathSnapshot']!='NONATOMIC_ANCESTOR_UNPROVEN' or item['concurrentContentMutation']!='UNPROVEN':raise RuntimeError('AUDIT_EVIDENCE_INVALID')
 closure=b.get('closure');lease=b.get('newLease')
 if a.get('stage')!='PRE_RELEASE' or b.get('stage')!='OWN_LEASE_CLOSED' or b.get('ownLeaseClosure')!='CALLER_REPORTED_NOT_INDEPENDENT' or not isinstance(closure,dict) or not isinstance(lease,dict):raise RuntimeError('AUDIT_RECEIPT_INVALID')
 if closure.get('pid')!=lease.get('originalPid') or closure.get('exitCode')!=0 or closure.get('signal') is not None or closure.get('stdoutEof') is not True or closure.get('stderrEof') is not True or closure.get('closeMarker')!='LEASE_CLOSED' or closure.get('evidenceType')!='ORIGINAL_PARENT_REPORTED':raise RuntimeError('OWN_LEASE_CLOSURE_UNPROVEN')
 if set(lease)!={'fileId','originalPid','lockIdentitySourceSha256','birth'} or not re.fullmatch(r'\d+:[a-f0-9]{32}',lease.get('fileId','')) or not re.fullmatch('[a-f0-9]{64}',lease.get('lockIdentitySourceSha256','')) or not isinstance(lease.get('originalPid'),int) or lease['originalPid']<=0 or lease.get('birth')!='UNKNOWN':raise RuntimeError('AUDIT_LEASE_INVALID')
 if set(closure)!={'pid','birth100ns','exitCode','signal','stdoutEof','stderrEof','closeMarker','observedAt','evidenceType'} or not (closure.get('birth100ns')=='UNKNOWN' or re.fullmatch(r'\d{16,20}',closure.get('birth100ns',''))) or not re.fullmatch(r'\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z',closure.get('observedAt','')):raise RuntimeError('AUDIT_CLOSURE_SCHEMA')
 if a.get('newLease')!=lease or a.get('oldObligation')!='RETAINED_UNRESOLVED' or b.get('oldObligation')!='RETAINED_UNRESOLVED' or a.get('historicalEof')!='UNKNOWN' or b.get('historicalEof')!='UNKNOWN':raise RuntimeError('AUDIT_RECEIPT_BINDING')

def child_observer_closed(result,errors):
 return (result.get('exitCode')==0 and not result.get('timeout') and result.get('stdoutEof') is True and result.get('stderrEof') is True
         and not errors and result.get('jobActive')==0 and set(result.get('closeResults',{}))=={'thread','process','job'}
         and all(value=='CLOSED' for value in result['closeResults'].values()))

def run_guarded_child(sourceDir,outputRoot,outputFileId,fixtureRun=None):
 # This fixed child is created suspended and assigned to its own Job before
 # any source executes. Files are already pinned by the calling parent.
 job=K.CreateJobObjectW(None,None)
 if not job:raise OSError(C.get_last_error(),'JOB_CREATE')
 proc=thread=None;readers=[];openRead=set();openWrite=set();nullfd=None;buffers={'stdout':bytearray(),'stderr':bytearray()};eof={'stdout':False,'stderr':False};errors=[];assigned=False;resumed=False
 result={'status':'UNKNOWN','outputRoot':str(outputRoot),'childBirth':'UNKNOWN','crashDurability':'UNKNOWN'}
 try:
  streams={}
  for name in ('stdout','stderr'):
   rd,wr=os.pipe();openRead.add(rd);openWrite.add(wr);os.set_inheritable(wr,True);streams[name]=(rd,wr)
  nullfd=os.open(os.devnull,os.O_RDONLY);os.set_inheritable(nullfd,True)
  si=subprocess.STARTUPINFO();si.dwFlags|=subprocess.STARTF_USESTDHANDLES
  si.hStdInput=msvcrt.get_osfhandle(nullfd);si.hStdOutput=msvcrt.get_osfhandle(streams['stdout'][1]);si.hStdError=msvcrt.get_osfhandle(streams['stderr'][1]);si.lpAttributeList={'handle_list':[si.hStdInput,si.hStdOutput,si.hStdError]}
  args=[str(NODE),str(sourceDir/'reconciliation-phase1-launcher.mjs')]
  if fixtureRun is not None:args+=['--reviewed-fixture',fixtureRun]
  command=subprocess.list2cmdline(args)
  env={'SystemRoot':os.environ['SystemRoot'],'TEMP':str(outputRoot.parent),'TMP':str(outputRoot.parent),'PATH':r'C:\Windows\System32;C:\Windows','SABALAN_PHASE1_OUTPUT_ROOT':str(outputRoot)}
  proc,thread,pid,tid=_winapi.CreateProcess(str(NODE),command,None,None,True,0x00000004|0x08000000,env,None,si)
  result.update(childPid=pid,threadId=tid,createdSuspended=True)
  if not K.AssignProcessToJobObject(job,proc):raise OSError(C.get_last_error(),'JOB_ASSIGN')
  assigned=True;result['assignedBeforeResume']=True
  if fixtureRun is not None:
   fixtureRoot=outputRoot.parent/('sabalan-phase1-fixture-'+fixtureRun)
   members=job_members(job)
   if pid not in members:raise RuntimeError('FIXTURE_LAUNCHER_NOT_IN_JOB')
   proof={'format':'phase1-fixture-owner-proof/v1','fixtureOnly':True,'runId':fixtureRun,'launcherPid':pid,'launcherBirth100ns':str(process_birth(proc)),'parentPid':os.getpid(),'parentBirth100ns':str(process_birth(K.GetCurrentProcess())),'jobAssignedBeforeResume':True,'jobMembers':members,'jobEvidence':'SUPERVISOR_HANDLE_QUERY','launcherSha256':sha(sourceDir/'reconciliation-phase1-launcher.mjs'),'nodeSha256':NODE_SHA256,'authority':'PARENT_REPORTED_FIXED_TEST_ROLE','pathRace':'UNPROVEN'}
   raw=json.dumps(proof,sort_keys=True).encode()
   with (fixtureRoot/'fixture-owner-proof.json').open('xb') as out:out.write(raw);out.flush();os.fsync(out.fileno())
  for _,wr in streams.values():os.close(wr);openWrite.remove(wr)
  os.close(nullfd);nullfd=None
  def drain(name,fd):
   try:
    with os.fdopen(fd,'rb',closefd=True) as stream:
     while True:
      chunk=stream.read(4096)
      if not chunk:eof[name]=True;return
      room=65536-len(buffers[name]);buffers[name].extend(chunk[:max(room,0)])
      if len(chunk)>room and name+':BOUND' not in errors:errors.append(name+':BOUND')
   except BaseException as error:errors.append(name+':'+type(error).__name__)
  for name,(rd,_) in streams.items():
   t=threading.Thread(target=drain,args=(name,rd));t.start();readers.append(t);openRead.remove(rd)
  if K.ResumeThread(thread)==0xffffffff:raise OSError(C.get_last_error(),'RESUME')
  resumed=True
  deadline=time.monotonic()+30
  wait=K.WaitForSingleObject(proc,100)
  while wait==258 and time.monotonic()<deadline:
   if fixtureRun is not None:witness_fixture_helper(job,pid,outputRoot.parent/('sabalan-phase1-fixture-'+fixtureRun),fixtureRun,sourceDir)
   wait=K.WaitForSingleObject(proc,100)
  if wait==258:
   result['timeout']=True
   # A running Job may include this audit's own lease child. Timeout does not
   # authorize terminating it or treating process-tree closure as lease release.
   result['status']='UNKNOWN_RETAINING_CUSTODY'
   while wait==258:wait=K.WaitForSingleObject(proc,1000)
  code=W.DWORD()
  if wait!=0 or not K.GetExitCodeProcess(proc,C.byref(code)):raise RuntimeError('CHILD_WAIT_UNKNOWN')
  result.update(exitCode=int(code.value),processWait=0)
 except BaseException as error:
  result['failureType']=type(error).__name__ if type(error).__name__ in ('OSError','RuntimeError','ValueError') else 'OTHER'
  if proc is not None and not resumed and K.WaitForSingleObject(proc,0)!=0:
   # Before resume no audit or lease can have started in this child.
   result['preResumeCleanupRequested']=bool(K.TerminateProcess(proc,82))
  for fd in tuple(openWrite):
   try:os.close(fd);openWrite.remove(fd)
   except OSError:result['writerClose']='UNKNOWN'
  for fd in tuple(openRead):
   try:os.close(fd);openRead.remove(fd)
   except OSError:result['readerClose']='UNKNOWN'
  if nullfd is not None:
   try:os.close(nullfd)
   except OSError:result['stdinClose']='UNKNOWN'
 finally:
  try:result['jobActiveAtCleanup']=active(job) if assigned else 0
  except BaseException:result['jobQuery']='UNKNOWN'
  # Never drop original handles on an ambiguous child, live descendant or pipe.
  while proc is not None:
   try:count=active(job) if assigned else 0
   except BaseException:count='UNKNOWN'
   if K.WaitForSingleObject(proc,0)==0 and count==0 and not any(t.is_alive() for t in readers):break
   result['status']='UNKNOWN_RETAINING_CUSTODY';time.sleep(.1)
  result.update(stdoutEof=eof['stdout'],stderrEof=eof['stderr'],readerErrors=errors,
   stdoutCapturedSha256=hashlib.sha256(buffers['stdout']).hexdigest(),stderrCapturedSha256=hashlib.sha256(buffers['stderr']).hexdigest(),
   capturedHashesComplete=not errors,jobActive=0 if proc is not None else 'UNKNOWN')
  result['closeResults']={}
  for label,h in (('thread',thread),('process',proc),('job',job)):
   if h is not None:result['closeResults'][label]='CLOSED' if K.CloseHandle(h) else 'UNKNOWN'
  # A closed process only establishes observer facts, not a qualified audit.
  if any(v!='CLOSED' for v in result['closeResults'].values()):result['status']='UNKNOWN'
 if child_observer_closed(result,errors):
  try:
   payload=json.loads(bytes(buffers['stdout']).decode('utf-8'))
   pre=outputRoot/'PRE_RELEASE.json';closed=outputRoot/'OWN_LEASE_CLOSED.json'
   if payload.get('format')!='phase1-own-audit-result/v1' or Path(payload.get('pre',''))!=pre or Path(payload.get('closed',''))!=closed or payload.get('oldObligation')!='RETAINED_UNRESOLVED' or payload.get('historicalEof')!='UNKNOWN' or payload.get('safeState')!='UNKNOWN':raise RuntimeError('AUDIT_OUTPUT_INVALID')
   preBytes=pre.read_bytes();closedBytes=closed.read_bytes()
   if len(preBytes)>65536 or len(closedBytes)>65536:raise RuntimeError('AUDIT_RECEIPT_BOUND')
   a=json.loads(preBytes);b=json.loads(closedBytes)
   validate_receipts(a,b,outputFileId)
   result['status']='OWN_AUDIT_CLOSED_PARENT_REPORTED';result['preReceiptSha256']=hashlib.sha256(preBytes).hexdigest();result['closedReceiptSha256']=hashlib.sha256(closedBytes).hexdigest()
  except BaseException:result['status']='UNKNOWN';result['auditReceipt']='UNPROVEN'
 return result

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def load_fixed_module(name,p,expected):
 if sha(p)!=expected:raise RuntimeError('BOOTSTRAP_SOURCE_MISMATCH')
 spec=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def verify_package(package,completeDigest):
 completeBytes=(package/'COMPLETE.json').read_bytes()
 if len(completeBytes)>65536 or hashlib.sha256(completeBytes).hexdigest()!=completeDigest:raise RuntimeError('COMPLETE_DIGEST_MISMATCH')
 complete=json.loads(completeBytes);expectedNames=('phase1-reviewed-evidence.json','phase1-reviewed-source-index.json','phase1-reviewed-manifest.json','phase1-reviewed-external-anchor.json')
 if complete.get('format')!='phase1-package-complete/v1' or set(complete.get('files',{}))!=set(expectedNames):raise RuntimeError('COMPLETE_SCHEMA_MISMATCH')
 for name in expectedNames:
  if sha(package/name)!=complete['files'][name]:raise RuntimeError('PACKAGE_FILE_MISMATCH')
 return complete

def main():
 global REVIEWED_EXTERNAL_ANCHOR_SHA256
 if len(sys.argv) not in (7,9) or sys.argv[1]!='--review-digest' or not re.fullmatch('[a-f0-9]{64}',sys.argv[2]) or sys.argv[3]!='--package-id' or not re.fullmatch('[a-f0-9]{32}',sys.argv[4]) or sys.argv[5]!='--complete-digest' or not re.fullmatch('[a-f0-9]{64}',sys.argv[6]):raise RuntimeError('FIXED_REVIEW_DIGEST_REQUIRED')
 fixtureRun=None
 if len(sys.argv)==9:
  if sys.argv[7]!='--fixture-run' or not re.fullmatch('[a-f0-9]{32}',sys.argv[8]):raise RuntimeError('FIXTURE_RUN_INVALID')
  fixtureRun=sys.argv[8]
 REVIEWED_EXTERNAL_ANCHOR_SHA256=sys.argv[2]
 packageBase=REVIEW_ANCHOR.parent if fixtureRun is None else Path(tempfile.gettempdir())/('sabalan-phase1-package-root-'+fixtureRun)
 package=packageBase/('phase1-package-'+sys.argv[4]);verify_package(package,sys.argv[6])
 reviewAnchor=package/'phase1-reviewed-external-anchor.json'
 anchorBytes=reviewAnchor.read_bytes()
 if len(anchorBytes)>65536 or hashlib.sha256(anchorBytes).hexdigest()!=REVIEWED_EXTERNAL_ANCHOR_SHA256:raise RuntimeError('EXTERNAL_REVIEW_DIGEST_MISMATCH')
 anchor=json.loads(anchorBytes)
 if anchor.get('format')!='phase1-external-review/v1':raise RuntimeError('EXTERNAL_REVIEW_SCOPE')
 if fixtureRun is None:
  if anchor.get('operation')!='a0d2baba08ec7e004d1458675799db6a' or anchor.get('action')!='READ_ONLY_AUDIT_NEW_OWN_LEASE':raise RuntimeError('EXTERNAL_REVIEW_SCOPE')
 else:
  if anchor.get('testOnly') is not True or anchor.get('operation')!='TEST_ONLY' or anchor.get('action')!='FIXTURE_AUDIT':raise RuntimeError('FIXTURE_REVIEW_SCOPE')
 # Values in this file must refer to a separately retained review record;
 # the mere presence of a caller-provided Boolean is never accepted.
 if not isinstance(anchor.get('reviewEvidenceSha256'),str) or len(anchor['reviewEvidenceSha256'])!=64:raise RuntimeError('REVIEW_EVIDENCE_MISSING')
 reviewEvidence=package/'phase1-reviewed-evidence.json'
 if sha(reviewEvidence)!=anchor['reviewEvidenceSha256']:raise RuntimeError('REVIEW_EVIDENCE_DIGEST_MISMATCH')
 reviewBytes=reviewEvidence.read_bytes();review=json.loads(reviewBytes)
 expectedEffects=['METADATA_OPEN_FIXED_LEASE','EXCLUSIVE_OWN_LEASE','READ_TWO_FIXED_FILES','CREATE_OWN_AUDIT_RECORDS']
 if review.get('format')!='phase1-derived-review-transcription/v1' or review.get('verdictScope')!='LIMITED_SOURCE_REVIEW' or review.get('liveExecutionAuthorized') is not False or review.get('allowedEffects')!=expectedEffects:raise RuntimeError('REVIEW_EVIDENCE_SCOPE_INVALID')
 indexPath=package/'phase1-reviewed-source-index.json';indexBytes=indexPath.read_bytes()
 if len(indexBytes)>65536 or hashlib.sha256(indexBytes).hexdigest()!=anchor.get('sourceIndexSha256') or review.get('sourceIndexSha256')!=anchor.get('sourceIndexSha256'):raise RuntimeError('SOURCE_INDEX_DIGEST_MISMATCH')
 index=json.loads(indexBytes)
 manifestPath=package/'phase1-reviewed-manifest.json';manifestBytes=manifestPath.read_bytes()
 if len(manifestBytes)>65536 or hashlib.sha256(manifestBytes).hexdigest()!=anchor.get('manifestSha256'):raise RuntimeError('MANIFEST_DIGEST_MISMATCH')
 manifest=json.loads(manifestBytes)
 if fixtureRun is not None and (review.get('testOnly') is not True or manifest.get('testOnly') is not True or manifest.get('runId')!=fixtureRun):raise RuntimeError('FIXTURE_BINDING_INVALID')
 if manifest.get('operation')!=anchor['operation'] or manifest.get('action')!=anchor['action'] or manifest.get('reviewEvidenceSha256')!=anchor['reviewEvidenceSha256']:raise RuntimeError('MANIFEST_SCOPE')
 pins=anchor.get('sourcePins')
 if not isinstance(pins,dict) or tuple(pins.keys())!=SOURCE_NAMES:raise RuntimeError('SOURCE_ALLOWLIST')
 indexed={item.get('path'):item.get('sha256') for item in index.get('sources',[])}
 if any(indexed.get(name)!=pins[name] for name in SOURCE_NAMES):raise RuntimeError('REVIEWED_INDEX_SOURCE_MISMATCH')
 manifestSources=manifest.get('sources')
 if not isinstance(manifestSources,list) or len(manifestSources)!=len(SOURCE_NAMES)-2:raise RuntimeError('MANIFEST_SOURCE_LIST')
 if {item.get('path'):item.get('sha256') for item in manifestSources}!={name:pins[name] for name in SOURCE_NAMES[:-2]}:raise RuntimeError('MANIFEST_SOURCE_BINDING')
 if sha(NODE)!=NODE_SHA256 or anchor.get('nodeSha256')!=NODE_SHA256:raise RuntimeError('NODE_RUNTIME_MISMATCH')
 support=load_fixed_module('fixture_directory_support',SUPPORT,SUPPORT_SHA256)
 guardPath=ROOT/'scripts/lib/reconciliation-phase1-native-guard.py'
 guard=load_fixed_module('phase1_native_guard',guardPath,anchor.get('nativeGuardSha256'))
 tmp=Path(tempfile.gettempdir()).absolute()
 if str(tmp).lower()!=r'c:\users\mahan\appdata\local\temp':raise RuntimeError('TEMP_PARENT_MISMATCH')
 support.no_reparse(tmp);sourceRoot=tmp/('sabalan-phase1-source-'+uuid.uuid4().hex);outputRoot=tmp/('sabalan-phase1-output-'+(fixtureRun or uuid.uuid4().hex))
 support.create_private(sourceRoot);support.create_private(outputRoot);sourceId=support.root_identity(sourceRoot);outputId=support.root_identity(outputRoot)
 sourceDir=sourceRoot/'scripts/lib'
 for name in SOURCE_NAMES:
  origin=ROOT/'scripts/lib'/name;support.no_reparse(origin);data=origin.read_bytes()
  if hashlib.sha256(data).hexdigest()!=pins[name]:raise RuntimeError('SOURCE_PIN_MISMATCH')
  dest=sourceDir/name;dest.parent.mkdir(parents=True,exist_ok=True);support.no_reparse(dest.parent);support.write_bytes(dest,data)
 support.write_bytes(sourceDir/'reconciliation-phase1-reviewed-intent.json',manifestBytes)
 support.write_bytes(sourceDir/'reconciliation-phase1-external-anchor.json',anchorBytes)
 support.write_bytes(sourceDir/'reconciliation-phase1-review-evidence.json',reviewBytes)
 support.write_bytes(sourceDir/'reconciliation-phase1-source-index.json',indexBytes)
 if support.root_identity(sourceRoot)!=sourceId or support.root_identity(outputRoot)!=outputId:raise RuntimeError('ROOT_IDENTITY_CHANGED')
 protected={('scripts/lib/'+name):pins[name] for name in SOURCE_NAMES}
 protected['scripts/lib/reconciliation-phase1-reviewed-intent.json']=hashlib.sha256(manifestBytes).hexdigest()
 protected['scripts/lib/reconciliation-phase1-external-anchor.json']=hashlib.sha256(anchorBytes).hexdigest()
 protected['scripts/lib/reconciliation-phase1-review-evidence.json']=hashlib.sha256(reviewBytes).hexdigest()
 protected['scripts/lib/reconciliation-phase1-source-index.json']=hashlib.sha256(indexBytes).hexdigest()
 outputGuard=guard.GuardedOutputDirectory(outputRoot)
 try:held=guard.GuardedSourceCopies(sourceRoot,protected)
 except BaseException:
  outputGuard.close();raise
 # The parent owns held until the original launched child and all inherited
 # readers have actually closed. No bare-PID kill or pathname-only release.
 result=None;primaryError=None;sourceClose='UNKNOWN';outputClose='UNKNOWN'
 try:
  receipt={'format':'phase1-native-staging/v1','operation':anchor['operation'],'manifestSha256':anchor['manifestSha256'],'reviewEvidenceSha256':anchor['reviewEvidenceSha256'],'sourceRoot':str(sourceRoot),'outputRoot':str(outputRoot),'outputRootFileId':outputGuard.identity,'guardedFileIds':held.identities,'sourceRaceBeforeGuard':'UNPROVEN','directoryDurability':'UNKNOWN'}
  support.write_bytes(outputRoot/'staging.json',json.dumps(receipt,sort_keys=True).encode())
  # The parent remains in this try/finally, holding the same native guards
  # while the fixed staged launcher and its Job are observed to closure.
  # The staged JS currently retains its own source/authority fail-closed gate.
  result=run_guarded_child(sourceDir,outputRoot,outputGuard.identity,fixtureRun)
  support.write_bytes(outputRoot/'native-child-observation.json',json.dumps(result,sort_keys=True).encode())
  if result.get('status')!='OWN_AUDIT_CLOSED_PARENT_REPORTED':
   raise RuntimeError('GUARDED_CHILD_OR_AUDIT_UNPROVEN')
 except BaseException as error:
  primaryError=error
 finally:
  try:held.close();sourceClose='CLOSED'
  except BaseException:sourceClose='UNKNOWN'
  try:outputGuard.close();outputClose='CLOSED'
  except BaseException:outputClose='UNKNOWN'
 terminal={'format':'phase1-native-terminal/v1','status':'UNKNOWN','sourceGuardClose':sourceClose,'outputGuardClose':outputClose,
  'childObservationStatus':result.get('status','UNKNOWN') if isinstance(result,dict) else 'UNKNOWN',
  'historicalEof':'UNKNOWN','oldObligation':'RETAINED_UNRESOLVED','directoryDurability':'UNKNOWN'}
 if primaryError is None and sourceClose=='CLOSED' and outputClose=='CLOSED' and terminal['childObservationStatus']=='OWN_AUDIT_CLOSED_PARENT_REPORTED':terminal['status']='OWN_AUDIT_CLOSED_PARENT_REPORTED'
 try:
  if support.root_identity(outputRoot)!=outputId:raise RuntimeError('OUTPUT_ROOT_CHANGED')
  support.write_bytes(outputRoot/'native-terminal-observation.json',json.dumps(terminal,sort_keys=True).encode())
 except BaseException:raise RuntimeError('TERMINAL_PERSISTENCE_UNKNOWN')
 if primaryError is not None or terminal['status']=='UNKNOWN':raise RuntimeError('PHASE1_TERMINAL_UNKNOWN') from primaryError

if __name__=='__main__':main()
