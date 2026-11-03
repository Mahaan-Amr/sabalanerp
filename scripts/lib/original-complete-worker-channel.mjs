import {createHash} from 'node:crypto';
import {ChildProcess} from 'node:child_process';
export const FRAME_LIMIT=12*1024*1024;
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const encode=v=>Buffer.from(JSON.stringify(canonical(v)));
export function need(v,code='HR_ORIGINAL_PROTOCOL_REFUSED'){if(!v)throw Error(code);}
const own=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&JSON.stringify(Object.keys(v).sort())===JSON.stringify([...keys].sort());
/** Transport only: callbacks receive data, never an issuer capability. The
 * controller's private callback is the sole request-ticket minting seam. */
export async function retainOriginalHrChannel(child,{session,initial,onRequest,onDrained=()=>{},observe=(_row)=>{},observeRaw=(_stream,_raw)=>{}}){
 need(child instanceof ChildProcess&&child.pid>0&&child.stdin&&child.stdout&&child.stderr&&!child.killed);
 need(/^[a-f0-9]{64}$/.test(session)&&typeof onRequest==='function');
 let failed=false,firstError,interrupted=false,closed=false,requested=false,drained=false,resultSeen=false,resultValue,pending=Buffer.alloc(0),stderrBytes=0,scheduledFrames=0;
 let work=Promise.resolve(),code=null,signal=null,stdoutBytes=0;const stdoutHash=createHash('sha256'),stderrHash=createHash('sha256');
 const fail=e=>{if(!failed){failed=true;firstError=e;} };
 const cancel=()=>{interrupted=true;fail(Error('HR_LOCAL_INTERRUPTED'));};
 process.on('SIGINT',cancel);process.on('SIGTERM',cancel);
 const watchError=e=>fail(e);
 for(const stream of [child.stdin,child.stdout,child.stderr])stream.on('error',watchError);
 child.on('error',watchError);
 const write=raw=>new Promise(resolve=>{
  try{child.stdin.write(raw,e=>{if(e)fail(e);resolve();});}catch(e){fail(e);resolve();}
 });
 const consume=async line=>{
  if(failed)return;
  try{
   need(line.length>0&&line.length<=FRAME_LIMIT);const f=JSON.parse(line.toString('utf8'));
   need(f.session===session&&Number.isSafeInteger(f.sequence));
   if(f.event==='HR_REQUEST'){
    need(!requested&&!drained&&f.sequence===1&&own(f,['format','session','sequence','event','proof','manifest','businessDataProof','inquiryBusinessProof','targetDatabase','intendedOwner']));
    need(f.format==='sabalan-original-active-restored-qa-hr-request/v1');requested=true;
    const certificate=await onRequest(f,()=>!closed&&!drained&&!failed&&child.exitCode===null&&!child.killed);
    need(!closed&&!failed&&!drained&&child.exitCode===null&&Buffer.isBuffer(certificate)&&certificate.length>0&&certificate.length<=1024*1024);
    await write(Buffer.concat([encode({format:'sabalan-original-active-restored-qa-hr-certificate/v1',session,sequence:1,event:'HR_CERTIFICATE',certificateBase64:certificate.toString('base64')}),Buffer.from('\n')]));
   }else if(f.event==='CALLBACK_DRAINED'){
    need(f.event==='CALLBACK_DRAINED'&&f.sequence===2&&requested&&!drained&&own(f,['format','session','sequence','event'])&&f.format==='sabalan-original-active-restored-qa-hr-drained/v1');
    drained=true;await onDrained();child.stdin.end();
   }else{
    need(drained&&!resultSeen&&f.event==='RESTORE_RESULT'&&f.sequence===3&&f.format==='sabalan-original-active-restored-qa-result/v1'&&own(f,['format','session','sequence','event','result'])&&f.result&&typeof f.result==='object'&&!Array.isArray(f.result));resultSeen=true;resultValue=f.result;
   }
  }catch(e){fail(e);}
 };
 child.stdout.on('data',raw=>{
  stdoutBytes+=raw.length;stdoutHash.update(raw);try{observeRaw('stdout',raw);}catch(e){fail(e);}
  // Bound even an unterminated frame. On failure drain SAME stream without retaining it.
  if(failed)return;
  try{need(pending.length+raw.length<=FRAME_LIMIT+1);pending=Buffer.concat([pending,raw]);let i;
   while((i=pending.indexOf(10))!==-1){const line=pending.subarray(0,i);pending=pending.subarray(i+1);need(++scheduledFrames<=3);work=work.then(()=>consume(line)).catch(fail);}
  }catch(e){fail(e);pending=Buffer.alloc(0);}
 });
 child.stderr.on('data',raw=>{stderrHash.update(raw);try{observeRaw('stderr',raw);}catch(e){fail(e);}stderrBytes+=raw.length;if(stderrBytes>65536)fail(Error('HR_STDERR_BOUND'));});
 const completion=new Promise(resolve=>child.once('close',(c,s)=>{closed=true;code=c;signal=s;resolve();}));
 try{
  need(Buffer.isBuffer(initial)&&initial.length>0&&initial.length<=FRAME_LIMIT);
  await write(Buffer.concat([initial,Buffer.from('\n')]));
  await completion;await work;
  need(!failed&&requested&&drained&&resultSeen&&pending.length===0&&code===0&&signal===null&&child.stdout.readableEnded&&child.stderr.readableEnded&&child.stdin.writableFinished&&!child.killed,'HR_ORIGINAL_NOT_SUCCESSFULLY_DRAINED');
  const row={originalPid:child.pid,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,stdoutBytes,stderrBytes,stdoutSha256:stdoutHash.copy().digest('hex'),stderrSha256:stderrHash.copy().digest('hex'),localInterrupted:interrupted,observationFault:failed,callbackDrained:drained,result:resultValue,productionAdmission:false};await observe(row);return row;
 }catch(e){
  fail(e);
  // No stop, reconnect, stdin replacement or synthetic EOF. Failure remains held
  // while the same child is live; normal original exit is still collected.
  await completion;await work;
  const row={originalPid:child.pid,code,signal,stdoutEof:child.stdout.readableEnded,stderrEof:child.stderr.readableEnded,stdoutBytes,stderrBytes,stdoutSha256:stdoutHash.copy().digest('hex'),stderrSha256:stderrHash.copy().digest('hex'),localInterrupted:interrupted,observationFault:failed,callbackDrained:drained,productionAdmission:false};
  try{await observe(row);}catch{}throw firstError;
 }finally{
  process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel);
 }
}
