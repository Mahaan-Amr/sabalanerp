const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
execFileSync('docker',['compose','--env-file','deploy/.env.prod','-f','docker-compose.prod.yml','ps'],{cwd:'/opt/sabalanerp',stdio:'ignore'});
const c=JSON.parse(execFileSync('docker',['inspect','sabalanerp-backend-1'],{encoding:'utf8'}))[0];
if(c.State.Status!=='running'||c.State.Health?.Status!=='healthy')throw new Error('BACKEND_NOT_HEALTHY');
const source=c.Mounts.find(m=>m.Destination==='/app/storage/recovery')?.Source;if(!source)throw new Error('RECOVERY_SOURCE_MISSING');
const root=fs.realpathSync(path.join(source,'packages'));
const rows=fs.readdirSync(root).filter(n=>n.startsWith('deploy-')&&n.endsWith('.sabrec.json')).map(n=>{const r=JSON.parse(fs.readFileSync(path.join(root,n),'utf8'));const archiveName=n.slice(0,-5),archiveHostPath=path.join(root,archiveName);if(fs.realpathSync(archiveHostPath)!==archiveHostPath||fs.statSync(archiveHostPath).size!==r.size)throw new Error('ARCHIVE_IDENTITY_CHANGED');return{id:r.id,createdAt:r.createdAt,size:r.size,checksum:r.checksum,localVerified:r.localVerified===true,manifestReadable:r.manifestReadable===true,remoteVerified:r.remoteVerified===true,archiveName,archiveHostPath,metadataHostPath:path.join(root,n),remoteDirectory:path.basename(path.dirname(r.remotePath||'')),canonicalRemotePath:r.remotePath===path.join('/app/deployment-remote',path.basename(path.dirname(r.remotePath||'')),archiveName)}});
console.log(JSON.stringify(rows));
