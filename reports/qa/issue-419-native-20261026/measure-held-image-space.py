"""Read held archives for ext4 allocation accounting; never extract/import/build."""
import gzip
import hashlib
import json
import pathlib
import runpy
import tarfile
import uuid

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
PLAN=pathlib.Path('D:/sabalanerp-online-qa/ticket413-artifact-ready-d4948dcb6fd54d31bf2ce76513030432/install-plan-final.json')
sha=lambda raw:hashlib.sha256(raw).hexdigest()
raw=PLAN.read_bytes();assert sha(raw)=='0b9cba26b9975abbc6893cb988d4571a3b49a8d1c6719215f61aad6c336ec238'
plan=json.loads(raw)
capacity=runpy.run_path(str(ROOT/'deploy/scripts/private-image-filesystem-capacity.py'),run_name='read_only_capacity_accounting')
def read(reference):
    p=pathlib.Path(reference['file']);raw=p.read_bytes()
    assert sha(raw)==reference['sha256']
    if 'bytes' in reference:assert len(raw)==reference['bytes']
    return raw
rows=[]
for name,ref in plan['preservedRecoverySourceA']['components'].items():
    c=json.loads(read(ref))
    rows.append({'name':'SourceA-'+name,'raw':c['rawArchive'],'compressed':c['compressedArchive'],
                 'cipher':c['cipher'],'graph':c['archiveGraph']})
new=plan['backendImage']
rows.append({'name':'C3-application-backend','raw':new['rawArchive'],'compressed':new['compressedArchive'],
             'cipher':None,'graph':new['archiveGraph']})
report={'format':'sabalan-419-held-image-space-accounting/v1','pass':False,'readOnly':True,
        'imagesImported':False,'imagesBuilt':False,'cryptoExecuted':False,'fullAccepted':False,
        'filesystemModel':'ext4/overlay2, 4096-byte allocation unit, no layer reuse credit',
        'sourcePlan':{'file':str(PLAN),'sha256':sha(raw)},'images':[]}
try:
    for row in rows:
        source=pathlib.Path(row['raw']['file']);before=source.stat()
        assert before.st_size==row['raw']['bytes']
        with source.open('rb') as f:
            h=hashlib.file_digest(f,'sha256').hexdigest()
        assert h==row['raw']['sha256']
        account=capacity['Accounting']()
        with tarfile.open(source,'r:') as tf:
            members={m.name:m for m in tf.getmembers()};assert len(members)==len(tf.getmembers())
            platform='blobs/sha256/'+row['graph']['platform'].split(':')[1]
            if platform in members:
                manifest=json.loads(tf.extractfile(platform).read())
                layers=[('blobs/sha256/'+r['digest'].split(':')[1],r.get('mediaType','')) for r in manifest['layers']]
            else:
                manifest=json.loads(tf.extractfile('manifest.json').read());assert len(manifest)==1
                layers=[(p,'') for p in manifest[0]['Layers']]
            assert len(layers)==len(row['graph']['rootfsDiffIds'])
            for i,(name,media) in enumerate(layers):
                member=members[name];assert member.isfile() and not member.issym() and not member.islnk()
                with tf.extractfile(member) as stream:
                    magic=stream.read(2);stream.seek(0)
                    if magic==b'\x1f\x8b':
                        with gzip.GzipFile(fileobj=stream) as expanded:account.inspect_layer(expanded)
                    else:account.inspect_layer(stream)
                assert account.layers[-1]['diffId']==row['graph']['rootfsDiffIds'][i]
        after=source.stat()
        assert (before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns)
        proof=account.finish()
        report['images'].append({'name':row['name'],'raw':row['raw'],'compressed':row['compressed'],
                                  'cipher':row['cipher'],'index':row['graph']['index'],
                                  'allocationUpperBoundBytes':proof['allocationUpperBoundBytes'],
                                  'inodeUpperBound':proof['inodeUpperBound'],'proof':proof})
    report['totals']={'rawArchiveBytes':sum(r['raw']['bytes'] for r in rows),
                      'compressedArchiveBytes':sum(r['compressed']['bytes'] for r in rows),
                      'existingCipherBytes':sum(r['cipher']['bytes'] for r in rows if r['cipher']),
                      'expandedAllocationUpperBoundBytes':sum(r['allocationUpperBoundBytes'] for r in report['images']),
                      'expandedInodeUpperBound':sum(r['inodeUpperBound'] for r in report['images']),
                      'newC3CipherBytes':None}
    report['pass']=True
except Exception as e:
    report['error']={'type':type(e).__name__,'code':str(e)[:160]}
finally:
    file=HERE/('HELD-IMAGE-SPACE-'+uuid.uuid4().hex+'.json')
    file.write_bytes((json.dumps(report,indent=2)+'\n').encode())
    print(json.dumps({'file':str(file),'pass':report['pass'],'totals':report.get('totals'),'error':report.get('error')}))
if not report['pass']:raise SystemExit(1)
