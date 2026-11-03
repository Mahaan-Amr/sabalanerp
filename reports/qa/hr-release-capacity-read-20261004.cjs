const fs=require('node:fs');
const path=require('node:path');
const {directorySize,estimateCheckpointCapacity}=require('/app/dist/services/deploymentCheckpointStorage');
const {prisma,disconnectDatabase}=require('/app/dist/lib/prisma');
const {RECOVERY_COORDINATION_DIR,RECOVERY_ROOT}=require('/app/dist/services/recoveryRuntime');
(async()=>{
 const dirs=['contracts','hr-hiring','accounting-contracts','support-tickets','performance-exports'].map(d=>path.join('/app/storage',d));
 dirs.push('/app/uploads',process.env.INQUIRY_RECOVERY_SOURCE_DIR||'/app/recovery-sources/inquiry',RECOVERY_COORDINATION_DIR);
 const protectedFilesBytes=(await Promise.all(dirs.map(directorySize))).reduce((a,b)=>a+b,0);
 const rows=await prisma.$queryRawUnsafe('SELECT pg_database_size(current_database()) AS bytes');
 const capacity=estimateCheckpointCapacity({databaseBytes:Number(rows[0].bytes),protectedFilesBytes});
 const stat=fs.statfsSync(RECOVERY_ROOT);
 console.log(JSON.stringify({capacity,availableBytes:stat.bavail*stat.bsize}));
})().catch(e=>{console.error(e.message);process.exitCode=1}).finally(disconnectDatabase);
