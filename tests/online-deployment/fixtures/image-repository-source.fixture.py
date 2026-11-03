"""Compile final remote program only; mock capacity/cipher grants no admission."""
import ast,json,pathlib,runpy,sys
root=pathlib.Path(sys.argv[1]);q=pathlib.Path('D:/sabalanerp-online-qa')
source=runpy.run_path(str(root/'deploy/scripts/original-c3-backend-stream-source.py'))
builder=runpy.run_path(str(root/'deploy/scripts/original-image-repository-source.py'))
component=source['component']();images={'backend':dict(image=component['image'],gzip=component['gzip'],cipher=dict(bytes=559315264,sha256='a'*64,file=str(q/'never-created-fixture-cipher')),archiveGraph=component['archiveGraph'])}
for role,stem,digest in [
 ('frontend','C30-source-a-image-component-5d9006d6129f4c7b9a0095ac7d36080f','81f322d0986716fccf3b880f1ec047d5dbe10df6c7cb01985bb2798c47b39bcf'),
 ('inquiry','C30-source-a-image-component-45d688378778428f8e5b823f83ce7e2b','64eea77f6820ab385c4fca9122a9ceb669ae45bac37226922574b335da1ffa7f')]:
 row=json.loads(source['pinned'](q/stem/'component.json',digest));images[role]=dict(image=row['sourceImageId'],gzip=row['compressedArchive'],cipher=row['cipher'],archiveGraph=row['archiveGraph'])
operation='a'*32
capacity=dict(format='sabalan-c3-image-capacity-original/v1',operation=operation,producerImage=source['PRODUCER'],allOriginalChildrenClosed=True,sourceWorkspaceCreated=False,privateKeyRead=False,productionAdmission=False,capacity=dict(backupCanonicalReserveBytes=1024**3))
channel=(root/'deploy/scripts/original-image-repository-channel.py').read_bytes()
remote=(root/'deploy/scripts/original-image-repository-remote.py').read_bytes()
result=builder['build'](operation,'b'*32,images,capacity,'2026-10-31T00:00:00Z',source,channel,remote)
tree=ast.parse(result['source']);functions={n.name:ast.get_source_segment(result['source'].decode(),n) for n in tree.body if isinstance(n,ast.FunctionDef)}
assert 'floor+required+code_allocated' in functions['run_repository']
assert "'--max-old-space-size=128'" in functions['run_repository']
assert "'image-repository-'+OPERATION" in functions['run_repository']
assert 'BACKUP_ABSENT' in functions['run_repository'] and 'FileNotFoundError' in functions['run_repository']
assert not (q/'never-created-fixture-cipher').exists()
bad=json.loads(json.dumps(images));bad['frontend']['cipher']['sha256']='f'*64
try:
 builder['build'](operation,'b'*32,bad,capacity,'2026-10-31T00:00:00Z',source,channel,remote)
 raise RuntimeError('changed successful cipher accepted')
except AssertionError:pass
print(json.dumps(dict(sourceOnly=True,compiledBytes=result['bytes'],nativeExecuted=False,productionAdmission=False)))
