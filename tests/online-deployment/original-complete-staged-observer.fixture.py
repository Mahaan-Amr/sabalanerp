"""Whole staged observer, real private files/child EOF; modeled image/SQL ports.
Never grants native resources or application acceptance. No original DB access.
"""
import ast,base64,contextlib,hashlib,io,json,os,pathlib,shutil,subprocess,sys,tempfile
p=json.load(sys.stdin);source=base64.b64decode(p['source'],validate=True)
assert hashlib.sha256(source).hexdigest()==p['sha256']
v=p['fixture'];logical='/app/runtime-authority/application-native-'+'a'*32+'/restored-complete-app/coherent-private'
temporary=pathlib.Path(tempfile.mkdtemp(prefix='complete-observer-component-'));assert temporary.resolve()==temporary
def physical(name):
 assert name.startswith('/app/') and '..'not in pathlib.PurePosixPath(name).parts
 return temporary/name.lstrip('/')
def put(name,raw):
 file=physical(name);file.parent.mkdir(parents=True,exist_ok=True,mode=0o700);file.write_bytes(raw);file.chmod(0o400)
def encode(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
class OriginalModelPath:
 def __init__(self,value):self.value=str(value)
 def __str__(self):return self.value
 def __fspath__(self):return str(physical(self.value))
 def __truediv__(self,name):return OriginalModelPath(self.value+'/'+str(name))
 def __eq__(self,other):return isinstance(other,OriginalModelPath)and self.value==other.value
 def resolve(self,strict=False):
  file=physical(self.value);assert file.resolve(strict=strict)==file
  return self
 def stat(self):return physical(self.value).stat()
 def lstat(self):return physical(self.value).lstat()
 def is_dir(self):return physical(self.value).is_dir()
 def exists(self):return physical(self.value).exists()
 def read_bytes(self):return physical(self.value).read_bytes()
 def is_relative_to(self,other):return pathlib.PurePosixPath(self.value).is_relative_to(other.value)
original_popen=subprocess.Popen;children=[];previous_dsn=os.environ.get('DATABASE_URL')
try:
 index,config=v['index'],v['config'];index['grants']=[];index['restoredQaLineage']=v['restoredQaLineage']
 for grant in [index['privateQualification']['httpGrant'],index['privateQualification']['jobsGrant']]:
  grant['scope'].update(nativeDirectory=logical+'/unstarted/native/'+grant['scope']['runtimeId'],boundaryDirectory=logical+'/unstarted/work/'+grant['scope']['runtimeId'])
  grant['sha256']=hashlib.sha256(encode(grant['scope'])).hexdigest()
 entry=b'MODELED_IMAGE_ENTRY';config['privateQualificationRuntime']['entrySha256']=hashlib.sha256(entry).hexdigest();put('/app/dist/onlinePrivateQualification.js',entry)
 manifest=json.loads(base64.b64decode(v['facts']['restoreManifestRawBase64']));manifest['capturedManifest']['path']=logical+'/complete-manifest-value.json'
 completed=v['baselineCompletion']
 for row in manifest['sources']:
  live,store=physical(row['liveRoot']),physical(row['storeRoot']);live.mkdir(parents=True,mode=0o700);store.mkdir(parents=True,mode=0o700);s=live.stat()
  proof=encode(dict(publicOnlineAdmission=False,source=dict(path=row['liveRoot'],device=str(s.st_dev),inode=str(s.st_ino))))
  put(row['storeRoot']+'/legacy-adoption-'+manifest['captureId']+'.json',proof)
  next(x for x in completed['proofs']if x['name']==row['name'])['sha256']=hashlib.sha256(proof).hexdigest()
 for name in ['bi-reports','reports','sales-reports']:physical(index['privateQualification']['qualificationRoot']+'/storage/'+name).mkdir(parents=True,mode=0o700)
 manifest_raw=encode(manifest);completed['manifestSha256']=hashlib.sha256(manifest_raw).hexdigest()
 for name,key in [('complete-manifest-value.json','completeManifestValueRawBase64'),('working-manifest-value.json','workingManifestValueRawBase64'),('native-history-value.json','nativeHistoryRawBase64')]:put(logical+'/'+name,base64.b64decode(v['facts'][key]))
 for name,value in [('index.json',index),('config.json',config),('restored-file-baseline.json.completed.json',completed)]:put(logical+'/'+name,encode(value))
 put(logical+'/restored-file-baseline.json',manifest_raw)
 for directory in temporary.rglob('*'):
  if directory.is_dir():directory.chmod(0o700)
 os.environ['DATABASE_URL']='postgresql://modeled:private@postgres:5432/sabalanerp'
 def sql_original(argv,**kwargs):
  assert argv[0]=='psql'and argv[-1].startswith('BEGIN READ ONLY; SELECT json_build_object(')and argv[-1].endswith('; COMMIT;')
  data={**v['facts']['database'],'visible':True,'sessions':0,'prepared':0}
  child=original_popen([sys.executable,'-I','-B','-c','import json;print(json.dumps('+repr(data)+'))'],stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE);children.append(child);return child
 tree=ast.parse(source);boundary=next(i for i,node in enumerate(tree.body)if isinstance(node,ast.Try))
 namespace={'__name__':'staged_observer_component'};sys.stdin=io.StringIO(json.dumps({'root':logical}))
 for node in tree.body[:boundary]:
  exec(compile(ast.Module(body=[node],type_ignores=[]),'<actual-staged-observer-prefix>','exec'),namespace)
  if isinstance(node,ast.ImportFrom)and node.module=='pathlib':namespace['Path']=OriginalModelPath
 runtime=config['privateQualificationRuntime']
 namespace['inventory']=lambda directory:runtime['distTreeSha256']if str(directory)=='/app/dist'else runtime['clientInventorySha256']
 subprocess.Popen=sql_original;output=io.StringIO()
 with contextlib.redirect_stdout(output):exec(compile(ast.Module(body=tree.body[boundary:],type_ignores=[]),'<actual-staged-observer-body>','exec'),namespace)
 assert all(c.poll()==0 and c.stdout.closed and c.stderr.closed for c in children)
 facts=json.loads(output.getvalue());print(json.dumps({'facts':facts,'config':config,'index':index,'baselineCompletion':completed,'children':[{'originalPid':c.pid,'code':c.returncode,'stdoutEof':c.stdout.closed,'stderrEof':c.stderr.closed}for c in children],'nativeAcceptance':False}))
finally:
 subprocess.Popen=original_popen
 for c in children:
  if c.poll()is None:c.communicate()
 if previous_dsn is None:os.environ.pop('DATABASE_URL',None)
 else:os.environ['DATABASE_URL']=previous_dsn
 assert temporary.resolve()==temporary and temporary.parent==pathlib.Path(tempfile.gettempdir()).resolve()and temporary.name.startswith('complete-observer-component-')
 shutil.rmtree(temporary)
