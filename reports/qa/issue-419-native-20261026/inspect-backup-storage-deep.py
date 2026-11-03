"""Authenticated read-only backup metadata using the approved finite credential owner.
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
remote_file=HERE/'backup-storage-deep-remote.py'
remote_raw=remote_file.read_bytes()
assert hashlib.sha256(remote_raw).hexdigest()=='eaceb4d06972a5c20447cb08fa96e818b5338eae9a72edcbcd62da3d8b388fa8'
remote=remote_raw.decode('utf8')
command = "python3 -I -B -c \"import base64;exec(compile(base64.b64decode('"+base64.b64encode(remote.encode()).decode()+"'),'<fixed-readonly-backup-capacity>','exec'))\""
owner = owner_source['CompleteRestoreOwner'](directory)
try:
    with helper['private_backup_password'](owner,password) as password_file:
        leaf = password_file
        row = owner.run_original(helper['plink_argv'](password_file,command),'backupPrepare',
                                 maximum_stdout=4*1024**2,redact_password=password.encode())
        helper['positive'](row)
        observed = json.loads(pathlib.Path(row['stdout']['file']).read_bytes())
        assert observed['format']=='sabalan-backup-deep-storage-readonly/v1'
        assert observed['cleanupPerformed'] is False and observed['canonicalAuditAppend'] is False
    assert not leaf.exists()
    closed=[]
    for ref in owner.children:
        raw=pathlib.Path(ref['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==ref['sha256']
        r=json.loads(raw);helper['positive'](r);closed.append(r)
    summary={'format':observed['format'],'volumeCount':len(observed['volumes']),'availableBytesAfter':observed['availableBytesAfter'],'cleanupPerformed':False}
    print(json.dumps({'summary':summary,'privateObservation':row['stdout'],'credentialLeafRetired':True,
                      'originalChildren':closed,'masterStarted':False,'fullAccepted':False,
                      'cleanupPerformed':False,'canonicalAuditAppend':False}))
finally:
    owner.close(); password = ''; frame.clear()
