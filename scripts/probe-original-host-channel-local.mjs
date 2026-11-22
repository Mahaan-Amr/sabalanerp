import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,sign,randomBytes,createHash} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';

const root=path.resolve(import.meta.dirname,'..'),base='D:/sabalanerp/docker-compose.local.yml';
assert.equal(process.argv.length,2);
const sourceFile=path.join(root,'tests/online-deployment/original-host-controller-channel.fixture.py');
const source=fs.readFileSync(sourceFile),sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function status(){const raw=execFileSync('docker',['compose','-f',base,'ps','--format','json'],{encoding:'utf8'});
  let rows;try{const v=JSON.parse(raw);rows=Array.isArray(v)?v:[v];}catch{rows=raw.trim().split(/\r?\n/).map(line=>JSON.parse(line));}
  const found=rows.find(row=>row.Project==='sabalanerp-local'&&row.Service==='backend-retained'&&row.State==='running'&&row.Health==='healthy');assert.ok(found);return found;}
status();const [slot]=JSON.parse(execFileSync('docker',['inspect',status().Name],{encoding:'utf8'}));
assert.equal(slot.Config.Labels['com.docker.compose.project'],'sabalanerp-local');
const identity={id:slot.Id,image:slot.Image,startedAt:slot.State.StartedAt};
const key=generateKeyPairSync('ed25519'),publicKey=key.publicKey.export({type:'spki',format:'der'}).toString('base64');
const session=randomBytes(32).toString('hex'),format='sabalan-original-host-controller/v1',prefix='SABALAN_ORIGINAL_CONTROL ';
const payload=Buffer.from(JSON.stringify({requestId:randomBytes(32).toString('hex'),probe:'FIXED_DIAGNOSTIC_ONLY'})).toString('base64');
const signature=sign(null,Buffer.from([format,session,'candidate','1','ENROLL',payload].join('\0')),key.privateKey).toString('base64');
const valid={format,session,role:'candidate',sequence:1,command:'ENROLL',payload,signature};
const secondPayload=Buffer.from(JSON.stringify({requestId:randomBytes(32).toString('hex'),probe:'SECOND_FIXED_DIAGNOSTIC_ONLY'})).toString('base64');
const second={format,session,role:'candidate',sequence:2,command:'RUN_MIGRATION',payload:secondPayload,
  signature:sign(null,Buffer.from([format,session,'candidate','2','RUN_MIGRATION',secondPayload].join('\0')),key.privateKey).toString('base64')};
const bootstrap=String.raw`import base64,json,sys,types,hashlib,subprocess,os,fcntl,array,termios
h=json.loads(sys.stdin.buffer.readline())
raw=base64.b64decode(h['source'],validate=True)
assert hashlib.sha256(raw).hexdigest()==h['sha256']
m=types.ModuleType('channel_crypto_probe');exec(compile(raw,'<captured-original-host-channel>','exec'),m.__dict__)
c=m.OriginalHostChannel(h['publicKey'],h['session'],'candidate')
node_proofs=[]; second_body=None; private_pipe_consumed=None; empty_read=False
def original_node(code,stdin):
 p=subprocess.Popen(['/usr/local/bin/node','-e',code],stdin=stdin,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={'PATH':'/usr/local/bin:/usr/bin:/bin','LANG':'C'})
 interruption=None
 while True:
  try:out,err=p.communicate();break
  except BaseException as error:
   if interruption is None:interruption=error
 node_proofs.append(dict(pid=p.pid,returncode=p.returncode,reaped=True))
 assert p.returncode==0 and len(out)+len(err)<4096
 if interruption is not None:raise interruption
 return out
try:
 receipt=c.receive('ENROLL'); accepted=True; body=receipt.body
 if h['mode']=='multi-command-isolated-node':
  original_flags=fcntl.fcntl(0,fcntl.F_GETFL)
  original_node('void process.stdin;',subprocess.DEVNULL)
  assert fcntl.fcntl(0,fcntl.F_GETFL)==original_flags
  # Demonstrate the inherited-reader hazard on an OWN separate test pipe,
  # never on the authenticated channel or any application/native process.
  reader,writer=os.pipe()
  try:
   os.write(writer,b'OWN_PRIVATE_PROBE')
   result=original_node("const fs=require('fs');const b=Buffer.alloc(17);process.stdout.write(String(fs.readSync(0,b)));",reader)
   assert result==b'17'
   unread=array.array('i',[0]);fcntl.ioctl(reader,termios.FIONREAD,unread,True);assert unread[0]==0
   private_pipe_consumed=17
  finally:os.close(reader);os.close(writer)
  print('PROBE_NODE_ISOLATED_READY',flush=True)
  second_body=c.receive('RUN_MIGRATION').body
except (AssertionError,RuntimeError,ValueError,m.OriginalHostChannelReadFailure) as error:
 accepted=False; body=None; empty_read=m.is_original_channel_empty_read(error)
c.assert_observers_closed()
print(json.dumps(dict(accepted=accepted,body=body,secondBody=second_body,emptyRead=empty_read,nodeChildren=node_proofs,ownPrivatePipeConsumed=private_pipe_consumed,historicalCauseProven=False,observers=[dict(pid=o['child'].pid,closed=o['closed'],returncode=o['child'].returncode) for o in c.observers])))`;
const cases=[['valid',valid,true],['tampered-payload',{...valid,payload:Buffer.from('{"probe":"SUBSTITUTED"}').toString('base64')},false],
  ['wrong-sequence',{...valid,sequence:2},false],['wrong-session',{...valid,session:randomBytes(32).toString('hex')},false],
  ['multi-command-isolated-node',valid,true],['empty-read',valid,false],['malformed-prefix',valid,false]];
const report={format:'sabalan-original-host-channel-linux-probe/v1',pass:false,productionAdmission:false,
  sourceSha256:sha(source),originalContainer:identity,cases:[]};
const reportPath=path.join(root,'reports/qa/original-host-channel-linux-'+randomBytes(16).toString('hex')+'.json');
const children=[];
try{
for(const [name,frame,accepted]of cases){status();const child=spawn('docker',['exec','-i',slot.Id,'/usr/bin/python3','-I','-B','-c',bootstrap],{stdio:['pipe','pipe','pipe']});
  children.push(child);let stdout='',stderr='',secondSent=false;child.stdout.on('data',bytes=>{
    stdout+=bytes;
    if(name==='multi-command-isolated-node'&&!secondSent&&stdout.includes('PROBE_NODE_ISOLATED_READY\n')){
      stdout=stdout.replace('PROBE_NODE_ISOLATED_READY\n','');secondSent=true;
      child.stdin.end(prefix+JSON.stringify(second)+'\n');
    }
  });child.stderr.on('data',bytes=>{stderr+=bytes;});
  const initial=JSON.stringify({source:source.toString('base64'),sha256:sha(source),publicKey,session,mode:name})+'\n'
    +(name==='empty-read'?'':(name==='malformed-prefix'?'WRONG ':prefix)+JSON.stringify(frame)+'\n');
  if(name==='multi-command-isolated-node')child.stdin.write(initial);else child.stdin.end(initial);
  const result=await new Promise(resolve=>{child.on('error',error=>{report.spawnError=error.code;});child.on('close',(code,signal)=>resolve({code,signal}));});
  assert.equal(result.code,0);assert.equal(result.signal,null);assert.ok(Buffer.byteLength(stdout)+Buffer.byteLength(stderr)<65536);
  const proof=JSON.parse(stdout);assert.equal(proof.accepted,accepted);
  assert.equal(proof.emptyRead,name==='empty-read');
  if(name==='valid'){assert.equal(proof.observers.length,1);assert.equal(proof.observers[0].returncode,0);assert.equal(proof.body.probe,'FIXED_DIAGNOSTIC_ONLY');}
  if(name==='tampered-payload'){assert.equal(proof.observers.length,1);assert.notEqual(proof.observers[0].returncode,0);}
  if(name==='multi-command-isolated-node'){
    assert.equal(proof.secondBody.probe,'SECOND_FIXED_DIAGNOSTIC_ONLY');assert.equal(proof.observers.length,2);
    assert.ok(proof.observers.every(value=>value.returncode===0));assert.equal(proof.nodeChildren.length,2);
    assert.ok(proof.nodeChildren.every(value=>value.returncode===0&&value.reaped));assert.equal(proof.ownPrivatePipeConsumed,17);
    assert.equal(proof.historicalCauseProven,false);
  }
  for(const observer of proof.observers){assert.equal(observer.closed,true);assert.ok(Number.isInteger(observer.returncode));}
  report.cases.push({name,...result,proof});fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
}
status();const [after]=JSON.parse(execFileSync('docker',['inspect',slot.Id],{encoding:'utf8'}));
assert.deepEqual({id:after.Id,image:after.Image,startedAt:after.State.StartedAt},identity);assert.equal(sha(fs.readFileSync(sourceFile)),report.sourceSha256);
report.pass=true;report.originalContainerUnchanged=true;fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({pass:true,reportPath,cases:report.cases.length}));
}catch(error){report.failure={name:error.name,message:error.message};fs.writeFileSync(reportPath,JSON.stringify(report,null,2)+'\n');
  if(children.some(child=>child.exitCode===null))await new Promise(()=>{setInterval(()=>{void children;void key;},30000);});
  throw error;
}
