import json,sys
operation=sys.argv[1];mode=sys.argv[2]
def emit(v):print(json.dumps(v),flush=True)
def negative():
 emit({'format':'sabalan-image-repository-owner-result/v1','operation':operation,'file':'modeled-only-image-result.json','sha256':'a'*64,'retrievalQualified':False,'outerOriginalClosurePending':True,'productionAdmission':False})
emit({'format':'sabalan-r9-master-private-credential-ready/v1','operation':operation,'credentialsRead':False,'productionAdmission':False})
line=sys.stdin.readline()
if not line and mode=='before-credential-refusal':negative();sys.exit(0)
frame=json.loads(line);assert frame['operation']==operation and frame['credential']=='ephemeral-image-test-secret'
if mode=='echo':emit({'format':'bad','secret':frame['credential']});sys.stdin.read();sys.exit(1)
for sequence,stage in enumerate(['BACKEND_ENCRYPT','BACKEND_LOCAL_VERIFY','BACKUP_STORE'],1):
 emit({'format':'sabalan-image-repository-owner-request/v1','operation':operation,'sequence':sequence if mode!='wrong-sequence'else 9,'challenge':str(sequence)*64,'stage':stage})
 line=sys.stdin.readline()
 if not line:
  if mode=='callback-refusal':negative();sys.exit(0)
  sys.exit(2)
 ack=json.loads(line);assert ack['format']=='sabalan-image-repository-owner-ack/v1'and ack['operation']==operation and ack['sequence']==sequence and ack['challenge']==str(sequence)*64 and ack['stage']==stage and ack['result']['format']=='sabalan-image-repository-phase-plan/v1'and ack['result']['stage']==stage and ack['result']['operation']==operation and ack['result']['productionAdmission']is False
emit({'format':'sabalan-image-repository-owner-result/v1','operation':operation,'file':'modeled-only-image-result.json','sha256':'a'*64,'retrievalQualified':mode!='known-negative','outerOriginalClosurePending':True,'productionAdmission':False})
assert sys.stdin.read()==''
