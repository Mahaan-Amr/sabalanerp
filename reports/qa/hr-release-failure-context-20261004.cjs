const fs=require('node:fs');
const lines=fs.readFileSync('/opt/sabalanerp/reports/deploy/codex-update-20261004-hr.log','utf8').split('\n');
const index=lines.findIndex(l=>l.includes('Deployment failed;'));
for(const line of lines.slice(Math.max(0,index-22),index+1)){
 try{const r=JSON.parse(line); console.log(JSON.stringify({keys:Object.keys(r),ok:r.ok,phase:r.deployment?.phase,code:r.code,message:r.message,error:r.error,result:r.result,gates:r.gates,unresolved:r.unresolved,summary:r.summary}));}
 catch{console.log(line.slice(0,400));}
}
