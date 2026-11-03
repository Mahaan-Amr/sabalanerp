const fs=require('node:fs');
const report=JSON.parse(fs.readFileSync('/app/recovery-coordination/deployment-report.json','utf8'));
console.log(JSON.stringify({commit:process.env.APP_COMMIT,deploymentId:report.deploymentId,targetCommit:report.targetCommit,result:report.result,
gates:report.gates?.map(g=>({name:g.name,passed:g.passed}))}));
