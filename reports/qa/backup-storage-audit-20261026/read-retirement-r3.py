import hashlib,json,pathlib
p=pathlib.Path(__file__).resolve().parent
source=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026/FINTECH-REMOVAL-PLAN-R3-8289c5645799f16df44d7fec8f93b425.json')
outer=json.loads(source.read_text(encoding='utf-8'));assert outer['pass'] and outer['lease']['closed']
ref=outer['result']['privateObservation'];raw=pathlib.Path(ref['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==ref['sha256']
d=json.loads(raw);(p/'FINTECH-REMOVAL-PLAN-R3.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'containers':len(d['containers']),'running':[x['name'] for x in d['containers'] if x['running']],'otherContainers':len(d['nonFintechContainers']),'imageConflicts':[x for x in d['images'] if x['nonFintechReferences'] or x['otherTags']],'units':d['systemdUnits'],'unitList':d['unitList'],'scripts':d['scripts']},ensure_ascii=False))
