"""Independent canonical plan under the SAME existing drill/storage OFDs."""


def backup_storage_emit(value):
 raw=(json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode();need(len(raw)<=2*1024**2)
 need(sys.stdout.buffer.write(raw)==len(raw));sys.stdout.buffer.flush()


def storage_mount_identity(target):
 import re
 records=[]
 decode=lambda value:re.sub(r'\\([0-7]{3})',lambda m:chr(int(m.group(1),8)),value)
 for line in Path('/proc/self/mountinfo').read_text().splitlines():
  left,right=line.split(' - ',1);fields=left.split();tail=right.split();mount=Path(decode(fields[4]))
  if target==mount or target.is_relative_to(mount):records.append(dict(mountId=fields[0],deviceMajorMinor=fields[2],mountRoot=decode(fields[3]),mountPoint=str(mount),filesystem=tail[0],source=decode(tail[1])))
 need(records);return max(records,key=lambda row:len(Path(row['mountPoint']).parts))


def run_backup_preflight():
 import io,signal
 need(sys.platform=='linux' and os.getuid()==0 and not sys.flags.optimize);os.umask(0o077)
 h=ImageHost();safe=False;handlers={};gate=None;failure=None;budget=None;filesystem=None
 try:
  def cancel(_number,_frame):h.interrupted=True
  for number in [signal.SIGINT,signal.SIGTERM]:handlers[number]=signal.signal(number,cancel)
  h.acquire();h.lock_guard();configuration=STORAGE_CONFIGURATION
  parent=private_directory(PARENT);root=Path('/srv/sabalanerp-recovery');need(root.resolve(strict=True)==root)
  assert root.stat().st_dev==PARENT.stat().st_dev,'SAME_FULL_AND_STAGING_BACKING_FILESYSTEM_REQUIRED'
  statv=os.statvfs(PARENT);filesystem=dict(privateRoot=str(PARENT),checkpointRoot=str(root/'checkpoints'),device=PARENT.stat().st_dev,blockBytes=statv.f_frsize,availableBytes=statv.f_bavail*statv.f_frsize,mount=storage_mount_identity(PARENT))
  reserve=configuration['backupCanonicalReserveBytes'];need(type(reserve)is int and reserve>0)
  if configuration['purpose']=='COMPLETE_FULL':
   cipher=configuration['cipherBytes'];need(type(cipher)is int and cipher==1242945672)
   original=Path('/srv/sabalanerp-recovery/checkpoints/20261024T220346Z-b58c53c0f88d-release/deploy-20261024T220346Z-b58c53c0f88d-release.sabrec');st=original.lstat()
   need(original.resolve(strict=True)==original and stat.S_ISREG(st.st_mode) and st.st_nlink==1 and st.st_size==cipher and st.st_uid==997 and st.st_mode==0o100600)
   temporary=2*cipher+64*1024**2+512*1024**2
   # R9 backup_material.py/prepare.py require 2C+64MiB+512MiB on
   # backup. Its separate 3C Windows material gate is not this filesystem.
   required=reserve+temporary
   budget=dict(purpose='COMPLETE_FULL',canonicalReserveBytes=reserve,cipherBytes=cipher,temporaryWorkingBytes=temporary,requiredBytes=required,checkpointContentOnly=True,checkpointCurrentMetadata=dict(device=st.st_dev,inode=st.st_ino,size=st.st_size,mtimeNs=st.st_mtime_ns,ctimeNs=st.st_ctime_ns))
  else:
   need(configuration['purpose']=='IMAGE_STAGING');retirement=configuration['retirement']
   validate_storage_retirement(retirement)
   for name in retirement['backupAbsent']:
    file=Path(name);need(file.parent==PARENT)
    try:file.lstat()
    except FileNotFoundError:pass
    else:raise AssertionError('FULL_TEMPORARY_INPUT_REAPPEARED')
   cipher=configuration['imageCipherUpperBoundBytes'];need(type(cipher)is int and cipher>0)
   # Three block roundings, bounded code/metadata, unchanged safety reserve.
   working=cipher+3*statv.f_frsize+2*1024**2+512*1024**2;required=reserve+working
   budget=dict(purpose='IMAGE_STAGING',canonicalReserveBytes=reserve,cipherUpperBoundBytes=cipher,temporaryWorkingBytes=working,requiredBytes=required,fullRetirementReobserved=True)
  args=['--mode','plan','--project','sabalanerp-backup','--lock-file','/run/lock/sabalan-backup-storage.lock','--lock-fd','10','--storage-root',str(root),'--required-bytes',str(required),'--checkpoint-root',str(root/'checkpoints'),'--audit','/var/log/sabalanerp-backup/storage-cleanup.jsonl']
  code=canonical_plan_code(CANONICAL,args);module={};exec(compile(COLLECTOR_SOURCE,'same-owned-backup-readonly-original','exec'),module);output=io.BytesIO();h.verifier_intent=True
  row,error=module['collect'](h,[str(NODE),'--max-old-space-size=128','--input-type=module','-e',code],output,2*1024**2)
  need(not error);gate=json.loads(output.getvalue());need(gate['project']=='sabalanerp-backup' and gate['mode']=='plan' and gate['removed']==[] and gate['requiredBytes']==required)
  h.lock_guard();need(private_directory(PARENT)==parent)
 except BaseException as error:failure=type(error).__name__
 finally:
  channel={};exec(compile(CHANNEL_SOURCE,'readonly-backup-closure-policy','exec'),channel)
  safe=resolve_negative_verifier_custody(h,channel)
  if not safe:retain_unknown_image_owner()
  backup_storage_emit(dict(format='sabalan-backup-readonly-storage-closed/v1',operation=STORAGE_OPERATION,preflightSucceeded=failure is None and gate is not None and gate['ok'] is True,backup=gate,budget=budget,filesystem=filesystem,originalChildren=h.children,allOriginalChildrenClosed=True,FD9AndFD10HeldThroughPreflight=True,storagePolicyChanged=False,deletionApplied=False,failureType=failure,productionAdmission=False))
  for number,handler in handlers.items():signal.signal(number,handler)
  h.close()
 return 0


def validate_storage_retirement(retirement):
 import re
 need(retirement['format']=='sabalan-same-root-complete-retirement/v1' and retirement['productionAdmission'] is False)
 need(re.fullmatch('[a-f0-9]{32}',retirement['operation']) and re.fullmatch('[a-f0-9]{32}',retirement['rootOperation']))
 need(retirement['rootOperation']==STORAGE_CONFIGURATION['rootOperation'])
 need(retirement['originalOwnerClosed'] is True and retirement['localJobRetired'] is True and retirement['backupTransferRetired'] is True)
 need(retirement['backupAbsent']==[str(PARENT/('transfer-material-'+retirement['operation'])),str(PARENT/('transfer-'+retirement['operation']))])
