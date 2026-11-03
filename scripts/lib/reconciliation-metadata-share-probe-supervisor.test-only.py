"""SOURCE ONLY. Original Popen and bounded output custody for test-only probe."""
import os,time,uuid,hashlib,tempfile,importlib.util,json,sys
from pathlib import Path
if os.name!='nt' or not __debug__:raise RuntimeError('PLATFORM')
base=Path(r'C:\Users\mahan\AppData\Local\Temp\sabalan-419-held-window-20261102')
helper=base/'finite-bridge-windows-v11-UNEXECUTED.py'; expectedHelper='8250681666ea5f5ac6859fb8967d26c1c7720b32821c6c52ec12c964182a88e6'
probe=Path(__file__).absolute().with_name('reconciliation-metadata-share-probe.test-only.py'); expectedProbe='0e34bdaac98aba879ce9e828bf38d3dee063f6107fb18a832b6c6115ba5fc8a2'
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
if digest(helper)!=expectedHelper or digest(probe)!=expectedProbe:raise RuntimeError('SOURCE_SNAPSHOT_MISMATCH')
spec=importlib.util.spec_from_file_location('fixture_support',helper);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
tmp=Path(tempfile.gettempdir()).absolute()
if str(tmp).lower()!=r'c:\users\mahan\appdata\local\temp':raise RuntimeError('PARENT_MISMATCH')
m.no_reparse(tmp);m.no_reparse(helper);m.no_reparse(probe);m.no_reparse(Path(sys.executable))
root=tmp/('sabalan-meta-parent-'+uuid.uuid4().hex);m.create_private(root);rootid=m.root_identity(root)
def checked():
 if root.parent!=tmp or m.root_identity(root)!=rootid:raise RuntimeError('ROOT_IDENTITY_CHANGED')
children=[];status='UNKNOWN';detail='UNAVAILABLE';receipt=None
try:
 checked()
 if digest(probe)!=expectedProbe:raise RuntimeError('SOURCE_SNAPSHOT_CHANGED')
 child=m.Child([sys.executable,str(probe)],root,'holder',children)
 receipt=child.finish(time.monotonic()+30)
 if receipt['exitCode']!=0 or child.buffers['stderr']:raise RuntimeError('PROBE_CHILD_FAILED')
 status='COMPLETE_UNINTERPRETED';detail='REVIEW_RAW_RECEIPT'
except BaseException as e:detail=type(e).__name__+': '+str(e)
finally:
 # Timeout does not authorize abandoning the Popen handle or terminating by PID.
 for child in children:
  while child.process.poll() is None or any(t.is_alive() for t in child.threads):time.sleep(.1)
  if child.birth is None or child.exceeded or child.reader_errors or not all(child.eof.values()):status='UNKNOWN'
 try:
  checked();m.write_bytes(root/'receipt.json',json.dumps({'status':status,'detail':detail,'child':receipt,'sourceSha256':expectedProbe,'rawStdoutSha256':hashlib.sha256(child.buffers['stdout']).hexdigest() if children else None,'parentAcl':'PROTECTED_OWNER_SYSTEM_NOT_INDEPENDENTLY_VERIFIED','directoryDurability':'UNKNOWN','sourcePathRace':'UNPROVEN'}).encode())
 except BaseException:status='UNKNOWN'
 print('result',status,'evidence',str(root),flush=True)
