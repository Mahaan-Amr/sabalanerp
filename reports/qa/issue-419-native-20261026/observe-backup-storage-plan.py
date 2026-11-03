"""Authenticated canonical backup inventory with its audit append and no cleanup.
This is not COMPLETE, a transfer, cleanup or a FULL admission authority.
"""
import base64
import hashlib
import json
import pathlib
import runpy
import sys

HERE = pathlib.Path(__file__).resolve().parent
OWNER = HERE.parents[2]/'tests/online-deployment/fixtures/complete-source/owner.txt'
HELPER = pathlib.Path('D:/sabalanerp-online-qa/C30-complete-final-plan-d1d83332c347419d91b66051adf39d81/windows/backup_credential.py')
assert hashlib.sha256(OWNER.read_bytes()).hexdigest() == 'f569bec3a36efa5caec5c69c84e4d21e00aae5eb4eae5b713b617e4821a008a2'
assert hashlib.sha256(HELPER.read_bytes()).hexdigest() == '2d7114304b5b31647a91b4d6fdfaa281de6e4d3ddcfbec4be962ecd2f85b321d'
owner_source = runpy.run_path(str(OWNER), run_name='finite_metadata_owner_only')
helper = runpy.run_path(str(HELPER), run_name='approved_backup_credential')
directory = pathlib.Path(sys.argv[1]); assert directory.resolve() == directory and directory.is_dir()
frame = json.loads(sys.stdin.buffer.read(8193)); password = frame['password']
assert set(frame) == {'password'} and isinstance(password,str) and 0 < len(password) < 256
remote = r'''import os,hashlib,pathlib,fcntl,stat
assert os.getuid()==0
for file,digest in [('/opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs','c52a2821d2a68bfbf7d2f2cac105b949b70fc7b11c2427619ca7a3382a225d1f'),('/opt/sabalanerp-recovery/scripts/deployment-storage.mjs','78806f96895513405612536a6e6e27990e9110b71c2d21b6092e761f417faa2b')]:
 p=pathlib.Path(file);assert p.resolve()==p and p.is_file() and not p.is_symlink()
 s=p.stat();assert s.st_uid==0 and not s.st_mode&0o022 and s.st_nlink==1
 assert hashlib.sha256(p.read_bytes()).hexdigest()==digest
lock='/run/lock/sabalan-backup-storage.lock'
fd=os.open(lock,os.O_RDWR|os.O_NOFOLLOW)
held=os.fstat(fd);named=os.stat(lock,follow_symlinks=False)
assert stat.S_ISREG(held.st_mode) and held.st_uid==0 and held.st_nlink==1 and not held.st_mode&0o022
assert (held.st_dev,held.st_ino)==(named.st_dev,named.st_ino)
fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
os.dup2(fd,9,inheritable=True)
os.set_inheritable(9,True)
# Zero here requests inventory only. The unchanged FULL floor is compared by
# the Windows observer; a successful inventory never grants FULL admission.
os.execve('/usr/bin/node',['/usr/bin/node','/opt/sabalanerp-recovery/deploy/scripts/storage-preflight.mjs',
 '--mode','plan','--project','sabalanerp-backup','--lock-file',lock,'--lock-fd','9',
 '--storage-root','/srv/sabalanerp-recovery','--required-bytes','0',
 '--checkpoint-root','/srv/sabalanerp-recovery/checkpoints',
 '--audit','/var/log/sabalanerp-backup/storage-cleanup.jsonl'],{'PATH':'/usr/sbin:/usr/bin:/sbin:/bin'})
'''
command = "python3 -I -B -c \"import base64;exec(compile(base64.b64decode('"+base64.b64encode(remote.encode()).decode()+"'),'<fixed-backup-plan-with-audit>','exec'))\""
owner = owner_source['CompleteRestoreOwner'](directory)
try:
    with helper['private_backup_password'](owner,password) as password_file:
        leaf = password_file
        row = owner.run_original(helper['plink_argv'](password_file,command),'backupPrepare',
                                 maximum_stdout=131072,redact_password=password.encode())
        helper['positive'](row)
        observed = json.loads(pathlib.Path(row['stdout']['file']).read_bytes())
        assert observed['ok'] is True and observed['project']=='sabalanerp-backup'
        assert set(observed['plan'])=={'containers','images'}
    assert not leaf.exists()
    closed=[]
    for ref in owner.children:
        raw=pathlib.Path(ref['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==ref['sha256']
        r=json.loads(raw);helper['positive'](r);closed.append(r)
    print(json.dumps({'observation':observed,'credentialLeafRetired':True,
                      'originalChildren':closed,'masterStarted':False,'fullAccepted':False,
                      'canonicalPlanOnly':True,'cleanupPerformed':False,'canonicalAuditAppend':True,
                      'fullMinimumRequiredBytes':2*1242945672+64*1024**2+512*1024**2,
                      'fullMinimumCapacitySufficient':observed['availableBytes']>=2*1242945672+64*1024**2+512*1024**2}))
finally:
    owner.close(); password = ''; frame.clear()
