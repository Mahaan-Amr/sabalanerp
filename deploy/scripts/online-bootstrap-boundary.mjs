/** Fixed IPC client inside the ORIGINAL protected deploy process tree.
 * Responses wake the deployment; they never constitute release acceptance.
 * Lost/unknown original custody holds this client and its parent's lease loop.
 */
import fs from 'node:fs';
const commands=new Set(['FINANCIAL_PREPARE','BOOTSTRAP_PREPARE','BOOTSTRAP_GATES','BOOTSTRAP_PUBLISH','BOOTSTRAP_ACTIVATE','BOOTSTRAP_OPENED']);
const [command]=process.argv.slice(2);
const descriptor=name=>{const value=process.env[name];if(!/^[0-9]{1,4}$/.test(value||''))throw Error('ONLINE_BOOTSTRAP_PIPE_REQUIRED');
 const fd=Number(value);if(fd<3||fd>1024||!fs.fstatSync(fd).isFIFO())throw Error('ONLINE_BOOTSTRAP_PIPE_REQUIRED');return fd;};
if(!commands.has(command))throw Error('ONLINE_BOOTSTRAP_COMMAND_REQUIRED');
const requestFd=descriptor('DEPLOYMENT_ONLINE_BOOTSTRAP_REQUEST_FD'),responseFd=descriptor('DEPLOYMENT_ONLINE_BOOTSTRAP_RESPONSE_FD');
const requestStat=fs.fstatSync(requestFd),responseStat=fs.fstatSync(responseFd);
if(requestFd===responseFd||(requestStat.dev===responseStat.dev&&requestStat.ino===responseStat.ino))throw Error('ONLINE_BOOTSTRAP_SEPARATE_PIPES_REQUIRED');
const sequence=Number(process.env.DEPLOYMENT_ONLINE_BOOTSTRAP_SEQUENCE);
if(!Number.isSafeInteger(sequence)||sequence<1)throw Error('ONLINE_BOOTSTRAP_SEQUENCE_REQUIRED');
const message={format:'sabalan-protected-bootstrap-boundary/v1',command,sequence,
 deploymentId:process.env.DEPLOYMENT_ID,releaseId:process.env.DEPLOYMENT_RELEASE_ID,
 targetCommit:process.env.DEPLOYMENT_TARGET_COMMIT};
if(![message.deploymentId,message.releaseId].every(v=>/^[a-zA-Z0-9_-]{8,128}$/.test(v||''))||!/^[a-f0-9]{40}$/.test(message.targetCommit||''))throw Error('ONLINE_BOOTSTRAP_OWNER_REQUIRED');
const held=async()=>{process.stderr.write('ONLINE_ORIGINAL_BOOTSTRAP_CHANNEL_HELD\n');await new Promise(()=>{setInterval(()=>{},60000);});};
try{
 const wire=Buffer.from(JSON.stringify(message)+'\n');let offset=0;
 while(offset<wire.length){const count=fs.writeSync(requestFd,wire,offset,wire.length-offset);if(!count)throw Error('ORIGINAL_PIPE_WRITE_UNKNOWN');offset+=count;}
 const bytes=[];const byte=Buffer.alloc(1);
 while(bytes.length<16384){if(fs.readSync(responseFd,byte,0,1,null)!==1)throw Error('ORIGINAL_PIPE_EOF_UNKNOWN');
  if(byte[0]===10)break;bytes.push(byte[0]);}
 if(bytes.length>=16384)throw Error('ORIGINAL_RESPONSE_BOUND');
 const response=JSON.parse(Buffer.from(bytes).toString('utf8'));
 if(response.format!=='sabalan-protected-bootstrap-boundary-result/v1'||response.command!==command
  ||response.sequence!==sequence||response.deploymentId!==message.deploymentId||response.releaseId!==message.releaseId
  ||response.status!=='COMPLETED')throw Error('ORIGINAL_RESPONSE_UNPROVEN');
 // No response field can certify native readiness, SQL epoch or publication.
 // Those are independently verified by the original controller and final gate.
 process.stdout.write(JSON.stringify({command,sequence,originalChannelReturned:true,releaseAcceptanceGranted:false})+'\n');
}catch{await held();}
