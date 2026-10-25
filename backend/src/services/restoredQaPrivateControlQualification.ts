/** Callback composition only. The outer original still owes real HTTP/Node
 * closure, exact temporary-database cleanup and independent evidence signing. */
import {assertActiveStrictRestoreProof,withSystemRecoveryDatabaseClient} from './systemRecoveryEngine';
import {withRestoredQaWorkingMaterial,type RestoredQaWorkingMaterial} from './restoredQaWorkingMaterial';
import {withRestoredQaHistoricalAnchor} from './protectedRestoredQaHrAnchor';
import {withRestoredQaPrivateOperation,completeRestoredQaPrivateControl,assertRestoredQaPrivateNormal,type RestoredQaPrivateNormal} from './restoredQaMigrationBaseline';
import {adoptRestoredQaLegacyFiles} from './restoredQaFileAdoptionAuthority';
import {runRestoredQaDeploymentOwnedMigrations} from '../scripts/deployment-owned-migrations';

type IntendedOwner=Readonly<{deploymentId:string;releaseId:string}>;
type PrivateScope=Readonly<{material:RestoredQaWorkingMaterial;normal:RestoredQaPrivateNormal;
 owner:Readonly<IntendedOwner&{leaseToken:string}>}>;
/** The fixed standalone worker supplies the reviewed private callback, never a
 * public endpoint or client callback. No PrismaClient leaves its finally scope.
 * Certificate/checkpoint files must already be original-channel authenticated
 * and immutable in this original's own coordination directory. */
export async function withRestoredQaPrivateControlQualification<T>(proof:unknown,intendedOwner:IntendedOwner,
 targetCommit:string,files:ReadonlyMap<string,Buffer>,work:(scope:PrivateScope)=>Promise<T>){
 const context=assertActiveStrictRestoreProof(proof);
 return withRestoredQaWorkingMaterial(proof,intendedOwner,async material=>
  withRestoredQaHistoricalAnchor(proof,intendedOwner,async anchor=>
   withRestoredQaPrivateOperation(proof,material,anchor,intendedOwner,targetCommit,async(baseline,owner)=>{
    // This client finally disconnects BEFORE the adoption quiet predicate.
    const migration=await withSystemRecoveryDatabaseClient(context.proof.database.name,db=>
     runRestoredQaDeploymentOwnedMigrations(files,db,owner,anchor,baseline));
    const adoption=await adoptRestoredQaLegacyFiles(proof,baseline,material,owner);
    const completed=await completeRestoredQaPrivateControl(baseline,owner,files,migration,adoption.completion);
    assertRestoredQaPrivateNormal(completed.normal,material,owner);
    // Same live scope owns any later old/new original HTTP cohort. Its owner
    // must await all actual children and clients before resolving this work.
    const value=await work(Object.freeze({material,normal:completed.normal,owner}));
    assertRestoredQaPrivateNormal(completed.normal,material,owner);
    return Object.freeze({value,proof:Object.freeze({format:'sabalan-restored-qa-private-control-qualification/v1',
     intendedOwner:Object.freeze({...intendedOwner}),database:context.proof.database,nativeMigrations:migration.native,
     adoption:adoption.proof,privateControl:completed.proof,cleanupPending:true,outerOriginalClosurePending:true,
     independentPointHealthy:false,productionAdmission:false,financialSchemaQualified:false})});
   })));
}
