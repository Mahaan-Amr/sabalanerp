"""Fixed, previously executed local host runtime; never production authority."""
import hashlib,json,os,re,stat
from pathlib import Path
QUALIFICATION_SHA='234265c34dfb5514f2cc8357f4c770d91576e6da387997eec91854f800feb918'
EXTRACTION_SHA='474dae1c2f13cbe81a8d3d28a8dcaae721d37bd7244790e99bff99dd37438487'
DOCKER='/mnt/host/wsl/docker-desktop/cli-tools/usr/bin/docker'
COMPOSE='/mnt/host/wsl/docker-desktop/cli-tools/usr/local/lib/docker/cli-plugins/docker-compose'
def require(value,code):
 if not value:raise RuntimeError('ONLINE_LOCAL_HOST_'+code)
def digest(file):
 file=Path(file);require(file.resolve(strict=True)==file,'PATH_ALIAS')
 fd=os.open(file,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
 try:
  before=os.fstat(fd);require(stat.S_ISREG(before.st_mode) and 0<=before.st_size<=64*1024**2,'FILE_TYPE')
  h=hashlib.sha256()
  while True:
   b=os.read(fd,1024*1024)
   if not b:break
   h.update(b)
  key=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns,s.st_mode,s.st_uid,s.st_nlink)
  require(key(before)==key(os.fstat(fd))==key(file.lstat()),'FILE_CHANGED')
  return h.hexdigest(),before.st_size
 finally:os.close(fd)
def private(file,directory=False):
 p=Path(file);s=p.lstat();require(p.resolve(strict=True)==p and s.st_uid==0 and not s.st_mode&0o077 and (stat.S_ISDIR(s.st_mode) if directory else stat.S_ISREG(s.st_mode) and s.st_nlink==1 and not s.st_mode&0o222),'PRIVATE_PATH')
def validate(value):
 require(set(value)=={'format','root','qualificationSha256'} and value['format']=='sabalan-qualified-local-host-runtime/v1' and value['qualificationSha256']==QUALIFICATION_SHA,'DESCRIPTOR')
 root=Path(value['root']);require(re.fullmatch(r'/var/lib/sabalan-online-host-[a-f0-9]{32}',str(root)),'ROOT')
 private(root,True);q=root/'qualification-r5.json';x=root/'extraction-receipt.json'
 for f in(q,x):private(f)
 require(digest(q)[0]==QUALIFICATION_SHA and digest(x)[0]==EXTRACTION_SHA,'ORIGINAL_RECEIPT')
 qualification=json.loads(q.read_bytes());extraction=json.loads(x.read_bytes())
 require(qualification['pass']is True and qualification['originalClosure']['allOriginalChildrenClosed']is True and qualification['extractionReceiptSha256']==EXTRACTION_SHA and extraction['copiedInventoryVerified']is True,'ORIGINAL_FACTS')
 require(extraction['sourceContainer']['image']=='sha256:3da35cf09d7da919cab2d0e1c7b3dcdf98951529668d03488b99b6003c6d6751','SOURCE_IMAGE')
 sysroot=root/'sysroot';private(sysroot,True);pins={str(q):QUALIFICATION_SHA,str(x):EXTRACTION_SHA};expected={}
 for p,row in extraction['inventory']['files'].items():expected[p]=row
 for p,target in extraction['inventory']['links'].items():
  actual=os.path.normpath(target if target.startswith('/') else os.path.dirname(p)+'/'+target);expected[p]=extraction['inventory']['files'][actual]
 require(len(expected)<10000,'INVENTORY_BOUND')
 for p,row in expected.items():
  require(p.startswith(('/usr/','/lib/','/lib64/','/etc/')) and '..'not in p.split('/'),'INVENTORY_PATH')
  f=sysroot/p[1:];private(f);require(digest(f)==(row['sha256'],row['bytes']),'RUNTIME_BYTES');pins[str(f)]=row['sha256']
 actual=set();actual_directories=set();expected_directories={'.'}
 for p in expected:
  for parent in Path(p[1:]).parents:expected_directories.add(str(parent))
 for base,dirs,names in os.walk(sysroot,followlinks=False):
  private(base,True);actual_directories.add(str(Path(base).relative_to(sysroot)))
  for name in dirs:private(Path(base)/name,True)
  for name in names:actual.add('/'+str((Path(base)/name).relative_to(sysroot)))
 require(actual==set(expected)and actual_directories==expected_directories,'EXTRA_RUNTIME_FILE')
 for file,row in qualification['dockerPins'].items():
  require(file in(DOCKER,COMPOSE) and digest(file)==(row['sha256'],row['bytes']),'DOCKER_BYTES')
  target=root/('bin/docker'if file==DOCKER else'plugins/docker-compose');private(target);require(digest(target)==(row['sha256'],row['bytes']),'PRIVATE_DOCKER_BYTES');pins[str(target)]=row['sha256']
 require(set(qualification['dockerPins'])=={DOCKER,COMPOSE},'DOCKER_SET')
 config=root/'docker-config';private(config,True);private(config/'config.json')
 require(json.loads((config/'config.json').read_bytes())=={'cliPluginsExtraDirs':[str(root/'plugins')]},'DOCKER_CONFIG')
 pins[str(config/'config.json')]=digest(config/'config.json')[0]
 libraries=sorted({str((sysroot/p[1:]).parent)for p in expected if not p.startswith('/usr/lib/python3.11/')})
 loader=str(sysroot/'usr/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2');python=str(sysroot/'usr/bin/python3.11')
 require(loader in pins and python in pins,'PYTHON_CLOSURE')
 return {'python':[loader,'--library-path',':'.join(libraries),python,'-I','-B'],'docker':[str(root/'bin/docker'),'--config',str(config),'--host','unix:///run/docker.sock'],'pins':pins,'qualificationSha256':QUALIFICATION_SHA}