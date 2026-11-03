"""Freeze the reviewed exact retirement plan and reuse approved private SSH custody."""
import ast,base64,hashlib,json,pathlib
p=pathlib.Path(__file__).resolve().parent
root=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026')
plan=(p/'FINTECH-REMOVAL-PLAN-R4.json').read_bytes();obj=json.loads(plan)
assert not obj['sabalanReferenceMatches']
assert len(obj['volumes'])==8 and len(obj['images'])==36 and len(obj['paths'])==16
template=(root/'fintech-retire-executor.template.py').read_text(encoding='utf-8')
assert template.count('PLAN_BASE64')==1
source=template.replace('PLAN_BASE64',base64.b64encode(plan).decode())
ast.parse(source)
remote=root/'fintech-retire-execute-remote.py';assert not remote.exists();remote.write_text(source,encoding='utf-8')
digest=hashlib.sha256(remote.read_bytes()).hexdigest()
helper=(root/'inspect-backup-filesystem-r2.py').read_text(encoding='utf-8')
helper=helper.replace('capacity-filesystem-inventory-remote-r2.py',remote.name).replace('12d0180a26f8c5214de0f522f4162a192b2a14453f6fa1bfa8e49cb36819cd16',digest)
helper=helper.replace("assert observed['format']=='sabalan-419-readonly-filesystem-inventory/v1'","assert observed['format']=='sabalan-fintech-retirement-result/v1'")
helper=helper.replace("assert observed['cleanupPerformed'] is False and observed['canonicalAuditAppend'] is False","assert isinstance(observed['cleanupPerformed'],bool) and observed['canonicalAuditAppend'] is False")
start=helper.index("    snapshot=observed['protectionSnapshot']");end=helper.index('    print(json.dumps',start)
helper=helper[:start]+"    summary={key:observed.get(key) for key in ['format','status','cleanupPerformed','beforeAvailableBytes','availableBytesAfter','reclaimedBytesObserved','error','auditFile']}\n"+helper[end:]
helper=helper.replace("'cleanupPerformed':False,'canonicalAuditAppend':False", "'cleanupPerformed':observed['cleanupPerformed'],'canonicalAuditAppend':False")
python=root/'fintech-retire-execute.py';assert not python.exists();python.write_text(helper,encoding='utf-8');ast.parse(helper)
outer=(root/'inspect-backup-filesystem-r2.mjs').read_text(encoding='utf-8').replace('inspect-backup-filesystem-r2.py',python.name).replace('BACKUP-FILESYSTEM-','FINTECH-RETIREMENT-')
outer=outer.replace("report.result=JSON.parse(raw);assert.equal(report.result.credentialLeafRetired,true);", "report.result=JSON.parse(raw);report.cleanupPerformed=report.result.summary.cleanupPerformed;assert.equal(report.result.credentialLeafRetired,true);assert.equal(report.result.summary.status,'COMPLETE');")
target=root/'fintech-retire-execute.mjs';assert not target.exists();target.write_text(outer,encoding='utf-8')
record={'authorization':'Human explicitly requested complete Fintech project/data removal on backup host only','planSha256':hashlib.sha256(plan).hexdigest(),'templateSha256':hashlib.sha256(template.encode()).hexdigest(),'remoteSourceSha256':digest,'independentReview':'Final exact template reviewed; both concrete guard findings fixed; no remaining deletion-scope finding','paths':list(x['path'] for x in obj['paths']),'volumeCount':8,'imageCount':36,'sabalanDataDeletionAuthorized':False,'pushAuthorized':False}
(p/'FINTECH-EXECUTION-INPUTS.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'node':str(target),'planSha256':record['planSha256'],'sourceSha256':digest,'ast':'pass','scope':'Pinned backup host, Fintech only'}))
