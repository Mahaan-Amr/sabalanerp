"""Authorized read-only size/ownership audit; no cleanup, service changes or data reads."""
import fcntl
import hashlib
import json
import os
import pathlib
import stat
import subprocess

assert os.getuid() == 0
lock = '/run/lock/sabalan-backup-storage.lock'
fd = os.open(lock, os.O_RDONLY | os.O_NOFOLLOW)
fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
held = os.fstat(fd)
assert stat.S_ISREG(held.st_mode) and held.st_uid == 0 and held.st_nlink == 1 and not held.st_mode & 0o022
commands = []
def run(argv, maximum=4*1024**2):
    child = subprocess.Popen(argv,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    out, err = child.communicate()
    assert len(out) <= maximum and len(err) <= 65536
    commands.append({'argv':argv,'pid':child.pid,'code':child.returncode,'stdoutEof':child.stdout.closed,'stderrEof':child.stderr.closed,
                     'stdoutSha256':hashlib.sha256(out).hexdigest(),'stderrSha256':hashlib.sha256(err).hexdigest()})
    return child.returncode,out
def du(root,depth=2):
    assert os.path.realpath(root) == root and os.path.isdir(root)
    code, raw = run(['du','-x','-B1','--max-depth='+str(depth),root])
    rows = []
    for line in raw.decode().splitlines():
        amount,name = line.split('\t',1)
        rows.append({'path':name,'allocatedBytes':int(amount)})
    return {'root':root,'code':code,'rows':sorted(rows,key=lambda x:x['allocatedBytes'],reverse=True)}
report = {'format':'sabalan-backup-deep-storage-readonly/v1','cleanupPerformed':False,'canonicalAuditAppend':False,'fullAccepted':False,'commands':commands}
_, raw = run(['docker','ps','--all','--quiet','--no-trunc'])
ids = raw.decode().splitlines()
fmt = '{"id":{{json .Id}},"name":{{json .Name}},"running":{{json .State.Running}},"project":{{json (index .Config.Labels "com.docker.compose.project")}},"service":{{json (index .Config.Labels "com.docker.compose.service")}},"mounts":{{json .Mounts}}}'
report['containers'] = []
if ids:
    code, raw = run(['docker','inspect','--format',fmt,*ids]);assert code == 0
    report['containers'] = [json.loads(x) for x in raw.decode().splitlines()]
code, raw = run(['docker','volume','ls','--quiet']);assert code == 0
report['volumes'] = []
for name in raw.decode().splitlines():
    code, details = run(['docker','volume','inspect','--format','{"name":{{json .Name}},"driver":{{json .Driver}},"mountpoint":{{json .Mountpoint}},"labels":{{json .Labels}}}',name]);assert code == 0
    row = json.loads(details)
    row['references'] = [{'container':c['name'],'running':c['running'],'project':c['project'],'service':c['service'],'destination':m['Destination']} for c in report['containers'] for m in c['mounts'] if m.get('Type') == 'volume' and m.get('Name') == name]
    if row['driver'] == 'local' and os.path.isdir(row['mountpoint']) and os.path.realpath(row['mountpoint']) == row['mountpoint']:
        row['usage'] = du(row['mountpoint'],2)
    report['volumes'].append(row)
report['extraUsage'] = []
for root in ['/var/lib','/var/lib/snapd','/root/sabalan-recovery-private/native-qa','/root/sabalan-recovery-private/physical-replay-r4-20261015','/srv/sabalanerp-recovery/checkpoints/images']:
    if os.path.isdir(root) and not os.path.islink(root):
        report['extraUsage'].append(du(root,2 if root != '/var/lib' else 1))
report['logFiles'] = []
for p in pathlib.Path('/var/log').iterdir():
    s = p.lstat()
    if stat.S_ISREG(s.st_mode) and s.st_blocks*512 >= 8*1024**2:
        report['logFiles'].append({'path':str(p),'allocatedBytes':s.st_blocks*512,'logicalBytes':s.st_size,'mtimeNs':s.st_mtime_ns,'uid':s.st_uid,'gid':s.st_gid,'inode':s.st_ino})
code, raw = run(['journalctl','--disk-usage']);report['journalDiskUsage'] = {'code':code,'text':raw.decode().strip()}
code, raw = run(['journalctl','--list-boots','--no-pager']);report['journalBoots'] = {'code':code,'text':raw.decode().strip()}
report['journalFiles'] = []
for base, dirs, files in os.walk('/var/log/journal'):
    for name in files:
        p = pathlib.Path(base)/name;s=p.lstat()
        if stat.S_ISREG(s.st_mode):
            report['journalFiles'].append({'path':str(p),'allocatedBytes':s.st_blocks*512,'mtimeNs':s.st_mtime_ns,'archived':name.endswith('.journal') and '@' in name})
report['packageProcesses'] = []
for p in pathlib.Path('/proc').iterdir():
    if not p.name.isdigit():continue
    try:
        comm=(p/'comm').read_text().strip()
        if any(x in comm.lower() for x in ['apt','dpkg','unattended','npm','npx']):
            report['packageProcesses'].append({'pid':int(p.name),'name':comm})
    except OSError:pass
after=os.stat(lock,follow_symlinks=False)
assert (held.st_dev,held.st_ino)==(after.st_dev,after.st_ino)
report['originalStorageLock']={'device':held.st_dev,'inode':held.st_ino,'exclusive':True}
v=os.statvfs('/srv/sabalanerp-recovery/checkpoints')
report['availableBytesAfter']=v.f_bavail*v.f_frsize
print(json.dumps(report))
