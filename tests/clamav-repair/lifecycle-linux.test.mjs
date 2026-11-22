import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
const cwd=new URL('../../',import.meta.url).pathname;
const docker=(...args)=>execFileSync('docker',args,{cwd,encoding:'utf8',timeout:70000}).trim();
const compose=(...args)=>docker('compose','-f','docker-compose.local.yml',...args);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const id='sabalanerp-local-clamav-1';
const readState=()=>docker('exec',id,'cat','/var/lib/clamav/.sabalan-updater-state');
const inspect=()=>JSON.parse(docker('inspect',id))[0];
test('updater death restarts the existing container without another request; unavailable scanner is never CLEAN',{timeout:180000},async()=>{
 assert.ok(compose('ps','clamav').includes(id));
 const before=readState(), next=Number(before.split(/\s+/)[3]);
 assert.ok(next>Date.now()/1000+180,'run this fault test away from the next naturally scheduled update');
 const cooldown=docker('exec',id,'sha256sum','/var/lib/clamav/freshclam.dat');
 const restarts=inspect().RestartCount;
 const uid=docker('exec',id,'sh','-ec','p="$(cat /run/sabalan-clamav/updater.pid)"; awk \'/^Uid:/{print $2}\' "/proc/$p/status"');
 assert.equal(uid,'100','updater must run without root privileges');
 docker('exec',id,'sh','-ec','kill -TERM "$(cat /run/sabalan-clamav/updater.pid)"');
 let restarted=false;
 for(let i=0;i<55;i++){ await sleep(1000);if(inspect().RestartCount>restarts){restarted=true;break;} }
 assert.equal(restarted,true,'supervisor must terminate instead of leaving a green tail process');
 await sleep(1500);
 assert.equal(readState(),before,'restart must retain the reserved next request slot');
 assert.equal(docker('exec',id,'sha256sum','/var/lib/clamav/freshclam.dat'),cooldown);
 compose('stop','-t','30','clamav');
 try {
  const result=compose('exec','-T','backend','node','-e',`const {scanHiringFile}=require('./dist/services/hrHiringFileStorage');(async()=>{try{await scanHiringFile('/etc/hosts');throw Error('UNSCANNED_ACCEPTED');}catch(e){if(e.message==='UNSCANNED_ACCEPTED')throw e;console.log('SCANNER_UNAVAILABLE_REJECTED');}})().catch(e=>{console.error(e.message);process.exitCode=1;});`);
  assert.match(result,/SCANNER_UNAVAILABLE_REJECTED/);
 } finally {compose('start','clamav');}
 let scanner=false;
 for(let i=0;i<75;i++) {
  try {docker('exec',id,'clamdscan','--ping=1');scanner=true;break;}catch{await sleep(1000);}
 }
 assert.equal(scanner,true,'scanner must recover after the fault test');
 assert.equal(readState(),before);
 assert.equal(docker('exec',id,'sha256sum','/var/lib/clamav/freshclam.dat'),cooldown);
});
