const fs=require('node:fs'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const folder='C:/Users/mahan/.codex/backups/invoice-100697-20261013';
const base=['-o','BatchMode=yes','-o','ConnectTimeout=12','-i','C:/Users/mahan/.ssh/sabalan_codex_deploy_ed25519'];
async function run(program,args,onData){const child=spawn(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});let err='';child.stdout.on('data',b=>onData?.(b));child.stderr.on('data',b=>{err+=b.toString()});await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',code=>code===0?resolve():reject(Error('BACKUP_TRANSFER_FAILED:'+code+':'+err.slice(0,250))))})}
(async()=>{
 const manifestPath=folder+'/verified-backup-manifest.json',m=JSON.parse(fs.readFileSync(manifestPath));
 if(!m.decryptVerified||!m.restoreListVerified)throw Error('BACKUP_UNVERIFIED');
 const remote='/opt/sabalanerp/reports/recovery/invoice-100697-20261013';
 await run('ssh',[...base,'root@94.182.85.254','umask 077; mkdir -p '+remote+'; chmod 700 '+remote]);
 await run('scp',[...base,m.localArchive,'root@94.182.85.254:'+remote+'/postgres-before.dump.aesgcm']);
 await run('ssh',[...base,'root@94.182.85.254','chmod 600 '+remote+'/postgres-before.dump.aesgcm']);
 const hash=crypto.createHash('sha256');let size=0;
 await run('ssh',[...base,'root@94.182.85.254','cat '+remote+'/postgres-before.dump.aesgcm'],chunk=>{hash.update(chunk);size+=chunk.length});
 if(size!==m.bytes||hash.digest('hex')!==m.ciphertextSha256)throw Error('SERVER_COPY_READBACK_MISMATCH');
 m.serverArchive=remote+'/postgres-before.dump.aesgcm';m.serverCopyReadbackVerified=true;m.remoteVerifiedAt=new Date().toISOString();
 fs.writeFileSync(manifestPath,JSON.stringify(m,null,2));
 await run('scp',[...base,manifestPath,'root@94.182.85.254:'+remote+'/backup-manifest.json']);
 let sidecar='';await run('ssh',[...base,'root@94.182.85.254','chmod 600 '+remote+'/backup-manifest.json; cat '+remote+'/backup-manifest.json'],b=>{sidecar+=b.toString()});
 if(sidecar!==fs.readFileSync(manifestPath,'utf8'))throw Error('SIDECAR_READBACK_MISMATCH');
 console.log(JSON.stringify({ok:true,bytes:m.bytes,sha256:m.ciphertextSha256,localArchive:m.localArchive,serverArchive:m.serverArchive,serverCopyReadbackVerified:true,sidecarReadbackVerified:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
