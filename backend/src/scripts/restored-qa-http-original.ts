/** Fixed private ordinary HTTP descendant of the existing native guardian.
 * No startup migrations, recovery finalization, seed or background workers. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const format='sabalan-restored-qa-http-original/v1';
const sha=(b:Buffer)=>createHash('sha256').update(b).digest('hex');
function required(v:unknown):asserts v{if(!v)throw Error('RESTORED_QA_HTTP_ORIGINAL_UNPROVEN');}
const birth=(pid:number)=>{const fields=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1)!.split(' ');return {pid,startTicks:fields[19],group:fields[2]};};
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.uid,s.nlink].join(':');
function read(file:string,expected:string,mode=0o400){
 required(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const s=fs.fstatSync(fd,{bigint:true});required(s.isFile()&&s.nlink===1n&&s.uid===0n&&(s.mode&0o777n)===BigInt(mode)&&s.size>0n&&s.size<=16384n);
  const raw=fs.readFileSync(fd);required(sha(raw)===expected&&pin(s)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(s)===pin(fs.lstatSync(file,{bigint:true})));return raw;
 }finally{fs.closeSync(fd);}
}
/** Data-only private-pipe parser; no admission or shutdown authority. */
export function parseRestoredQaHttpControl(raw:Buffer,session:string,sequence:number){
 required(raw.length>0&&raw.length<=2048);const value=JSON.parse(raw.toString());
 required(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='command,sequence,session'
  &&value.session===session&&/^[a-f0-9]{64}$/.test(session)&&Number.isSafeInteger(sequence)&&sequence>=1&&value.sequence===sequence
  &&['PRIVATE_PREPARE_DRAIN','PRIVATE_SHUTDOWN'].includes(value.command));return Object.freeze(value);
}
async function* controls(){let pending=Buffer.alloc(0);for await(const chunk of process.stdin){required(pending.length+chunk.length<=4096);pending=Buffer.concat([pending,chunk]);for(;;){const end=pending.indexOf(10);if(end<0)break;yield pending.subarray(0,end);pending=pending.subarray(end+1);}}required(pending.length===0);}
export async function mainRestoredQaHttpOriginal(){
 required(process.platform==='linux'&&process.getuid?.()===0&&process.argv.length===4);
 const [file,digest]=process.argv.slice(2);required(/^[a-f0-9]{64}$/.test(digest));
 const raw=read(file,digest),c=JSON.parse(raw.toString());required(c.format===format&&c.root===process.cwd()&&/^[a-f0-9]{64}$/.test(c.session));
 const parent=()=>{
  required(process.env.BACKEND_CONTROL_LOCK_FD==='9'&&process.env.RECOVERY_COORDINATION_DIR===c.cohortCoordination&&process.env.BACKEND_CONTROL_LOCK_FILE===path.join(c.cohortCoordination,'deployment-runtime-control.lock'));
  const actualNative=read(path.join(c.cohortCoordination,'deployment-runtime-native.json'),process.env.BACKEND_NATIVE_CLAIM_SHA256!,0o600),native=JSON.parse(actualNative.toString());
  required(native.phase==='ACTIVE'&&native.guardian.pid===process.ppid&&native.guardian.startTicks===birth(process.ppid).startTicks&&native.initialDatabase.name===c.database.name&&String(native.initialDatabase.oid)===c.database.oid&&native.clusterIdentifier===c.database.systemIdentifier&&native.namespace===process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME);
  let pid=process.ppid,owner=false;for(let depth=0;depth<32&&pid>0;depth++){if(pid===c.parent.pid){owner=JSON.stringify(birth(pid))===JSON.stringify(c.parent);break;}const fields=fs.readFileSync(`/proc/${pid}/stat`,'utf8').split(') ').at(-1)!.split(' ');pid=Number(fields[1]);}
  required(owner&&birth(process.pid).group===c.parent.group&&read(file,digest).equals(raw));return native;
 };parent();
 const {assertRuntimeControlOwnership}=await import('../services/runtimeControlOwnership');assertRuntimeControlOwnership();
 required(['OLD_89DD','CURRENT_INSTALLED'].includes(c.graphKind));
 // The historical reader is NODE-ONLY. Importing the parent capability module
 // here would initialize the CURRENT pool before loading the OLD client.
 const historical=c.graphKind==='OLD_89DD'?(await import('../services/restoredQaHistoricalRuntimeFiles')).inspectFixedHistoricalRuntimeGraph(c.root):undefined;
 const installed=historical?undefined:(await import('../services/restoredQaInstalledRuntimeFiles')).measureInstalledRestoredQaCurrentGraph(c.root);
 const load=(relative:string)=>require(path.join(historical!.applicationRoot,'dist',relative));
 const {prisma,disconnectDatabase}=historical?load('lib/prisma.js'):await import('../lib/prisma');
 const recovery=historical?load('services/recoveryRuntime.js'):await import('../services/recoveryRuntime');
 const application=historical?load('application.js'):await import('../application');
 const requests=historical?load('services/httpRequestLifecycle.js'):await import('../services/httpRequestLifecycle');
 let app:ReturnType<typeof import('../application').createApplication>|undefined,stopping=false,closed=false;
 const emit=(event:string,extra:Record<string,unknown>={})=>process.stdout.write('SABALAN_RESTORED_QA_HTTP '+JSON.stringify({format,session:c.session,event,...extra})+'\n');
 const hold=(code:string):never=>{emit('HELD',{code});setInterval(()=>{},30000);throw Error(code);};
 const identity=async()=>{parent();assertRuntimeControlOwnership();const rows=await prisma.$queryRaw`SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier",current_setting('application_name')::text AS namespace`;
  required(rows.length===1&&rows[0].name===c.database.name&&rows[0].oid===c.database.oid&&rows[0].systemIdentifier===c.database.systemIdentifier&&rows[0].namespace===process.env.BACKEND_NATIVE_POSTGRES_APPLICATION_NAME);return rows[0];};
 try{
  await identity();recovery.initializeRecoveryRuntime();app=application.createApplication({runtimeRole:'standalone',isShuttingDown:()=>stopping});required(app);
  // No websocket clients, scheduler or outbound delivery are enrolled here.
  await app.realtimeDelivery.stop(240000);
  await new Promise<void>((resolve,reject)=>{app!.server.once('error',reject);app!.server.listen(0,'127.0.0.1',()=>{app!.server.off('error',reject);resolve();});});
  const address=app.server.address();required(address&&typeof address!=='string'&&address.address==='127.0.0.1');await identity();
  emit('READY',{database:c.database,url:`http://127.0.0.1:${address.port}`,owner:c.parent,nodeBirth:birth(process.pid),nativeClaimSha256:process.env.BACKEND_NATIVE_CLAIM_SHA256,
   applicationGraph:historical?{kind:historical.kind,sourceImage:historical.sourceImage,sourceCommit:historical.sourceCommit,materialReceiptSha256:historical.materialReceiptSha256,baseInventorySha256:historical.baseInventorySha256}:installed});
  let sequence=0,prepared=false;
  for await(const line of controls()){
   const command=parseRestoredQaHttpControl(line,c.session,++sequence);parent();
   if(command.command==='PRIVATE_PREPARE_DRAIN'&&!prepared){stopping=true;app.closeExternalAdmission();await requests.runtimeHttpRequests.waitForDrain(240000);await recovery.waitForActiveWrites(240000);await recovery.waitForRecoveryOperationDrain(240000);await identity();prepared=true;emit('PREPARED');}
   else if(command.command==='PRIVATE_SHUTDOWN'&&prepared){parent();await new Promise<void>((resolve,reject)=>app!.io.close(error=>error?reject(error):resolve()));await disconnectDatabase();if(installed)required(JSON.stringify((await import('../services/restoredQaInstalledRuntimeFiles')).measureInstalledRestoredQaCurrentGraph(c.root))===JSON.stringify(installed));closed=true;emit('CLOSED');process.stdin.destroy();break;}
   else hold('RESTORED_QA_HTTP_CONTROL_REFUSED');
  }
  if(!closed)hold('RESTORED_QA_HTTP_CONTROL_EOF');
 }catch{hold('RESTORED_QA_HTTP_CLOSURE_UNPROVEN');}
}
if(require.main===module)void mainRestoredQaHttpOriginal().catch(()=>{process.exitCode=1;});
