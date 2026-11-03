"""Summarize authorized read-only filesystem metadata; never inspect file content."""
import hashlib
import json
import pathlib

p = pathlib.Path(__file__).resolve().parent
receipt_path = pathlib.Path('C:/Users/mahan/.codex/worktrees/native-complete-419/sabalanerp/reports/qa/issue-419-native-20261026/BACKUP-FILESYSTEM-7492f0d684be4d93dd18bf43c5089202.json')
receipt = json.loads(receipt_path.read_text(encoding='utf-8'))
assert receipt['pass'] and receipt['cleanupPerformed'] is False and receipt['lease']['closed']
ref = receipt['result']['privateObservation']
raw = pathlib.Path(ref['file']).read_bytes()
assert hashlib.sha256(raw).hexdigest() == ref['sha256']
data = json.loads(raw)
assert data['cleanupPerformed'] is False
summary = {
    'observedAt':receipt['completedAt'], 'filesystem':data['filesystem'], 'mount':data['mount'],
    'usage':data['usage'], 'dockerStore':data['dockerStore'],
    'containers':data['containers'], 'images':data['images'],
    'largeFilesOutsideProtectedTrees':data['largeFilesOutsideProtectedTrees'],
    'openFileObservation':data['openFileObservation'], 'scan':data['scan'],
    'availableBytesAfter':data['availableBytesAfter'],
    'protectionSnapshot':data['protectionSnapshot'],
    'source':{'receipt':str(receipt_path),'observationSha256':ref['sha256']},
    'cleanupPerformed':False,
}
(p / 'INVENTORY.json').write_text(json.dumps(summary,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'filesystem':data['filesystem'],'after':data['availableBytesAfter'],
 'usage':[{ 'root':x['root'], 'rows':sorted(x['rows'],key=lambda row:row['allocatedBytes'],reverse=True)[:9]} for x in data['usage'] if x['root'] in ['/','/opt','/var','/var/log','/root']],
 'docker':data['dockerStore'],'containers':data['containers'],
 'imageSummary':{'count':len(data['images']),'logicalSumNotDeduplicated':sum(x['bytes'] for x in data['images'])},
 'outsideProtectedLargest':[{k:x[k] for k in ['path','allocatedBytes']} for x in data['largeFilesOutsideProtectedTrees'][:8]],
 'openFileObservation':data['openFileObservation'],
 'protectionInventoryKeys':list(data['protectionSnapshot']['value']['inventory']),
 'protectionPlan':data['protectionSnapshot']['value']['plan']},ensure_ascii=False))
