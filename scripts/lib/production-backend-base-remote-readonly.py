"""Read-only source archive/serving census. No export/build/tag/prune/start."""
import hashlib
import json
import os
from pathlib import Path
import stat

ARCHIVE=Path('/root/sabalan-recovery-private/production-image-export-b39dbefcc66448449f62d93159a31151/backend.docker.tar.gz')
SHA='d6f66240a68f8dbf264a0193b540435a2f8c4d11f9465db7873e0d1749532934'
INDEX='sha256:0772bcd13894be05d54c401134a197ff5906b6c5749fad53ed97de1238ddebaa'
SERVICES={'backend','frontend','inquiry','postgres','nginx','clamav'}
# The transfer's pinned source envelope prepends the host-tested class from
# production-backend-base-observer.py; no helper file is written on production.
OWNED=OriginalReadonlyObservers()

def require(value,code):
    if not value:raise RuntimeError(code)

def run(argv):
    return OWNED.run(argv)

def observe():
    # Every Docker observation first checks the actual production Compose.
    raw=run(['docker','compose','--env-file','deploy/.env.prod','-f','docker-compose.prod.yml','ps','--format','json'])
    try:rows=json.loads(raw);rows=rows if isinstance(rows,list) else [rows]
    except ValueError:rows=[json.loads(line) for line in raw.splitlines() if line.strip()]
    require(len(rows)==6 and {row['Service'] for row in rows}==SERVICES
      and all(row['Project']=='sabalanerp' and row['State']=='running' and row['Health']=='healthy' for row in rows),'BACKEND_BASE_PRODUCTION_TOPOLOGY_CHANGED')
    inspected=json.loads(run(['docker','inspect',*[row['ID'] for row in rows]]))
    require(len(inspected)==6,'BACKEND_BASE_PRODUCTION_INSPECTION_INCOMPLETE')
    result={}
    for value in inspected:
        labels=value['Config']['Labels'];service=labels['com.docker.compose.service']
        require(labels['com.docker.compose.project']=='sabalanerp' and service in SERVICES,'BACKEND_BASE_PRODUCTION_PROJECT_CHANGED')
        result[service]={'id':value['Id'],'image':value['Image'],'startedAt':value['State']['StartedAt']}
    require(result['backend']['image']==INDEX,'BACKEND_BASE_SOURCE_RUNTIME_IMAGE_CHANGED')
    return result

def identity(value):
    return {key:str(getattr(value,'st_'+key)) for key in ['dev','ino','size','mtime_ns','ctime_ns','mode','uid','nlink']}

def main():
    require(os.geteuid()==0,'BACKEND_BASE_READONLY_UID_UNPROVEN');os.chdir('/opt/sabalanerp')
    before=observe();require(ARCHIVE.resolve(strict=True)==ARCHIVE,'BACKEND_BASE_REMOTE_ALIAS')
    for directory in [ARCHIVE.parent,ARCHIVE.parent.parent]:
        value=directory.lstat();require(stat.S_ISDIR(value.st_mode) and value.st_uid==0 and not value.st_mode&0o077,'BACKEND_BASE_REMOTE_PARENT_UNPROVEN')
    descriptor=os.open(ARCHIVE,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    try:
        opened=os.fstat(descriptor);pinned=identity(opened)
        require(stat.S_ISREG(opened.st_mode) and opened.st_nlink==1 and opened.st_uid==0
          and not opened.st_mode&0o077 and opened.st_size==535457062,'BACKEND_BASE_REMOTE_FILE_UNPROVEN')
        require(identity(ARCHIVE.lstat())==pinned,'BACKEND_BASE_REMOTE_FILE_REPLACED')
        hashed=hashlib.sha256();count=0
        while chunk:=os.read(descriptor,262144):count+=len(chunk);require(count<=opened.st_size,'BACKEND_BASE_REMOTE_FILE_GREW');hashed.update(chunk)
        require(count==opened.st_size and hashed.hexdigest()==SHA,'BACKEND_BASE_REMOTE_BYTES_CHANGED')
        require(identity(os.fstat(descriptor))==pinned==identity(ARCHIVE.lstat()),'BACKEND_BASE_REMOTE_IDENTITY_CHANGED')
    finally:os.close(descriptor)
    after=observe();require(before==after,'BACKEND_BASE_SERVING_IDENTITIES_CHANGED')
    OWNED.assert_closed()
    require(not OWNED.signals,'BACKEND_BASE_READONLY_CONTROLLER_INTERRUPTED')
    space=os.statvfs(ARCHIVE.parent)
    print(json.dumps({'format':'sabalan-backend-base-source-readonly/v1','archive':str(ARCHIVE),'identity':pinned,
      'bytes':count,'sha256':SHA,'servicesBefore':before,'servicesAfter':after,
      'availableBytes':space.f_bavail*space.f_frsize,'productionMutation':False,'allOriginalObserversClosed':True}))

if __name__=='__main__':main()
