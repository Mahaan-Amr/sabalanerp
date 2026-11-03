import hashlib
import json
import pathlib
from datetime import datetime, timezone

p = pathlib.Path(__file__).resolve().parent
outer_path = pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026/BACKUP-DEEP-a1144b0b01d3e61e1b1f1de069e9b585.json')
outer = json.loads(outer_path.read_text(encoding='utf-8'))
assert outer['pass'] and outer['lease']['closed'] and not outer['cleanupPerformed']
ref = outer['result']['privateObservation']
raw = pathlib.Path(ref['file']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == ref['sha256']
d = json.loads(raw)
assert not d['cleanupPerformed'] and not d['canonicalAuditAppend']
(p/'DEEP-INVENTORY.json').write_text(json.dumps(d,indent=2)+'\n',encoding='utf-8')
volumes=[]
for v in d['volumes']:
    rows=v.get('usage',{}).get('rows',[])
    amount=next((r['allocatedBytes'] for r in rows if r['path']==v['mountpoint']),None)
    volumes.append({'name':v['name'],'bytes':amount,'labels':v['labels'],'references':v['references'],'largestSubpaths':rows[1:6]})
j=d['journalFiles']
print(json.dumps({'observedAt':outer['completedAt'],'volumes':volumes,
 'extraUsage':[{'root':x['root'],'rows':x['rows'][:10]} for x in d['extraUsage']],
 'logs':d['logFiles'],'journal':{'usage':d['journalDiskUsage'],'fileCount':len(j),'archivedBytes':sum(x['allocatedBytes'] for x in j if x['archived']),'activeBytes':sum(x['allocatedBytes'] for x in j if not x['archived']),'oldestMtime':datetime.fromtimestamp(min(x['mtimeNs'] for x in j)/1e9,timezone.utc).isoformat(),'boots':d['journalBoots']},
 'packageProcesses':d['packageProcesses'],'availableBytes':d['availableBytesAfter']},ensure_ascii=False))
