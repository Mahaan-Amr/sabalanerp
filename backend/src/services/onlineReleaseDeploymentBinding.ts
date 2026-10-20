/** Registry acceptance belongs to the immutable release's ORIGINAL deployment.
 * The CURRENT orchestration lease may belong to a newer candidate during a
 * current-data rollback; it must never be substituted for this identity. */
export function onlineRuntimeDeploymentMatches(deployment:{releaseId:unknown;targetCommit:unknown},
 scope:{releaseId:string;sourceCommit:string}){
 return deployment.releaseId===scope.releaseId&&deployment.targetCommit===scope.sourceCommit;
}
