import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';

// The real CLI parser/async context loop runs unchanged. I/O and the controller
// constructor are explicit fixtures; this does not mint a runtime owner.
const source=fs.readFileSync('deploy/scripts/online-release-controller-cli.mjs','utf8').replace(/^#!.*\r?\n/,'').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../deploy/scripts/online-release-controller-cli.mjs',import.meta.url).href));
function fixture(){
 const main=new PassThrough(),contextInput=new PassThrough(),events=[],calls=[],closedFds=[];
 let notify;const attention=new Promise(resolve=>{notify=resolve;});
 const forever=()=>new Promise(()=>{});
 let allClosed=false,prepared=false,closed=false;
 class Controller{
  async prepareOriginalControllerClose(){calls.push('prepare');assert.ok(allClosed,'ACTORS_STILL_LIVE');prepared=true;return {};}
  async closeOriginalController(){assert.ok(prepared);calls.push('close');closed=true;return {};}
  assertAllOriginalChildrenClosed(){assert.ok(allClosed,'ACTORS_STILL_LIVE');}
  retainOriginalContextFailure(){calls.push('context-held');notify('held');return forever();}
  hold(){calls.push('held');notify('held');return forever();}
 }
 const options={owner:{},publicationLock:{},continuousContext:{requestFd:10,responseFd:11}};
 const stat={isFIFO:()=>true,isFile:()=>true,nlink:1,uid:0,mode:0o600,size:1};
 const context={Buffer,URL,createInterface,OriginalOnlineReleaseController:Controller,BrowserRoutingPublicationLock:class {},
  createRequire:()=>()=>({PrismaClient:class{async $disconnect(){calls.push('disconnect');}}}),
  fs:{constants:{O_RDONLY:0,O_NOFOLLOW:0,O_NONBLOCK:0},realpathSync:()=>'/config',openSync:()=>9,fstatSync:()=>stat,readFileSync:()=>JSON.stringify(options),closeSync:fd=>closedFds.push(fd),createReadStream:()=>contextInput},
  process:{platform:'linux',getuid:()=>0,argv:['node','cli','/config'],env:{DATABASE_URL:'postgresql://fixture@localhost/test?connection_limit=1&pool_timeout=10'},stdin:main,stdout:{write(raw){const value=JSON.parse(raw);events.push(value);notify(value.event);}},stderr:{write(){}}},
 };
 const running=vm.runInNewContext('(async()=>{'+source+'})()',context);
 return {main,contextInput,events,calls,closedFds,running,attention,setAllClosed(){allClosed=true;},get closed(){return closed;},send(sequence,command){main.write(JSON.stringify({sequence,command})+'\n');}};
}
async function nextTurn(){await new Promise(resolve=>setImmediate(resolve));}

test('actual CLI waits for the original context EOF between prepared close and controller/database closure',async()=>{
 const f=fixture();f.setAllClosed();f.send(1,'PREPARE_CONTROLLER_CLOSE');await f.attention;
 assert.equal(f.events[0].event,'COMMAND_COMPLETED');f.send(2,'CLOSE');await nextTurn();
 assert.equal(f.closed,false);assert.equal(f.calls.includes('disconnect'),false);
 f.contextInput.end();await f.running;
 assert.equal(f.closed,true);assert.equal(f.events.at(-1).event,'CLOSED');assert.deepEqual(f.calls,['prepare','close','disconnect']);
 assert.ok(f.closedFds.includes(10)&&f.closedFds.includes(11));
});
test('actual CLI retains unexpected context EOF while serving originals remain live',async()=>{
 const f=fixture();f.contextInput.end();assert.equal(await f.attention,'held');
 assert.ok(f.calls.includes('context-held'));assert.equal(f.closed,false);assert.equal(f.calls.includes('disconnect'),false);
 f.main.destroy();
});
test('actual CLI refuses direct CLOSE without the prepared boundary',async()=>{
 const f=fixture();f.send(1,'CLOSE');assert.equal(await f.attention,'held');
 assert.equal(f.closed,false);assert.equal(f.calls.includes('disconnect'),false);assert.equal(f.events.length,0);
 f.main.destroy();f.contextInput.destroy();
});
