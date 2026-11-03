/** Source-owned synchronous observation client. No signer, command executor,
 * receipt adoption or material-channel protocol extension. Secret only in RAM. */
'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{spawnSync}=require('node:child_process'),{createHash,createHmac,hkdfSync,timingSafeEqual,randomBytes}=require('node:crypto');
const format='sabalan-original-inquiry-observation/v1';
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
const bytes=v=>Buffer.from(JSON.stringify(canonical(v)));
const mac=(key,domain,value)=>createHmac('sha256',key).update(domain+'\0').update(bytes(value)).digest('hex');
const reader=String.raw`import http.client,json,sys,base64
p=json.load(sys.stdin)
assert set(p)=={'port','request','mac'} and type(p['port']) is int and 1024<=p['port']<=65535
raw=json.dumps(p['request'],sort_keys=True,separators=(',',':')).encode()
assert len(raw)<=4096
c=http.client.HTTPConnection('host.docker.internal',p['port'],timeout=15)
try:
 c.request('POST','/original-inquiry-observation/v1',body=raw,headers={'Connection':'close','Content-Type':'application/json','x-sabalan-observation-mac':p['mac']})
 r=c.getresponse();data=r.read(1048577);assert len(data)<=1048576
 signature=r.getheader('x-sabalan-observation-mac');assert signature is None or len(signature)<=64
 print(json.dumps({'status':r.status,'mac':signature,'bodyBase64':base64.b64encode(data).decode()}))
finally:c.close()
`;
// The synchronous outer boundary has no timeout or max-buffer signal policy.
// This fixed owner retains the actual HTTP reader's Popen and drains both pipes
// after a bound failure; it never kills/replaces that original reader.
const transport=String.raw`import os,json,sys,subprocess,threading,hashlib,signal,time
reader=`+JSON.stringify(reader)+String.raw`
p=json.load(sys.stdin);raw=json.dumps(p).encode();assert len(raw)<=8192
fault=False;cancelled=False;observed_signals=[]
def cancel(signum,_frame):
 global fault,cancelled
 fault=True;cancelled=True
 name=signal.Signals(signum).name
 if name not in observed_signals:observed_signals.append(name)
signal.signal(signal.SIGINT,cancel);signal.signal(signal.SIGTERM,cancel)
child=subprocess.Popen([sys.executable,'-I','-B','-c',reader],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,env={k:v for k,v in os.environ.items() if k in ('PATH','LANG','TZ')})
try:
 streams={};threads=[]
 def read_part(stream):return os.read(stream.fileno(),65536)
 def drain(row):
  global fault
  while not row['eof']:
   try:part=read_part(row['stream'])
   except BaseException:
    fault=True;time.sleep(.05);continue
   if part:
    try:
     row['bytes']+=len(part);row['hash'].update(part)
     if row['bytes']<=row['limit']:row['parts'].append(part)
     else:fault=True
    except BaseException:fault=True
   else:row['eof']=True
  while not row['stream'].closed:
   try:row['stream'].close()
   except BaseException:fault=True;time.sleep(.05)
 for name,stream,limit in [('stdout',child.stdout,2097152),('stderr',child.stderr,65536)]:
  row={'stream':stream,'eof':False,'bytes':0,'hash':hashlib.sha256(),'parts':[],'limit':limit};streams[name]=row
  thread=threading.Thread(target=drain,args=(row,),daemon=False);threads.append(thread);thread.start()
 try:child.stdin.write(raw);child.stdin.flush()
 except BaseException:fault=True
 finally:
  while not child.stdin.closed:
   try:child.stdin.close()
   except BaseException:fault=True;time.sleep(.05)
 while True:
  try:code=child.wait();break
  except BaseException:fault=True;time.sleep(.05)
 for thread in threads:thread.join()
 original={'originalPid':child.pid,'code':code if code>=0 else None,'signal':None if code>=0 else signal.Signals(-code).name,'stdoutEof':streams['stdout']['eof'],'stderrEof':streams['stderr']['eof'],'stdoutBytes':streams['stdout']['bytes'],'stderrBytes':streams['stderr']['bytes'],'stdoutSha256':streams['stdout']['hash'].hexdigest(),'stderrSha256':streams['stderr']['hash'].hexdigest(),'observationFault':fault,'cancelled':cancelled,'observedSignals':observed_signals,'killed':False}
 ok=code==0 and not fault and original['stdoutEof'] and original['stderrEof'] and original['stderrBytes']==0
 result={'transportSucceeded':ok,'original':original}
 if ok:
  try:result['response']=json.loads(b''.join(streams['stdout']['parts']))
  except (ValueError,UnicodeError):result['transportSucceeded']=False
 print(json.dumps(result))
except BaseException:
 # Unknown post-Popen setup/finalization never abandons this exact child.
 while True:time.sleep(30)
`;
function createOriginalInquiryCurrentClient({operation,session,passphrase,incarnation,port,python,assertOriginalOwner}){
 assert.equal(process.platform,'linux');assert.equal(process.getuid(),0);assert.equal(typeof assertOriginalOwner,'function');assertOriginalOwner();
 assert.match(operation,/^[a-f0-9]{32}$/);assert.match(session,/^[a-f0-9]{64}$/);assert.match(incarnation,/^[a-f0-9]{64}$/);
 assert.equal(typeof passphrase,'string');assert.ok(Buffer.byteLength(passphrase)>=32&&Buffer.byteLength(passphrase)<=4096&&!/[\r\n\0]/.test(passphrase));assert.ok(Number.isInteger(port)&&port>=1024&&port<=65535);
 assert.equal(python.file,'/usr/bin/python3.11');assert.match(python.sha256,/^[a-f0-9]{64}$/);assert.equal(fs.realpathSync(python.file),python.file);const binary=fs.readFileSync(python.file);assert.equal(binary.subarray(0,4).toString('hex'),'7f454c46');assert.equal(createHash('sha256').update(binary).digest('hex'),python.sha256);
 const key=Buffer.from(hkdfSync('sha256',Buffer.from(passphrase),Buffer.from(operation,'hex'),Buffer.from(format+'\0'+session),32));
 let sequence=0,closed=false,failed=false;const originals=[];
 function query(kind){
  assert.ok(!closed&&!failed,'ORIGINAL_INQUIRY_OBSERVATION_CLIENT_HELD');assertOriginalOwner();
  const request={format,operation,session,incarnation,sequence:++sequence,challenge:randomBytes(32).toString('hex'),kind};
  const input=Buffer.from(JSON.stringify({port,request,mac:mac(key,'request',request)}));let row;
  try{
   const environment=Object.fromEntries(Object.entries(process.env).filter(([name])=>['PATH','LANG','TZ'].includes(name)));
   row=spawnSync(python.file,['-I','-B','-c',transport],{input,env:environment,encoding:null,maxBuffer:Infinity});
   if(row.error){failed=true;process.stderr.write('ORIGINAL_INQUIRY_OBSERVATION_HELPER_HELD\n');for(;;)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,30000);}
   assert.ok(row.status===0&&row.signal===null&&row.stderr.length===0&&row.stdout.length<=2*1024**2,'ORIGINAL_INQUIRY_OBSERVATION_OWNER_UNPROVEN');assertOriginalOwner();
   const retained=JSON.parse(row.stdout);originals.push({wrapperOriginalPid:row.pid,wrapperStatus:row.status,wrapperSignal:row.signal,reader:retained.original});
   assert.equal(retained.transportSucceeded,true);const original=retained.original;assert.ok(Number.isSafeInteger(original.originalPid)&&original.originalPid>0);assert.equal(original.code,0);assert.equal(original.signal,null);assert.equal(original.stdoutEof,true);assert.equal(original.stderrEof,true);assert.equal(original.observationFault,false);assert.equal(original.cancelled,false);assert.deepEqual(original.observedSignals,[]);assert.equal(original.killed,false);
   const envelope=retained.response;assert.deepEqual(Object.keys(envelope).sort(),['bodyBase64','mac','status']);assert.equal(envelope.status,200);
   const raw=Buffer.from(envelope.bodyBase64,'base64');assert.ok(raw.length>0&&raw.length<=1024*1024);assert.equal(raw.toString('base64'),envelope.bodyBase64);const result=JSON.parse(raw);
   assert.equal(typeof envelope.mac,'string');assert.match(envelope.mac,/^[a-f0-9]{64}$/);assert.ok(timingSafeEqual(Buffer.from(envelope.mac,'hex'),Buffer.from(mac(key,'response',result),'hex')));
   const expected={...request,current:true};if(kind==='PROBE_BINDING'){assert.deepEqual(Object.keys(result.binding).sort(),['inputSqlite','originalDatabase','scope']);expected.binding=result.binding;}
   assert.deepEqual(result,expected);assertOriginalOwner();return result.binding;
  }catch(error){failed=true;throw error;}finally{input.fill(0);}
 }
 return Object.freeze({assertCurrent(){query('CURRENT');},observationBinding(){return structuredClone(query('PROBE_BINDING'));},
  close(){assert.ok(!closed);closed=true;key.fill(0);return{format,closed:true,failed,authenticationKeyRetired:true,originals:structuredClone(originals),productionAdmission:false};}});
}
module.exports={createOriginalInquiryCurrentClient,originalInquiryObservationTransportSources:()=>Object.freeze({reader,owner:transport})};
