import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOnlineCarrierRootCoverage,ONLINE_EPHEMERAL_PDF_ROOTS} from '../../deploy/scripts/online-carrier-root-coverage.mjs';
function fixture(){
 const names=['contracts','hr-hiring','accounting-contracts','support-tickets','performance-exports','dispatch-documents','uploads/a','uploads/b','uploads/c'];
 const roots=names.map((name,index)=>({live:'/app/storage/'+name,store:'/app/recovery-coordination/versioned/'+index}));
 const plan={kind:'backend',mounts:[...names.map((name,index)=>({type:'volume',source:'actual_'+index,target:'/app/storage/'+name,readOnly:false})),{type:'volume',source:'coordination',target:'/app/recovery-coordination',readOnly:false}],tmpfs:ONLINE_EPHEMERAL_PDF_ROOTS.map(value=>value+':rw,nosuid,nodev,mode=700,size=32m')};
 return {plan,manifest:{roots,ephemeralRoots:[...ONLINE_EPHEMERAL_PDF_ROOTS]}};
}
test('all9 live+store paths require persistent existing-volume coverage;3 classified PDFs exact tmpfs',()=>{
 const {plan,manifest}=fixture();assert.deepEqual(assertOnlineCarrierRootCoverage(plan,manifest),{retainedRoots:9,ephemeralRoots:3,persistentCoverageVerified:true,baselineAdoptionAuthorized:false});
});
test('missing Dispatch volume fails even though other8 roots and stores are covered',()=>{
 const {plan,manifest}=fixture();plan.mounts=plan.mounts.filter(value=>!value.target.endsWith('/dispatch-documents'));assert.throws(()=>assertOnlineCarrierRootCoverage(plan,manifest),/RETAINED_NOT_PERSISTENT/);
});
test('readonly/store/tmpfs shadowing and incomplete ephemeral paths refuse without baseline adoption',()=>{
 const edits=[f=>f.plan.mounts.at(-1).readOnly=true,f=>f.plan.mounts[0].type='bind',f=>f.plan.tmpfs.push('/app/storage/contracts:rw'),f=>f.plan.tmpfs.pop(),f=>f.manifest.ephemeralRoots[0]='/app/storage/unknown',f=>f.plan.mounts.push({type:'volume',source:'shadow',target:'/app/storage/contracts/hidden',readOnly:false}),f=>f.manifest.roots[0].live='/app/storage/contracts/../hidden'];
 for(const edit of edits){const f=fixture();edit(f);assert.throws(()=>assertOnlineCarrierRootCoverage(f.plan,f.manifest),/ONLINE_ROOT_COVERAGE_/);}
});
