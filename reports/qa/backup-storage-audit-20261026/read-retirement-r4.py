import hashlib,json,pathlib
p=pathlib.Path(__file__).resolve().parent
source=pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026/FINTECH-REMOVAL-PLAN-R4-7387b55f3128b9f223bcb0a183a3631c.json')
o=json.loads(source.read_text(encoding='utf-8'));assert o['pass'] and o['lease']['closed']
ref=o['result']['privateObservation'];raw=pathlib.Path(ref['file']).read_bytes();assert hashlib.sha256(raw).hexdigest()==ref['sha256'];d=json.loads(raw)
(p/'FINTECH-REMOVAL-PLAN-R4.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'units':d['unitList'],'paths':[x['path'] for x in d['paths']],'scripts':d['scripts'],'network':d['network'],'sidecars':d['sabalanSidecars'],'sabalanImageMatches':d['sabalanReferenceMatches']},ensure_ascii=False))
