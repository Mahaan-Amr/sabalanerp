import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import {PassThrough} from 'node:stream';
import {createInterface} from 'node:readline';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
const python=process.platform==='win32'?'C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe':'/usr/bin/python3';

// Execute the whole real CLI loop with explicit inert controller/I/O fixtures.
// No database, Docker, application, admission token or server owner is created.
const source=fs.readFileSync('deploy/scripts/online-release-controller-cli.mjs','utf8').replace(/^#!.*\r?\n/,'').replace(/^import .*;\r?\n/gm,'').replaceAll('import.meta.url',JSON.stringify(new URL('../../deploy/scripts/online-release-controller-cli.mjs',import.meta.url).href));
const require=createRequire(import.meta.url),ts=require('../../backend/node_modules/typescript');
const controllerSource=fs.readFileSync('deploy/scripts/online-release-controller.mjs','utf8'),controllerTree=ts.createSourceFile('controller.mjs',controllerSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
const controllerClass=controllerTree.statements.find(row=>ts.isClassDeclaration(row)&&row.name.text==='OriginalOnlineReleaseController');
const publicationMethod=controllerClass.members.find(row=>row.name?.getText(controllerTree)==='readOriginalPublicationPlan');
assert.ok(publicationMethod,'Actual controller publication wrapper is required');
const adapt=text=>text.replace(/this\.#([A-Za-z][A-Za-z0-9_]*)/g,'this.$1'),AsyncFunction=Object.getPrototypeOf(async function(){}).constructor;
const actualPublicationMethod=new AsyncFunction('assert',...publicationMethod.parameters.map(row=>adapt(row.getText(controllerTree))),adapt(publicationMethod.body.getText(controllerTree).slice(1,-1)));
const id='a'.repeat(64),publicationPlan={registry:{format:'sabalan-browser-routing/v2',generation:2,current:{erp:'new',inquiry:'new'},legacy:{erp:'old',inquiry:'old'},builds:[],apiBindings:[]},expectedPublicationSha256:'b'.repeat(64),releaseId:'release_new',previousReleaseId:'release_old',rollback:false};
publicationPlan.registry.builds.push({id:'measured-fixture-build',assets:Array.from({length:1700},(_,i)=>({path:'/_next/static/chunks/public-fixture-'+i+'.js',bytes:20,sha256:id}))});
async function runCommands(commands,{plan=publicationPlan,rollbackPlan={releaseId:'release_old',jobsRuntimeIds:[id]}}={}){
 const main=new PassThrough(),contextInput=new PassThrough(),events=[],calls=[];
 class Controller{
  constructor(){this.owner={releaseId:'release_new'};this.currentServingReleaseId='release_old';this.lastPublicationSha='b'.repeat(64);this.store={readPublication:async()=>({publicationSha256:this.lastPublicationSha,generation:1})};}
  async prepareInquiryRuntime(input){calls.push(['prepare-inquiry',input]);return {runtimeId:id,scopeSha256:'private-not-projected',capability:{secret:true}};}
  async prepareOriginalRetainedRollback(input){calls.push(['prepare-retained-rollback',input]);return rollbackPlan;}
  async prepareOriginalPublicationRegistry(){return plan.registry;}
  async assertOwned(phases){calls.push(['owned-publication-phase',phases]);}
  async readOriginalPublicationPlan(input){calls.push(['publication-plan',input]);return Object.hasOwn(plan,'capability')?plan:actualPublicationMethod.call(this,(value,code)=>assert.ok(value,code),input);}
  async readOriginalCyclePlan(){return {httpRuntimeIds:[id],jobsRuntimeIds:['c'.repeat(64)],inquiryRuntimeIds:[{runtimeId:id,releaseId:'release_new'}]};}
  async provisionCarriers(){return {backends:[{secretCapability:true}],frontend:{secretCapability:true}};}
  async prepareOriginalControllerClose(){return {};}
  async closeOriginalController(){return {};}
  assertAllOriginalChildrenClosed(){}
  retainOriginalContextFailure(){calls.push('context-held');}
  async hold(){throw Error('UNEXPECTED_FIXTURE_HOLD');}
 }
 const config={owner:{},publicationLock:{},continuousContext:{requestFd:10,responseFd:11}},stat={isFIFO:()=>true,isFile:()=>true,nlink:1,uid:0,mode:0o600,size:1};
 const context={Buffer,URL,createInterface,OriginalOnlineReleaseController:Controller,BrowserRoutingPublicationLock:class {},
  createRequire:()=>()=>({PrismaClient:class{async $disconnect(){calls.push('database-closed');}}}),
  fs:{constants:{O_RDONLY:0,O_NOFOLLOW:0,O_NONBLOCK:0},realpathSync:()=>'/config',openSync:()=>9,fstatSync:()=>stat,readFileSync:()=>JSON.stringify(config),closeSync(){},createReadStream:()=>contextInput},
  process:{platform:'linux',getuid:()=>0,argv:['node','cli','/config'],env:{DATABASE_URL:'postgresql://fixture@localhost/test?connection_limit=1&pool_timeout=10'},stdin:main,stdout:{write(raw){events.push(JSON.parse(raw));}},stderr:{write(){}}},
 };
 const running=vm.runInNewContext('(async()=>{'+source+'})()',context);
 let sequence=0;for(const command of commands)main.write(JSON.stringify({sequence:++sequence,...command})+'\n');
 main.write(JSON.stringify({sequence:++sequence,command:'PREPARE_CONTROLLER_CLOSE'})+'\n');
 contextInput.end();main.end(JSON.stringify({sequence:++sequence,command:'CLOSE'})+'\n');
 await running;return {events,calls,exitCode:context.process.exitCode};
}

test('whole CLI returns exact native Inquiry ID, publication plan and cycle plan without capability objects',async()=>{
 const f=await runCommands([{command:'PREPARE_INQUIRY',input:{buildId:'measured'}},{command:'BUILD_PUBLICATION_REGISTRY',input:{releaseId:'release_new'}},{command:'READ_CYCLE_PLAN'},{command:'PROVISION_CARRIERS',input:{releaseId:'release_new'}}]);
 assert.equal(f.exitCode,undefined);assert.equal(f.events[0].runtimeId,id);
 assert.deepEqual(f.events[1].publicationPlan,publicationPlan);
 assert.ok(Buffer.byteLength(JSON.stringify(f.events[1]))>85000);
 assert.equal(f.events[2].cyclePlan.httpRuntimeIds[0],id);
 assert.equal(f.events[3].event,'COMMAND_COMPLETED');
 assert.doesNotMatch(JSON.stringify(f.events),/secretCapability|private-not-projected|"capability"/);
 assert.equal(f.events.at(-1).event,'CLOSED');assert.equal(f.calls.at(-1),'database-closed');
});

test('whole CLI refuses extra publication-plan fields rather than serializing a secret capability',async()=>{
 const f=await runCommands([{command:'BUILD_PUBLICATION_REGISTRY',input:{releaseId:'release_new'}}],{plan:{...publicationPlan,capability:'PRIVATE_CAPABILITY'}});
 assert.equal(f.exitCode,1);assert.equal(f.events.length,0);assert.ok(f.calls.includes('database-closed'));
});

test('whole CLI returns only one actual retained jobs ID and refuses capability or malformed rollback plans',async()=>{
 const command={command:'PREPARE_RETAINED_ROLLBACK',input:{releaseId:'release_old'}},valid={releaseId:'release_old',jobsRuntimeIds:[id]};
 const good=await runCommands([command]);assert.deepEqual(good.events[0].rollbackPlan,valid);assert.deepEqual(JSON.parse(JSON.stringify(good.calls[0])),['prepare-retained-rollback',command.input]);
 for(const rollbackPlan of [{...valid,capability:'PRIVATE'}, {...valid,jobsRuntimeIds:[]},{...valid,jobsRuntimeIds:[id,id]},{...valid,jobsRuntimeIds:['mutable-runtime']},{...valid,releaseId:null}]){
  const bad=await runCommands([command],{rollbackPlan});assert.equal(bad.exitCode,1);assert.equal(bad.events.length,0);
 }
});

test('actual launcher projection preserves only typed command outputs and both fixed allowlists admit publication',()=>{
 const program=String.raw`import ast,pathlib,re,json
r=pathlib.Path.cwd();tree=ast.parse((r/'deploy/scripts/online-release-launcher.py').read_bytes());nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in ('require','project_original_control_result')];assert len(nodes)==2
scope={'re':re};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-launcher-projection>','exec'),scope);project=scope['project_original_control_result'];runtime='a'*64
plan={'registry':{'format':'sabalan-browser-routing/v2'},'expectedPublicationSha256':'b'*64,'releaseId':'release_new','previousReleaseId':'release_old','rollback':False}
assert project(1,'BUILD_PUBLICATION_REGISTRY',{'publicationPlan':plan,'secretCapability':'PRIVATE'})['publicationPlan']==plan
rollback={'releaseId':'release_old','jobsRuntimeIds':[runtime]}
assert project(1,'PREPARE_RETAINED_ROLLBACK',{'rollbackPlan':rollback,'secretCapability':'PRIVATE'})['rollbackPlan']==rollback
for bad in [dict(rollback,capability='PRIVATE'),dict(rollback,jobsRuntimeIds=[]),dict(rollback,jobsRuntimeIds=[runtime,runtime]),dict(rollback,jobsRuntimeIds=['wrong'])]:
 try:project(1,'PREPARE_RETAINED_ROLLBACK',{'rollbackPlan':bad})
 except RuntimeError:pass
 else:raise AssertionError('invalid retained jobs plan accepted')
for command in ['PREPARE_INQUIRY','START_INQUIRY','STOP_INQUIRY','START_RUNTIME','WAIT_READY','PREPARE_DRAIN','WAIT_PREPARED','SHUTDOWN','WAIT_CLOSED']:
 row=project(2,command,{'runtimeId':runtime,'scopeNonce':'PRIVATE'});assert row['runtimeId']==runtime and 'scopeNonce'not in row
for command in ['PROVISION_CARRIERS','PREPARE_EXPANSION','RUN_EXPANSION','REGISTER','START_EDGE','PUBLISH','FINISH_CYCLE']:
 row=project(3,command,{'runtimeId':runtime,'secretCapability':'PRIVATE'});assert set(row)=={'sequence','status','command','releaseAcceptanceGranted'}
assert project(3,'CREATE_CHECKPOINT',{'checkpointCommitted':True})['checkpointCommitted']is True
assert project(3,'QUALIFY_NEXT',{'originalOnlineQualificationBound':True})['originalOnlineQualificationBound']is True
for value in [{'publicationPlan':dict(plan,secretCapability='PRIVATE')},{'publicationPlan':dict(plan,expectedPublicationSha256='invalid')},{'publicationPlan':dict(plan,rollback=1)}]:
 try:project(4,'BUILD_PUBLICATION_REGISTRY',value)
 except RuntimeError:pass
 else:raise AssertionError('invalid publication accepted')
for value in [{},{'runtimeId':'not-an-id'},{'runtimeId':4}]:
 try:project(5,'PREPARE_INQUIRY',value)
 except RuntimeError:pass
 else:raise AssertionError('invalid runtime accepted')
allowed=next(n.value for n in ast.walk(tree)if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='allowed'for t in n.targets));assert {'BUILD_PUBLICATION_REGISTRY','PREPARE_RETAINED_ROLLBACK'}<=set(ast.literal_eval(allowed))
service=ast.parse((r/'deploy/scripts/online-owner-service.py').read_bytes());control=next(n.value.args[0]for n in service.body if isinstance(n,ast.Assign)and any(isinstance(t,ast.Name)and t.id=='CONTROL'for t in n.targets));assert {'BUILD_PUBLICATION_REGISTRY','PREPARE_RETAINED_ROLLBACK'}<=set(ast.literal_eval(control))
owner=next(n for n in service.body if isinstance(n,ast.ClassDef)and n.name=='Owner');method=next(n for n in owner.body if isinstance(n,ast.FunctionDef)and n.name=='control');scope['P']=pathlib.Path
minimal=ast.ClassDef(name='ActualControl',bases=[],keywords=[],body=[method],decorator_list=[]);exec(compile(ast.fix_missing_locations(ast.Module(body=[minimal],type_ignores=[])),'<actual-service-control>','exec'),scope);port=scope['ActualControl']();port.guard=lambda:None;port.control_sequence=0
for key in ['command','sequence','clientSequence']:
 try:port.control('BUILD_PUBLICATION_REGISTRY',{key:'OVERRIDE'})
 except RuntimeError:pass
 else:raise AssertionError('reserved control field accepted')
assert port.control_sequence==0
print(json.dumps({'actualLauncherProjection':True,'fixedServiceAndLauncherAllowlist':True}))
`;
 const child=spawnSync(python,['-I','-B','-'],{input:program,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);assert.equal(JSON.parse(child.stdout).actualLauncherProjection,true);
});

test('actual native pipes accept large named controller responses and refuse oversized or ordinary ACK frames',()=>{
 const program=String.raw`import ast,pathlib,os,json,threading
tree=ast.parse(pathlib.Path('deploy/scripts/online-release-launcher.py').read_bytes());names={'require','frame','original_controller_response'};nodes=[n for n in tree.body if isinstance(n,ast.FunctionDef)and n.name in names];assert len(nodes)==3
scope={'os':os,'json':json,'frame_buffers':{}};exec(compile(ast.Module(body=nodes,type_ignores=[]),'<actual-native-controller-frame>','exec'),scope)
payload=(json.dumps({'publicationPlan':{'registry':{'format':'sabalan-browser-routing/v2','builds':[{'assets':[{'path':'/_next/static/chunks/'+str(i)+'.js','sha256':'a'*64,'bytes':20}for i in range(1700)]}]}}})+'\n').encode();assert len(payload)>85000
def pipe_case(command,raw,accepted):
 read,write=os.pipe();closed=[]
 def producer():
  try:
   view=memoryview(raw)
   while view:view=view[os.write(write,view):]
  except BrokenPipeError:pass
  finally:os.close(write);closed.append(True)
 thread=threading.Thread(target=producer);thread.start()
 try:
  if accepted:assert scope['original_controller_response'](read,command)==json.loads(raw)
  else:
   try:scope['original_controller_response'](read,command)
   except RuntimeError:pass
   else:raise AssertionError('oversized response accepted')
 finally:os.close(read);thread.join()
 assert closed==[True]and not thread.is_alive()
for command in ['BUILD_PUBLICATION_REGISTRY','READ_CYCLE_PLAN','READ_CLIENT_DETACH_BARRIER','OBSERVE_BOOTSTRAP_REQUEST','PREPARE_CHECKPOINT_CAPTURE']:pipe_case(command,payload,True)
pipe_case('START_RUNTIME',payload,False)
pipe_case('BUILD_PUBLICATION_REGISTRY',b'{"oversized":"'+b'x'*(8*1024*1024)+b'"}\n',False)
print(json.dumps({'nativePipesClosed':True,'largeNamedAccepted':True,'oversizedRejected':True,'ordinaryAck16KiBPreserved':True}))
`;
 const child=spawnSync(python,['-I','-B','-'],{input:program,encoding:'utf8'});
 assert.equal(child.status,0,child.stderr);assert.equal(child.signal,null);assert.equal(JSON.parse(child.stdout).nativePipesClosed,true);
});
