import hashlib,json,pathlib
p=pathlib.Path(__file__).resolve().parent
file=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026/FINTECH-REMOVAL-PLAN-R2-e2887b91fdbcc85bc75cea33e48320e3.json')
outer=json.loads(file.read_text(encoding='utf-8'));assert outer['pass'] and outer['lease']['closed']
ref=outer['result']['privateObservation'];raw=pathlib.Path(ref['file']).read_bytes()
assert hashlib.sha256(raw).hexdigest()==ref['sha256'];d=json.loads(raw)
(p/'FINTECH-REMOVAL-PLAN.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'machineUuidSha256':d['machineUuidSha256'],'containers':len(d['containers']),'allStopped':all(not x['running'] for x in d['containers']),'volumes':len(d['volumes']),'images':len(d['images']),'imageTags':[{k:x[k] for k in ['id','fintechTags','otherTags','nonFintechReferences']} for x in d['images']],'paths':d['paths'],'units':d['systemdUnits'],'processRefs':d['processReferences']},ensure_ascii=False))
