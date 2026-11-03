"""Fixed metadata-only backup filesystem inventory. No cleanup or audit append."""
import fcntl
import hashlib
import heapq
import json
import os
import pathlib
import stat
import subprocess

assert os.getuid() == 0
lock = '/run/lock/sabalan-backup-storage.lock'
fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
owned = os.fstat(fd); named = os.stat(lock, follow_symlinks=False)
assert stat.S_ISREG(owned.st_mode) and owned.st_uid == 0 and owned.st_nlink == 1
assert (owned.st_dev, owned.st_ino) == (named.st_dev, named.st_ino)
assert not owned.st_mode & 0o022

commands = []
def run(argv, maximum=4*1024**2):
    child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    out, err = child.communicate()
    assert child.stdout.closed and child.stderr.closed and len(out) <= maximum and len(err) <= 131072
    commands.append({'argv':argv,'pid':child.pid,'code':child.returncode,
                     'stdoutEof':True,'stderrEof':True,'stdoutSha256':hashlib.sha256(out).hexdigest(),
                     'stderrSha256':hashlib.sha256(err).hexdigest()})
    return child.returncode, out, err

def metadata(p):
    s = os.lstat(p)
    return {'path':p,'realpath':os.path.realpath(p),'device':s.st_dev,'inode':s.st_ino,
            'uid':s.st_uid,'gid':s.st_gid,'mode':stat.S_IMODE(s.st_mode),'nlink':s.st_nlink,
            'logicalBytes':s.st_size,'allocatedBytes':s.st_blocks*512,
            'mtimeNs':s.st_mtime_ns,'ctimeNs':s.st_ctime_ns,'symlink':stat.S_ISLNK(s.st_mode)}

target = '/srv/sabalanerp-recovery/checkpoints'
assert os.path.realpath(target) == target
v = os.statvfs(target); target_device = os.stat(target).st_dev
report = {'format':'sabalan-419-readonly-filesystem-inventory/v1','target':metadata(target),
          'filesystem':{'device':target_device,'blockSize':v.f_frsize,'blocks':v.f_blocks,
                        'freeBlocks':v.f_bfree,'availableBlocks':v.f_bavail,
                        'totalBytes':v.f_blocks*v.f_frsize,'freeBytes':v.f_bfree*v.f_frsize,
                        'availableBytes':v.f_bavail*v.f_frsize,
                        'filesystemReservedBytes':(v.f_bfree-v.f_bavail)*v.f_frsize,
                        'totalInodes':v.f_files,'freeInodes':v.f_ffree,'availableInodes':v.f_favail},
          'cleanupPerformed':False,'canonicalAuditAppend':False,'fullAccepted':False,
          'machineUuidSha256':hashlib.sha256(pathlib.Path('/etc/machine-id').read_bytes()).hexdigest()}
for name, argv in [('mount',['findmnt','-J','-T',target,'-o','TARGET,SOURCE,FSTYPE,MAJ:MIN,FSROOT,UUID']),
                   ('blockDevices',['lsblk','-b','-J','-o','NAME,PATH,TYPE,SIZE,FSTYPE,MOUNTPOINT,PKNAME,MAJ:MIN'])]:
    code, out, _ = run(argv); report[name] = {'code':code,'value':json.loads(out) if code == 0 else None}
report['usage'] = []
for root in ['/', '/srv', '/srv/sabalanerp-recovery', '/root', '/var', '/var/log', '/var/cache', '/opt', '/tmp', '/var/tmp']:
    if not os.path.isdir(root) or os.path.islink(root):
        continue
    code, out, err = run(['du','-x','-B1','--max-depth=2' if root not in ['/','/var'] else '--max-depth=1',root])
    rows = []
    for line in out.decode('utf-8',errors='strict').splitlines():
        amount, name = line.split('\t',1); rows.append({'path':name,'allocatedBytes':int(amount)})
    report['usage'].append({'root':root,'code':code,'partial':code != 0,'rows':rows,
                            'stderrBytes':len(err),'rootMetadata':metadata(root)})

code, out, _ = run(['docker','compose','ls','--format','json'])
report['dockerComposeInventory'] = {'code':code,'value':json.loads(out) if code == 0 else None}
code, out, _ = run(['docker','info','--format','{"root":{{json .DockerRootDir}},"driver":{{json .Driver}},"driverStatus":{{json .DriverStatus}}}'])
assert code == 0; report['dockerStore'] = json.loads(out)
docker_root = report['dockerStore']['root']
report['dockerStore']['metadata'] = metadata(docker_root)
code, out, _ = run(['du','-x','-B1','--max-depth=1',docker_root])
report['dockerStore']['usage'] = {'code':code,'rows':[{'allocatedBytes':int(x.split('\t',1)[0]),'path':x.split('\t',1)[1]} for x in out.decode().splitlines()]}
code, out, _ = run(['docker','ps','--all','--quiet','--no-trunc']); assert code == 0
ids = out.decode().splitlines(); report['containers'] = []
if ids:
    fmt = '{"id":{{json .Id}},"image":{{json .Image}},"running":{{json .State.Running}},"status":{{json .State.Status}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}}}'
    code, out, _ = run(['docker','inspect','--format',fmt,*ids]); assert code == 0
    report['containers'] = [json.loads(x) for x in out.decode().splitlines()]
code, out, _ = run(['docker','image','ls','--all','--quiet','--no-trunc']); assert code == 0
ids = sorted(set(out.decode().splitlines())); report['images'] = []
if ids:
    fmt = '{"id":{{json .Id}},"bytes":{{json .Size}},"created":{{json .Created}},"tags":{{json .RepoTags}},"project":{{json (index .Config.Labels "com.docker.compose.project")}}}'
    code, out, _ = run(['docker','image','inspect','--format',fmt,*ids]); assert code == 0
    report['images'] = [json.loads(x) for x in out.decode().splitlines()]

# Canonical protection snapshot only: no preflight/audit/cleanup is invoked.
snapshot = r'''import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const file='/opt/sabalanerp-recovery/scripts/deployment-storage.mjs';assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'),'78806f96895513405612536a6e6e27990e9110b71c2d21b6092e761f417faa2b');
const {dockerStorageAdapter,planStorageCleanup}=await import(file);
const lock='/run/lock/sabalan-backup-storage.lock',assertLock=async()=>{const n=fs.lstatSync(lock,{bigint:true}),h=fs.fstatSync(9,{bigint:true});assert.equal(n.dev,h.dev);assert.equal(n.ino,h.ino);assert.ok(fs.readFileSync('/proc/self/fdinfo/9','utf8').includes('FLOCK  ADVISORY  WRITE'));};
const adapter=dockerStorageAdapter({project:'sabalanerp-backup',storageRoot:'/srv/sabalanerp-recovery',checkpointRoots:['/srv/sabalanerp-recovery/checkpoints'],documents:[],journalRoots:[],protectedImages:[],auditPath:'/var/log/sabalanerp-backup/storage-cleanup.jsonl',assertLock});
const inventory=await adapter.snapshot();await assertLock();console.log(JSON.stringify({inventory,plan:planStorageCleanup(inventory),auditWritten:false}));'''
os.dup2(fd,9,inheritable=True); os.set_inheritable(9,True)
child = subprocess.Popen(['/usr/bin/node','--input-type=module','-e',snapshot],stdin=subprocess.DEVNULL,
                         stdout=subprocess.PIPE,stderr=subprocess.PIPE,pass_fds=(9,))
out, err = child.communicate()
assert len(out) <= 4*1024**2 and len(err) <= 65536
report['protectionSnapshot'] = {'code':child.returncode,'value':json.loads(out) if child.returncode == 0 else None,
                                'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,
                                'stderrSha256':hashlib.sha256(err).hexdigest()}
commands.append({'argv':['node','fixed-canonical-protection-snapshot'],'pid':child.pid,'code':child.returncode,
                 'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed})

# Metadata only. Recovery trees, image stores and credentials are never candidates.
excluded = ['/proc','/sys','/dev',target,docker_root,'/var/lib/containerd','/root/.ssh','/etc/ssh','/etc/ssl/private']
largest = []; seen = set(); scan_errors = 0; skipped = set(); scanned = 0
scan_root=report['mount']['value']['filesystems'][0]['target']
for base, dirs, files in os.walk(scan_root,topdown=True,followlinks=False):
    keep = []
    for name in dirs:
        p = os.path.join(base,name)
        try:
            s = os.lstat(p)
            protected = any(p == x or p.startswith(x+'/') for x in excluded) or any(x in name.lower() for x in ['recovery','checkpoint','hold','incident','journal'])
            if protected or stat.S_ISLNK(s.st_mode) or s.st_dev != target_device:
                skipped.add(p)
            else:
                keep.append(name)
        except OSError:
            scan_errors += 1
    dirs[:] = keep
    for name in files:
        p = os.path.join(base,name)
        try:
            s = os.lstat(p); scanned += 1
            if not stat.S_ISREG(s.st_mode) or s.st_dev != target_device or (s.st_dev,s.st_ino) in seen:
                continue
            seen.add((s.st_dev,s.st_ino))
            if s.st_blocks*512 >= 32*1024**2:
                heapq.heappush(largest,(s.st_blocks*512,p))
                if len(largest)>100:heapq.heappop(largest)
        except OSError:
            scan_errors += 1
report['largeFilesOutsideProtectedTrees'] = []
for _,p in sorted(largest,reverse=True):
    try:report['largeFilesOutsideProtectedTrees'].append(metadata(p))
    except OSError:scan_errors+=1
report['scan'] = {'filesVisited':scanned,'errors':scan_errors,'excludedRoots':sorted(skipped),
                  'hardlinksDeduplicated':True,'deletionEligibilityAccepted':False}

open_refs=[]; deleted=[]; proc_errors=0
large_ids={(r['device'],r['inode']) for r in report['largeFilesOutsideProtectedTrees']}
for proc in pathlib.Path('/proc').iterdir():
    if not proc.name.isdigit():continue
    try:
        for leaf in (proc/'fd').iterdir():
            try:
                link=os.readlink(leaf); s=os.stat(leaf)
                row={'pid':int(proc.name),'fd':leaf.name,'target':link,'device':s.st_dev,'inode':s.st_ino,
                     'logicalBytes':s.st_size,'allocatedBytes':s.st_blocks*512}
                if s.st_dev == target_device and link.endswith(' (deleted)'):deleted.append(row)
                if (s.st_dev,s.st_ino) in large_ids:open_refs.append(row)
            except OSError:proc_errors+=1
    except OSError:proc_errors+=1
report['openFileObservation']={'largeFileReferences':open_refs,'deletedFiles':deleted,'errors':proc_errors,
                               'pointInTimeOnly':True}
after=os.stat(lock,follow_symlinks=False)
assert (owned.st_dev,owned.st_ino)==(after.st_dev,after.st_ino)
report['originalStorageLock']={'device':owned.st_dev,'inode':owned.st_ino,'exclusive':True}
report['originalCommands']=commands
v=os.statvfs(target);report['availableBytesAfter']=v.f_bavail*v.f_frsize
print(json.dumps(report))
