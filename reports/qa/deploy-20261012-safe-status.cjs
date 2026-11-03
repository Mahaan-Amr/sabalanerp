const fs=require('node:fs');
const dir='/app/recovery-coordination';
for(const name of ['deployment-report.json','active-deployment-session.json']) {
 if(!fs.existsSync(dir+'/'+name)){console.log(JSON.stringify({file:name,present:false}));continue;}
 const r=JSON.parse(fs.readFileSync(dir+'/'+name,'utf8'));
 console.log(JSON.stringify({file:name,phase:r.phase,result:r.result,deploymentId:r.deploymentId,targetCommit:r.targetCommit,gates:r.gates?.map(g=>({name:g.name,passed:g.passed})),checkpoint:r.checkpoint?{localVerified:r.checkpoint.localVerified,remoteVerified:r.checkpoint.remoteVerified}:undefined}));
}
console.log(JSON.stringify({runningCommit:process.env.APP_COMMIT,performanceCommit:process.env.PERFORMANCE_RELEASE_COMMIT}));
const mount='/app/deployment-remote';
console.log(JSON.stringify({remoteMount:fs.existsSync(mount),mountNames:fs.existsSync('/app')?fs.readdirSync('/app').filter(x=>x.includes('remote')):[]}));
