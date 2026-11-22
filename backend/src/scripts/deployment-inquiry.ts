import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma, disconnectDatabase } from '../lib/prisma';
import { adoptInquiryBaseline } from '../services/inquiryMigrationPlan';
import { RECOVERY_COORDINATION_DIR } from '../services/recoveryRuntime';
import { assertRuntimeControlOwnership } from '../services/runtimeControlOwnership';

async function main() {
  assertRuntimeControlOwnership();
  const owner={deploymentId:process.env.DEPLOYMENT_ID || '',releaseId:process.env.DEPLOYMENT_RELEASE_ID || '',
    leaseToken:process.env.DEPLOYMENT_LEASE_TOKEN || ''};
  if(Object.values(owner).some(value=>!value))throw new Error('INQUIRY_MIGRATION_OWNER_REQUIRED');
  const checkpoint=JSON.parse(await fs.readFile(path.join(RECOVERY_COORDINATION_DIR,'deployment-checkpoint.json'),'utf8'));
  if(checkpoint.deploymentId!==owner.deploymentId || checkpoint.releaseId!==owner.releaseId || checkpoint.localVerified!==true
    || checkpoint.remoteVerified!==true || checkpoint.restoreVerified!==true || checkpoint.manifestReadable!==true
    || checkpoint.compatibility?.local?.compatible!==true || checkpoint.compatibility?.remote?.compatible!==true)throw new Error('INQUIRY_VERIFIED_CHECKPOINT_REQUIRED');
  const result=await adoptInquiryBaseline(prisma,owner,{coordinationDirectory:RECOVERY_COORDINATION_DIR,
    databaseFile:path.join(process.env.INQUIRY_RECOVERY_SOURCE_DIR || '/app/recovery-sources/inquiry','inquiry.db')});
  console.log(JSON.stringify({ok:true,...result}));
}
main().catch(()=>{console.error('INQUIRY_CONTROL_MIGRATION_FAILED');process.exitCode=1;}).finally(()=>disconnectDatabase());
