const fs=require('node:fs'),path=require('node:path');
for(const pid of fs.readdirSync('/proc').filter(x=>/^\d+$/.test(x))){try{
 const args=fs.readFileSync('/proc/'+pid+'/cmdline','utf8');if(!args.includes('dist/scripts/deployment-checkpoint.js'))continue;
 const root='/proc/'+pid+'/root/app/storage/recovery/packages';if(!fs.existsSync(root))continue;
 const result=fs.readdirSync(root).filter(n=>n.startsWith('deploy-')&&n.endsWith('.sabrec.json')).flatMap(n=>{try{const r=JSON.parse(fs.readFileSync(root+'/'+n,'utf8'));if(!r.id||!r.archivePath||!r.checksum||!Number.isFinite(r.size))return[];return[{id:r.id,createdAt:r.createdAt,size:r.size,checksum:r.checksum,remoteVerified:r.remoteVerified===true,active:r.active===true,incidentOpen:r.incidentOpen===true,archiveName:path.basename(r.archivePath),remoteDirectory:path.basename(path.dirname(r.remotePath||''))}]}catch{return[]}});
 console.log(JSON.stringify(result));break;
}catch{}}
