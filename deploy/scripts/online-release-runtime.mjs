/** Fixed original-parent control entry. No file, socket or signal is a drain
 * command. The native guardian owns this process and the anonymous stdin pipe. */
import {createRequire} from 'node:module';
import {createInterface} from 'node:readline';
import fs from 'node:fs';
const require=createRequire(import.meta.url);
if(process.platform!=='linux'||!fs.fstatSync(0).isFIFO())throw Error('ONLINE_ORIGINAL_CONTROL_PIPE_REQUIRED');
const {mainOnlineRuntime}=require('/app/dist/online.js');
const runtime=await mainOnlineRuntime();
let sequence=0,prepared=false,closed=false,activated=false;
const held=async()=>{process.stderr.write('ONLINE_ORIGINAL_RUNTIME_CONTROL_HELD\n');await new Promise(()=>{setInterval(()=>{},1000);});};
const control=createInterface({input:process.stdin,crlfDelay:Infinity});
process.stdout.write('SABALAN_ONLINE_RUNTIME '+JSON.stringify({event:'READY',pid:process.pid})+'\n');
try{
 for await(const raw of control){
  if(raw.length>1024)throw Error('CONTROL_FRAME_TOO_LARGE');
  const value=JSON.parse(raw);
  if(Object.keys(value).sort().join(',')!=='command,sequence'||value.sequence!==++sequence)throw Error('CONTROL_SEQUENCE');
  let event;
  if(value.command==='ACTIVATE_BOOTSTRAP'&&!activated&&!prepared&&typeof runtime.activateProtectedBootstrap==='function'){await runtime.activateProtectedBootstrap();activated=true;event='ACTIVATED';}
  else if(value.command==='PREPARE_DRAIN'&&!prepared){await runtime.prepareDrain();prepared=true;}
  else if(value.command==='SHUTDOWN'&&prepared&&!closed){await runtime.shutdown();closed=true;}
  else throw Error('CONTROL_TRANSITION');
  process.stdout.write('SABALAN_ONLINE_RUNTIME '+JSON.stringify({event:event??(closed?'CLOSED':'PREPARED'),pid:process.pid,sequence})+'\n');
  if(closed){control.close();break;}
 }
 if(!closed)await held();
}catch{await held();}
