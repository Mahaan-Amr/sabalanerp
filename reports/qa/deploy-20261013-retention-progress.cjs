const fs=require('node:fs'),path=require('node:path');
for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{
 const args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');if(!args.includes('dist/scripts/deployment-checkpoint.js'))continue;
 const root='/proc/'+pid+'/root/app/storage/recovery';const folder=root+'/packages';if(!fs.existsSync(folder))continue;
 const candidates=fs.readdirSync(folder).filter(n=>n.startsWith('deploy-')&&n.endsWith('.sabrec.json')).flatMap(n=>{try{const r=JSON.parse(fs.readFileSync(folder+'/'+n,'utf8'));return r.remoteVerified&&r.remotePath?[{name:path.basename(r.archivePath||n.slice(0,-5)),size:r.size||0}]:[]}catch{return[]}});
 let current;for(const fd of fs.readdirSync('/proc/'+pid+'/fd')){try{const t=fs.readlinkSync('/proc/'+pid+'/fd/'+fd);if(/deployment-remote.*\.sabrec$/.test(t))current=path.basename(t)}catch{}}
 const audit=root+'/audit/deployment-retention.jsonl';const entries=fs.existsSync(audit)?fs.readFileSync(audit,'utf8').trim().split('\n').filter(Boolean).flatMap(l=>{try{return[JSON.parse(l)]}catch{return[]}}):[];
 console.log(JSON.stringify({verifiedArchiveCandidates:candidates.length,totalArchiveBytes:candidates.reduce((s,r)=>s+r.size,0),currentCandidateIndex:current?candidates.findIndex(r=>r.name===current)+1:null,retentionPrunesToday:entries.filter(r=>String(r.at).startsWith('2026-10-13')&&r.reason==='REMOTE_VERIFIED_RETENTION_PRUNE').length}));break;
}catch{}}
