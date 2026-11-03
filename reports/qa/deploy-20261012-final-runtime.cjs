const fs=require('node:fs');
const {prisma,disconnectDatabase}=require('/app/dist/lib/prisma.js');
(async()=>{
const root='/app/recovery-coordination';
const report=JSON.parse(fs.readFileSync(root+'/deployment-report.json','utf8'));
const checkpoint=JSON.parse(fs.readFileSync(root+'/deployment-checkpoint.json','utf8'));
const deployment=await prisma.deploymentOperation.findUniqueOrThrow({where:{id:report.deploymentId},select:{id:true,releaseId:true,targetCommit:true,phase:true,completedAt:true,errorCode:true,activeKey:true}});
const releaseDeployment=await prisma.deploymentOperation.findUniqueOrThrow({where:{id:'deploy-20261012T101444Z-c0884aaabdd1-release'},select:{id:true,targetCommit:true,phase:true,completedAt:true,errorCode:true}});
const active=await prisma.deploymentOperation.count({where:{activeKey:{not:null}}});
const unfinished=await prisma.$queryRawUnsafe('SELECT count(*)::int AS count FROM _prisma_migrations WHERE finished_at IS NULL AND rolled_back_at IS NULL');
const maintenance=fs.existsSync(root+'/deployment-maintenance.json')?JSON.parse(fs.readFileSync(root+'/deployment-maintenance.json','utf8')):null;
const images={backend:process.env.PERFORMANCE_RELEASE_BACKEND_IMAGE,frontend:process.env.PERFORMANCE_RELEASE_FRONTEND_IMAGE,inquiry:process.env.PERFORMANCE_RELEASE_INQUIRY_IMAGE};
const result={deployment,releaseDeployment,runningCommit:process.env.APP_COMMIT,performanceCommit:process.env.PERFORMANCE_RELEASE_COMMIT,images,activeDeployments:active,unfinishedMigrations:unfinished[0].count,maintenanceActive:maintenance!==null,gates:report.gates.map(g=>({name:g.name,passed:g.passed})),checkpoint:{deploymentId:checkpoint.deploymentId,releaseId:checkpoint.releaseId,localVerified:checkpoint.localVerified,remoteVerified:checkpoint.remoteVerified,manifestReadable:checkpoint.manifestReadable,checksum:checkpoint.checksum,size:checkpoint.size}};
console.log(JSON.stringify(result));
if(releaseDeployment.phase!=='COMPLETED'||deployment.phase!=='COMPLETED'||deployment.targetCommit!==process.env.APP_COMMIT||active!==0||result.unfinishedMigrations!==0||result.maintenanceActive||result.gates.some(g=>!g.passed)||!checkpoint.localVerified||!checkpoint.remoteVerified||!checkpoint.manifestReadable)process.exitCode=1;
})().catch(e=>{console.error(JSON.stringify({ok:false,code:e.code||'VERIFICATION_FAILED'}));process.exitCode=1}).finally(()=>disconnectDatabase());
