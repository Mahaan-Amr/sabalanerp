"""File-only exact negative-custody guard. No signal, lease or Docker control."""
from pathlib import Path
import hashlib,json,re
ROOT_OPERATION='f28211a52244b8c71b752731cc15b1b6'
LAUNCH=Path('D:/sabalanerp-online-qa/419-native-master-dbcd0be9536d90d98a0e6db788bdc543')
ROOT=Path('D:/sabalanerp-online-qa/419-safe-rollback-'+ROOT_OPERATION)
LIVE=Path('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp')
SHA=lambda b:hashlib.sha256(b).hexdigest()
def check(plan,stage,run_read_only):
 assert plan['profile']=='production'and plan['operation']==ROOT_OPERATION
 material_ref=plan['nativeMaterial'];material_path=Path(material_ref['file']);assert material_path==Path('D:/sabalanerp-online-qa/held-f282-native-material-r3-20261101/configuration-r4.json');material_raw=material_path.read_bytes();assert SHA(material_raw)==material_ref['sha256'];material=json.loads(material_raw)
 def read_ref(row):
  raw=Path(row['file']).read_bytes();assert SHA(raw)==row['sha256'];return json.loads(raw)
 baseline=read_ref(material['inputs']['baseline']);inquiry=read_ref(material['inputs']['inquiry']);assert len(plan['returnSteps'])==2
 wanted_inquiry=['compose','--project-name','sabalanerp-local',*[v for row in inquiry['files']for v in ['-f',row['file']]],'up','--no-deps','--no-build','--pull','never','-d','--wait','inquiry']
 assert plan['returnSteps'][0]['action']=={'executable':'C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe','arguments':wanted_inquiry,'environment':{}}
 assert plan['returnSteps'][1]['action']=={'executable':'C:/Users/mahan/AppData/Local/Programs/DockerDesktop/resources/bin/docker.exe','arguments':baseline['rollbackCommand'][1:],'environment':baseline['environment']}
 assert plan['journalDirectory']=='D:/sabalanerp-online-qa/held-f282-recovery-execution-r1-20261101'
 assert stage in ('before','after-drain','after-return')
 assert Path(plan['commandsFile'])==LAUNCH/'commands.jsonl'and Path(plan['closedFile'])==LAUNCH/'original-evidence/original-closed.json'
 assert (LAUNCH/'commands.jsonl').read_bytes()==b'','ORIGINAL_COMMAND_QUEUE_NOT_EMPTY'
 for args in [['diff','--name-only'],['diff','--cached','--name-only']]:
  assert run_read_only(['git',*args],LIVE)==b'','LIVE_FREEZE_CHANGED'
 assert run_read_only(['git','rev-parse','HEAD'],LIVE).decode().strip()=='7d2821447a4b4f64b551670691b72e6db199ad04'
 assert sorted(p.name for p in ROOT.iterdir())==plan['originalRootDirectoryEntries'],'ROOT_EVIDENCE_CHANGED'
 serial=[];sampler=[]
 for f in ROOT.glob('*-child.json'):
  if not re.fullmatch(r'[0-9]+-child.json',f.name):continue
  r=json.loads(f.read_bytes());assert r['format']=='sabalan-serial-original-child/v1'and r['code']==0 and r['signal']is None and r['stdoutEof']is True and r['stderrEof']is True and r['observationFault']is False
  for stream in ('stdout','stderr'):
   data=Path(r['files'][stream]).read_bytes();assert len(data)==r[stream+'Bytes']and SHA(data)==r[stream+'Sha256']
  serial.append(f.name)
 for f in ROOT.glob('sampler-*-child-*.json'):
  r=json.loads(f.read_bytes());assert r['code']==0 and r['signal']is None and r['stdoutEof']is True and r['stderrEof']is True and r['observationFault']is False;sampler.append(f.name)
 assert len(serial)==523 and len(sampler)==202,'ORIGINAL_CHILD_SET_CHANGED'
 held=json.loads((ROOT/'held-596.json').read_bytes());assert held=={'reason':'POST_LOCAL_BASELINE_RESTORATION_NOT_PROVEN','code':'Error','qualificationSucceeded':False,'productionAdmission':False}
 assert not any((ROOT/n).exists()for n in ['local-construction.json','complete-construction.json','master-input-ready.json','pre-fsm-retained-restored.json'])
 prefix=(LAUNCH/'original-evidence/stdout.log').read_bytes();before=bytes.fromhex(plan['originalStdoutPrefixHex']);assert prefix.startswith(before),'ORIGINAL_OUTPUT_PREFIX_CHANGED'
 assert (LAUNCH/'original-evidence/stderr.log').read_bytes()==b''
 if stage=='before':assert prefix==before and not Path(plan['closedFile']).exists()
 else:
  closed=json.loads(Path(plan['closedFile']).read_bytes());assert closed['originalPid']==53032 and closed['code']==97 and closed['pipesClosed']is True and closed['readerErrors']==[]and closed['supervisorHeld']is False and closed['commandsSent']==0
  assert prefix.endswith(b'\n');rows=[json.loads(line)for line in prefix.splitlines()];assert len(rows)==3
  assert [r['format']for r in rows]==['sabalan-native-c3-private-preflight-request/v1','sabalan-native-c3-development-frontend-returned-before-master/v1','sabalan-native-c3-root-ready/v1'];assert rows[-1]['operation']==ROOT_OPERATION and rows[-1]['productionAdmission']is False
 return {'originalSerialChildren':len(serial),'samplerFiniteChildren':len(sampler),'samplerNaturalDrainClaimed':False,'localStarted':False,'completeStarted':False,'commandsSent':0,'outputActuallyDrained':stage!='before'}
