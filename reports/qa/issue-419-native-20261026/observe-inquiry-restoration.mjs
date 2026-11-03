/** Read-only diagnosis while the original selection owner retains its lease. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const directory=import.meta.dirname,file=path.join(directory,'INQUIRY-RESTORATION-DIAGNOSIS.json');assert.ok(!fs.existsSync(file));
const parent=JSON.parse(fs.readFileSync(path.join(directory,'INQUIRY-SELECTION-EXECUTION-R3.json')));
assert.equal(parent.phase,'HELD_RESTORATION_UNPROVEN');
const original=JSON.parse(fs.readFileSync(path.join(parent.privateDirectory,'original-inspections.json'))).inquiry;
const status=execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps','--all','--no-trunc','--format','json'],{encoding:'utf8'}).trim().split(/\r?\n/).map(JSON.parse);
assert.equal(status.length,10);assert.ok(status.every(row=>row.Project==='sabalanerp-local'&&row.Health==='healthy'));
const [actual]=JSON.parse(execFileSync('docker',['inspect',status.find(row=>row.Service==='inquiry').ID],{encoding:'utf8'}));
const sha=value=>createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');
function differences(a,b,prefix=''){
 if(JSON.stringify(a)===JSON.stringify(b))return [];
 if(a&&b&&typeof a==='object'&&typeof b==='object'&&!Array.isArray(a)&&!Array.isArray(b))return [...new Set([...Object.keys(a),...Object.keys(b)])].flatMap(key=>differences(a[key],b[key],prefix+'.'+key));
 return [{path:prefix,beforeType:a===null?'null':Array.isArray(a)?'array':typeof a,afterType:b===null?'null':Array.isArray(b)?'array':typeof b,beforeSha256:sha(a),afterSha256:sha(b)}];
}
const source=String.raw`const f=require('fs'),c=require('crypto'),p='/data/inquiry.db';const s=f.statSync(p,{bigint:true}),raw=f.readFileSync(p),a=f.statSync(p,{bigint:true});for(const k of ['dev','ino','size','mtimeNs','ctimeNs'])if(a[k]!==s[k])throw Error('SQLITE_CHANGED');console.log(JSON.stringify({main:{path:p,device:String(s.dev),inode:String(s.ino),size:String(s.size),mode:String(s.mode),uid:String(s.uid),gid:String(s.gid),mtimeNs:String(s.mtimeNs),ctimeNs:String(s.ctimeNs),sha256:c.createHash('sha256').update(raw).digest('hex')},sidecars:['-wal','-shm','-journal'].filter(x=>f.existsSync(p+x))}));`;
execFileSync('docker',['compose','-f','D:/sabalanerp/docker-compose.local.yml','ps'],{stdio:'pipe'});
const sqlite=JSON.parse(execFileSync('docker',['exec',actual.Id,'node','-e',source],{encoding:'utf8'}));
assert.deepEqual(sqlite.main,parent.sqliteBefore.main);assert.deepEqual(sqlite.sidecars,[]);
const report={format:'sabalan-419-held-restoration-readonly-diagnosis/v1',readOnly:true,productionAdmission:false,qualified:false,originalLeaseNotAdopted:true,
 nativeDescriptor:actual.ImageManifestDescriptor,expectedPlatform:parent.rollbackGraph.platform,sqlitePreserved:true,
 hostConfigDifferences:differences(original.HostConfig,actual.HostConfig),configDifferences:differences(original.Config,actual.Config),
 mountDifferences:differences(original.Mounts,actual.Mounts),networkDifferences:differences(original.NetworkSettings,actual.NetworkSettings)};
fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});console.log(JSON.stringify(report));
