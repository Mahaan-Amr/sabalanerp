'use strict';
// TEST ONLY, UNEXECUTED. Run under the existing FD9 wrapper only after a
// reviewed private fixture is provisioned and all host checks pass.
const fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const root=process.argv[2];
if(process.argv.length!==3||!/^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/.test(root)||fs.realpathSync(root)!==root||process.env.RECOVERY_COORDINATION_DIR!==root+'/coordination'||process.env.BACKEND_CONTROL_LOCK_FD!=='9')throw Error('TEST_SEQUENCE_UNKNOWN');
const config=JSON.parse(fs.readFileSync(root+'/configuration.json','utf8'));
if(!/^sabalanerp_protected_[a-f0-9]{32}$/.test(config.databaseName)||!/^\d+:\d+$/.test(config.identity))throw Error('TEST_SEQUENCE_UNKNOWN');
const driver=root+'/dist/services/__tests__/protectedCandidateNativeStageDriver.js';
const phases=[['rollback',0],['resume-fault',1],['complete',14]];
function writeReceipt(phase,value){
 const fd=fs.openSync(root+'/receipt-'+phase+'.json','wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify(value)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function run(phase){return new Promise(resolve=>{
 let output='',error='',unknown=false;
 const child=spawn(process.execPath,[driver,root+'/configuration.json',phase],{stdio:['ignore','pipe','pipe','ignore','ignore','ignore','ignore','ignore','ignore',9],env:process.env});
 const timer=setTimeout(()=>{unknown=true;},120000);
 child.stdout.on('data',b=>{output+=b;if(output.length>65536)unknown=true;});
 child.stderr.on('data',b=>{error+=b;if(error.length>65536)unknown=true;});
 child.on('error',()=>{unknown=true;});
 child.on('close',(code,signal)=>{clearTimeout(timer);let value;
  try{if(!unknown&&code===0&&signal===null)value=JSON.parse(output.trim());}catch{unknown=true;}
  resolve({unknown,code,signal,value,stderrBytes:Buffer.byteLength(error)});
 });
});}
(async()=>{
 let history;
 for(const [phase,prefix] of phases){
  const result=await run(phase),value=result.value;
  const valid=!result.unknown&&result.code===0&&result.signal===null&&value?.state==='OBSERVED'&&value.phase===phase&&value.prefix===prefix&&value.database===config.databaseName&&value.identity===config.identity&&value.lockerClosed===true&&value.productionAdmission===false&&/^[a-f0-9]{64}$/.test(value.priorHistorySha256)&&(phase==='complete'||value.observedWait===true)&&(!history||history===value.priorHistorySha256);
  const receipt={format:'sabalan-native-stage-fixture-phase/v1',phase,state:valid?'OBSERVED':'UNKNOWN',child:{exit:result.code,signal:result.signal,stderrBytes:result.stderrBytes},...(valid?{observation:value}:{})};
  writeReceipt(phase,receipt);
  if(!valid){process.stderr.write('NATIVE_STAGE_SEQUENCE_UNKNOWN\n');process.exitCode=1;return;}
  history=value.priorHistorySha256;
 }
 process.stdout.write('NATIVE_STAGE_SEQUENCE_OBSERVED\n');
})().catch(()=>{process.stderr.write('NATIVE_STAGE_SEQUENCE_UNKNOWN\n');process.exitCode=1;});
