const fs=require('node:fs');
const {activateDeploymentMaintenance}=require('/app/dist/services/deploymentMaintenance.js');
(async()=>{
 const dir='/app/recovery-coordination',expected='test-candidate-e2cc9d5fec4c4f6986fd18be516f8c5b',release='test-release-e2cc9d5fec4c4f6986fd18be516f8c5b';
 const s=fs.lstatSync(dir,{bigint:true});if(!s.isDirectory()||s.dev!==57n||s.ino!==996n||s.uid!==0n||s.gid!==0n||(s.mode&0o777n)!==0o700n||fs.realpathSync(dir)!==dir)throw Error('COORDINATION_IDENTITY_UNPROVEN');
 const target=dir+'/deployment-maintenance.json';if(fs.existsSync(target))throw Error('MAINTENANCE_ALREADY_EXISTS');
 await activateDeploymentMaintenance(dir,{deploymentId:expected,releaseId:release,message:'isolated synthetic test',activatedAt:new Date()});
 const f=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);try{const a=fs.fstatSync(f,{bigint:true});if(!a.isFile()||a.uid!==0n||a.nlink!==1n||(a.mode&0o777n)!==0o600n)throw Error('MAINTENANCE_METADATA_UNPROVEN');const j=JSON.parse(fs.readFileSync(f,'utf8'));if(j.deploymentId!==expected||j.releaseId!==release)throw Error('MAINTENANCE_ID_UNPROVEN');fs.fsyncSync(f)}finally{fs.closeSync(f)}
 const df=fs.openSync(dir,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);try{fs.fsyncSync(df)}finally{fs.closeSync(df)}
 process.stdout.write(JSON.stringify({state:'TEST_MAINTENANCE_CREATED',deploymentId:expected,releaseId:release,productionAdmission:false})+'\n');
})().catch(()=>{process.stderr.write('TEST_MAINTENANCE_UNKNOWN\n');process.exitCode=1});