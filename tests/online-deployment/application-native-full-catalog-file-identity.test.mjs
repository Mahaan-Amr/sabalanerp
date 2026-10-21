import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {assertCatalogDescriptorMatchesNamed} from '../../scripts/lib/application-native-full-catalog-artifacts.mjs';
const named={dev:0n,ino:123n,size:45n,mtimeNs:100n,ctimeNs:200n,nlink:1n,mode:0o100400n};
test('only Windows device-domain difference is allowed; Linux device mismatch refuses',()=>{
 assert.doesNotThrow(()=>assertCatalogDescriptorMatchesNamed({...named,dev:3055882712n},named,'win32'));
 assert.throws(()=>assertCatalogDescriptorMatchesNamed({...named,dev:3055882712n},named,'linux'));
});
test('Windows inode, size, both times, links and mode remain strict cross-domain',()=>{
 for(const key of ['ino','size','mtimeNs','ctimeNs','nlink','mode'])assert.throws(()=>assertCatalogDescriptorMatchesNamed({...named,dev:3055882712n,[key]:named[key]+1n},named,'win32'));
});
test('real named and opened file match while a real path replacement is rejected',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'catalog-stat-regression-')),file=path.join(root,'source.bin');fs.writeFileSync(file,'actual source');const before=fs.lstatSync(file,{bigint:true}),fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
 try{const opened=fs.fstatSync(fd,{bigint:true});assert.doesNotThrow(()=>assertCatalogDescriptorMatchesNamed(opened,before));fs.renameSync(file,path.join(root,'original.bin'));fs.writeFileSync(file,'actual source');assert.throws(()=>assertCatalogDescriptorMatchesNamed(opened,fs.lstatSync(file,{bigint:true})));}
 finally{fs.closeSync(fd);fs.rmSync(file);fs.rmSync(path.join(root,'original.bin'));fs.rmdirSync(root);}
});
