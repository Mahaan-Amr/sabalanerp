const fs=require('node:fs');
for(const line of fs.readFileSync('/opt/sabalanerp/reports/deploy/codex-update-20261004-hr.log','utf8').split('\n').filter(l=>/error|failed|rollback|unhealthy|insufficient/i.test(l)).slice(-15)){
 try{const r=JSON.parse(line);console.log(JSON.stringify({ok:r.ok,error:r.error,code:r.code,message:r.message,phase:r.deployment?.phase,gates:r.gates?.map(g=>({name:g.name,passed:g.passed,detail:g.detail}))}));}
 catch{console.log(line.replace(/(postgres(?:ql)?:\/\/)[^@ ]+@/gi,'$1[redacted]@').replace(/("?leaseToken"?\s*[:=]\s*")[^"]*/gi,'$1[redacted]').slice(0,500));}
}
