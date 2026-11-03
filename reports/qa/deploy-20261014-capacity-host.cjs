const fs=require('fs'),{execFileSync}=require('child_process');
const c=JSON.parse(execFileSync('docker',['inspect','sabalanerp-backend-1'],{encoding:'utf8'}))[0];
const source=c.Mounts.find(m=>m.Destination==='/app/recovery-coordination')?.Source;
if(!source)throw new Error('COORDINATION_SOURCE_MISSING');
const cp=JSON.parse(fs.readFileSync(source+'/deployment-checkpoint.json','utf8'));
console.log(JSON.stringify({previousCheckpoint:cp.deploymentId,previousCapacity:cp.capacity?.estimate}));
