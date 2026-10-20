import {prisma} from '../lib/prisma';
import {assertProtectedOnlineBootstrapFinalized} from '../services/onlineReleaseBootstrap';
import {RECOVERY_COORDINATION_DIR} from '../services/recoveryRuntime';

async function main(){
 const owner={deploymentId:process.env.DEPLOYMENT_ID||'',releaseId:process.env.DEPLOYMENT_RELEASE_ID||'',leaseToken:process.env.DEPLOYMENT_LEASE_TOKEN||''};
 try{
  if(!owner.deploymentId||!owner.releaseId||!owner.leaseToken)throw Error('ONLINE_BOOTSTRAP_ORIGINAL_DEPLOYMENT_REQUIRED');
  console.log(JSON.stringify(await assertProtectedOnlineBootstrapFinalized(prisma,owner,RECOVERY_COORDINATION_DIR)));
 }
 finally{await prisma.$disconnect();}
}
void main().catch(()=>{console.error('ONLINE_BOOTSTRAP_FINAL_GATE_FAILED');process.exitCode=1;});
