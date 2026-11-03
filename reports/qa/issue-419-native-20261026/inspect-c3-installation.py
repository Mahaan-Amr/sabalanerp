"""File-only #413 installation inventory. No runtime, build or authority creation."""
import hashlib
import json
import pathlib
import subprocess
import tarfile
import uuid

HERE = pathlib.Path(__file__).resolve().parent
TARGET = pathlib.Path('C:/Users/mahan/.codex/worktrees/native-c3-execution-419/sabalanerp')
PLAN = pathlib.Path('D:/sabalanerp-online-qa/ticket413-artifact-ready-d4948dcb6fd54d31bf2ce76513030432/install-plan-final.json')
HOST = pathlib.Path('D:/sabalanerp-online-qa/ticket413-final-host-pack-c54445cb-20261025')
sha = lambda raw: hashlib.sha256(raw).hexdigest()
def git(*args, root=TARGET):
    return subprocess.check_output(['git', '-C', str(root), *args]).decode().strip()
def ref(row):
    p = pathlib.Path(row['file']); raw = p.read_bytes()
    assert p.resolve() == p and sha(raw) == row['sha256']
    if 'bytes' in row:
        assert len(raw) == row['bytes']
    return raw
def relative(name):
    p = pathlib.PurePosixPath(name)
    assert not p.is_absolute() and '..' not in p.parts and '\\' not in name and ':' not in name
    return p

report = {'format':'sabalan-419-c3-file-installation-inventory/v1', 'pass':False,
          'runtimeStarted':False, 'masterStarted':False, 'productionAdmission':False,
          'imageBuilt':False, 'hostPackBuilt':False, 'filesInstalled':False}
try:
    raw = PLAN.read_bytes()
    assert sha(raw) == '0b9cba26b9975abbc6893cb988d4571a3b49a8d1c6719215f61aad6c336ec238'
    plan = json.loads(raw)
    assert git('rev-parse','HEAD') == plan['sourceCommit']
    assert git('rev-parse','HEAD^{tree}') == plan['sourceTree']
    assert git('status','--porcelain') == ''
    inquiry = TARGET/'apps/sabalan-inquiry'
    assert git('rev-parse','HEAD',root=inquiry) == '63407dd94f17471b030b0aa59c80313c107c3a54'
    assert git('status','--porcelain',root=inquiry) == ''
    ref(plan['sourceBundle'])
    for commit in plan['sourceBundle']['prerequisiteCommits']:
        git('merge-base','--is-ancestor',commit,'HEAD')
    report['source'] = {'commit':plan['sourceCommit'],'tree':plan['sourceTree'],
                        'inquiryCommit':git('rev-parse','HEAD',root=inquiry),
                        'clean':True,'bundlePrerequisitesPresent':True}
    host = json.loads(ref(plan['hostPackReceipt']))
    report['hostOutputs'] = []
    for name, row in host['outputs'].items():
        p = HOST.joinpath(*relative(name).parts)
        raw = p.read_bytes()
        assert len(raw) == row['bytes'] and sha(raw) == row['sha256']
        target = TARGET.joinpath(*relative(name).parts)
        report['hostOutputs'].append({'path':name,'bytes':len(raw),'sha256':sha(raw),
                                     'targetExists':target.exists(),
                                     'targetExact':target.exists() and sha(target.read_bytes()) == sha(raw)})
    archive = plan['operationsArchive']; ref(archive)
    inventory = []
    with tarfile.open(archive['file'],'r:*') as tf:
        for member in tf.getmembers():
            if member.isdir():
                continue
            assert member.isfile() and not member.issym() and not member.islnk()
            name = str(relative(member.name))
            raw = tf.extractfile(member).read()
            assert len(raw) == member.size
            target = TARGET.joinpath(*relative(name).parts)
            inventory.append({'path':name,'bytes':len(raw),'sha256':sha(raw),
                              'targetExists':target.exists(),
                              'targetExact':target.exists() and sha(target.read_bytes()) == sha(raw)})
    assert len({row['path'] for row in inventory}) == len(inventory)
    report['operationsArchive'] = archive
    report['operationsFiles'] = inventory
    report['hostOutputCount'] = len(report['hostOutputs'])
    report['operationsFileCount'] = len(inventory)
    report['missingOperations'] = sum(not row['targetExists'] for row in inventory)
    report['differentOperations'] = sum(row['targetExists'] and not row['targetExact'] for row in inventory)
    report['pass'] = True
except Exception as error:
    report['error'] = type(error).__name__
finally:
    file = HERE/('C3-INSTALLATION-INVENTORY-'+uuid.uuid4().hex+'.json')
    file.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'file':str(file),'pass':report['pass'],
                     **{k:report[k] for k in ['hostOutputCount','operationsFileCount','missingOperations','differentOperations','error'] if k in report}}))
if not report['pass']:
    raise SystemExit(1)
