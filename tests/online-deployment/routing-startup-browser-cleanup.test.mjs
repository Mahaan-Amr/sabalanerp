/** Synthetic original-owner lifecycle tests; no browser, Docker or authority is created. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source=fs.readFileSync(new URL('./application-native-routing.fixture.mjs',import.meta.url),'utf8');
const start=source.indexOf('async function runOriginalRoutingStartup(');
const end=source.indexOf('\nawait runOriginalRoutingStartup(',start);
assert.ok(start>0&&end>start);
const startupSource=source.slice(start,end);
function harness({enrollFailure,connectFailure,closeFailure,invalidCapability=false}={}) {
  const events=[],channel={},token={},facts={browserWSEndpoint:'ws://synthetic-original.invalid/private/devtools/browser/original'};
  let held=false,connects=0,closes=0;
  const context={
    enrollOriginalReadonlyTransportChannel:async()=>{events.push('enroll');if(enrollFailure)throw enrollFailure;return channel;},
    openOriginalRemoteBrowserConnection:async value=>{assert.equal(value,channel);events.push('signed-capability');return token;},
    readOriginalRemoteBrowserConnection:value=>{assert.equal(value,token);if(invalidCapability)throw Error('UNPROVEN');return facts;},
    puppeteer:{connect:async options=>{events.push('connect');connects++;assert.equal(options.browserWSEndpoint,facts.browserWSEndpoint);if(connectFailure)throw connectFailure;return {close:async()=>{events.push('normal-close');closes++;if(closeFailure)throw closeFailure;}};}},
    // Test-only replacement: observe custody retention without creating a live timer.
    holdOriginalStartupBrowserCustody:()=>{held=true;events.push('held');return new Promise(()=>{});},
  };
  vm.runInNewContext(startupSource+'\nglobalThis.run=runOriginalRoutingStartup;',context);
  return {run:context.run,events,get held(){return held;},get connects(){return connects;},get closes(){return closes;}};
}
const turn=()=>new Promise(resolve=>setImmediate(resolve));

test('startup input failure normal-closes the same signed original browser and retains the original error',async()=>{
  const h=harness(),failure=Error('PRIVATE_STARTUP_INPUT_INVALID');
  await assert.rejects(h.run(async()=>{h.events.push('read-input');throw failure;}),error=>error===failure);
  assert.deepEqual(h.events,['enroll','signed-capability','read-input','connect','normal-close']);
  assert.equal(h.connects,1);assert.equal(h.closes,1);assert.equal(h.held,false);
});
test('actual private reader overflow uses the same startup negative close path',async()=>{
  const begin=source.indexOf('function privateRead('),finish=source.indexOf('\nconst input=',begin);
  const fake={constants:{O_RDONLY:0,O_NOFOLLOW:1,O_NONBLOCK:2},openSync:()=>1,closeSync:()=>{},
    fstatSync:()=>({isFile:()=>true,nlink:1n,uid:0n,mode:0o100400n,size:524289n})};
  const context={fs:fake,assert,Buffer,process:{getuid:()=>0}};
  vm.runInNewContext(source.slice(begin,finish)+';globalThis.read=privateRead;',context);
  const h=harness();await assert.rejects(h.run(async()=>context.read('/synthetic/index.json',512*1024)));
  assert.equal(h.connects,1);assert.equal(h.closes,1);assert.equal(h.held,false);
});
test('successful startup neither opens a second connection nor closes the handed-off browser',async()=>{
  const h=harness(),result={synthetic:true};
  assert.equal(await h.run(async({handoffBrowserAcceptance})=>{handoffBrowserAcceptance();return result;}),result);
  assert.equal(h.connects,0);assert.equal(h.closes,0);
});
test('browser acceptance failure stays with its existing owner without reconnect or second close',async()=>{
  const h=harness(),failure=Error('BROWSER_ACCEPTANCE_NEGATIVE');
  await assert.rejects(h.run(async({handoffBrowserAcceptance})=>{handoffBrowserAcceptance();throw failure;}),error=>error===failure);
  assert.equal(h.connects,0);assert.equal(h.closes,0);assert.equal(h.held,false);
});
for(const [name,options]of [['connect',{connectFailure:Error('UNCERTAIN_CONNECT')}],['close',{closeFailure:Error('UNCERTAIN_CLOSE')}],['capability',{invalidCapability:true}],['enrollment',{enrollFailure:Error('UNPROVEN_CHANNEL')}]]) {
  test('unknown '+name+' outcome retains this original edge without a success or failure exit',async()=>{
    const h=harness(options);let settled=false;
    h.run(async()=>{throw Error('STARTUP_NEGATIVE');}).then(()=>{settled=true;},()=>{settled=true;});
    await turn();assert.equal(h.held,true);assert.equal(settled,false);
    assert.ok(h.connects<=1);assert.ok(h.closes<=1);
  });
}
test('production wiring acquires capability before private reads and hands off exactly at browser acceptance',()=>{
  assert.ok(source.indexOf('await runOriginalRoutingStartup(')<source.indexOf('const root=process.argv[2]'));
  assert.ok(source.includes('handoffBrowserAcceptance();\n  const browser=await runNativeBrowserAcceptance('));
  const holding=source.slice(source.indexOf('async function holdOriginalStartupBrowserCustody('),start);
  assert.ok(holding.includes('for(;;)await new Promise(resolve=>setTimeout(resolve,1000))'));
  assert.ok(!startupSource.includes('process.exit')&&!startupSource.includes('process.kill')&&!startupSource.includes('disconnect'));
});
