/** Preserve current SQLite and compare with the supported pre-UP backup, without exposing rows. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
const directory=import.meta.dirname,file=path.join(directory,'SQLITE-ROLLBACK-DIAGNOSIS.json');assert.ok(!fs.existsSync(file));
const parent=JSON.parse(fs.readFileSync(path.join(directory,'INQUIRY-SELECTION-EXECUTION-R3.json')));
const original=JSON.parse(fs.readFileSync(path.join(parent.privateDirectory,'original-inspections.json')));
const mount=original['backend-retained'].Mounts.find(row=>row.Name===original.inquiry.Mounts.find(row=>row.Destination==='/data').Name);
const code=String.raw`import os,sys,json,sqlite3,hashlib,re,base64
from pathlib import Path
p=json.load(sys.stdin);current=Path(p['current']);backup=Path(p['backup']);before=current.stat();current_sha=hashlib.sha256(current.read_bytes()).hexdigest()
for f in [current,backup]:assert all(not Path(str(f)+s).exists()for s in ['-wal','-shm','-journal'])
connections=[]
def connect(file):
 d=sqlite3.connect(file.as_uri()+'?mode=ro&immutable=1',uri=True);connections.append(d);assert d.execute('PRAGMA integrity_check').fetchall()==[('ok',)];return d
def encoded(v):return {'blob':base64.b64encode(v).decode()}if isinstance(v,bytes)else v
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()
def quoted(s):return '"'+s.replace('"','""')+'"'
try:
 a=connect(backup);b=connect(current);schema=lambda d:d.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE type IN ('table','index','trigger','view') ORDER BY type,name").fetchall()
 sa,sb=schema(a),schema(b);assert sa==sb,'SQLITE_SCHEMA_CHANGED'
 preserved=current.with_name('inquiry-after-rollback.db');assert not preserved.exists();out=sqlite3.connect(preserved)
 try:b.backup(out);assert out.execute('PRAGMA integrity_check').fetchall()==[('ok',)]
 finally:out.close()
 os.chmod(preserved,0o600)
 tables=[]
 for table, in a.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
  cols=a.execute('PRAGMA table_info('+quoted(table)+')').fetchall();names=[r[1]for r in cols];pk=[r[1]for r in sorted(cols,key=lambda r:r[5])if r[5]];sensitive=[n for n in names if re.search('password|secret|token|credential',n,re.I)];public=[n for n in names if n not in sensitive]
  ar=[dict(zip(names,row))for row in a.execute('SELECT * FROM '+quoted(table))];br=[dict(zip(names,row))for row in b.execute('SELECT * FROM '+quoted(table))]
  census=lambda rows:hashlib.sha256(canonical(sorted([[encoded(row[n])for n in public]for row in rows],key=lambda row:canonical(row)))).hexdigest()
  result={'table':table,'beforeRows':len(ar),'afterRows':len(br),'nonCredentialBeforeSha256':census(ar),'nonCredentialAfterSha256':census(br),'credentialColumns':sensitive}
  if pk:
   key=lambda row:canonical([encoded(row[n])for n in pk]);left={key(r):r for r in ar};right={key(r):r for r in br};result.update(addedRows=len(right.keys()-left.keys()),removedRows=len(left.keys()-right.keys()))
   changed={n:sum(left[k][n]!=right[k][n]for k in left.keys()&right.keys())for n in names};result['changedColumns']={n:c for n,c in changed.items()if c};result['credentialBytesUnchanged']=all(not changed[n]for n in sensitive)
  else:result['allBytesUnchanged']=sorted([canonical([encoded(r[n])for n in names])for r in ar])==sorted([canonical([encoded(r[n])for n in names])for r in br])
  tables.append(result)
 result={'format':'sabalan-419-sqlite-rollback-comparison/v1','readOnlyComparison':True,'qualified':False,'productionAdmission':False,'schemaUnchanged':True,'sourceCurrentSha256':current_sha,'preservedCurrent':{'file':str(preserved),'bytes':preserved.stat().st_size,'sha256':hashlib.sha256(preserved.read_bytes()).hexdigest()},'tables':tables}
finally:
 for d in connections:d.close()
after=current.stat();assert(before.st_dev,before.st_ino,before.st_size,before.st_mtime_ns,before.st_ctime_ns)==(after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns);assert hashlib.sha256(current.read_bytes()).hexdigest()==current_sha
print(json.dumps(result))`;
const status=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--format','json'],{encoding:'utf8'}).trim().split(/\r?\n/).map(JSON.parse);assert.equal(status.length,10);assert.ok(status.every(row=>row.Project==='sabalanerp-local'&&row.Health==='healthy'));
const raw=execFileSync('docker',['exec','-i',original['backend-retained'].Id,'/usr/bin/python3','-I','-B','-c',code],{input:JSON.stringify({current:mount.Destination+'/inquiry.db',backup:parent.sqliteBackup.file}),encoding:'utf8',maxBuffer:1024**2});
fs.writeFileSync(file,raw,{flag:'wx',mode:0o600});const value=JSON.parse(raw);console.log(JSON.stringify({file,schemaUnchanged:value.schemaUnchanged,changed:value.tables.filter(row=>Object.keys(row.changedColumns??{}).length||row.beforeRows!==row.afterRows)}));
