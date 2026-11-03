const fs=require('node:fs');
const {execFileSync}=require('node:child_process');
const docker=(args)=>execFileSync('docker',args,{encoding:'utf8'});
const root='/var/lib/docker/volumes/sabalanerp_backend_recovery/_data/packages';
const protectedImages=new Set();
for(const name of fs.readdirSync(root).filter(n=>n.endsWith('.sabrec.json'))){
 const meta=JSON.parse(fs.readFileSync(root+'/'+name,'utf8'));
 for(const digest of Object.values(meta.rollbackReleaseSet||{}))protectedImages.add(digest);
}
const containerIds=docker(['ps','-aq']).trim().split('\n').filter(Boolean);
if(containerIds.length)for(const container of JSON.parse(docker(['inspect',...containerIds])))protectedImages.add(container.Image);
const candidates=['backend','frontend','inquiry'].map(service=>'sabalanerp-'+service+':add179ec6ef6745c82506811f99b169cac9af438');
const measured=JSON.parse(docker(['image','inspect',...candidates]));
for(const image of measured){
 if(protectedImages.has(image.Id)||!image.RepoTags||image.RepoTags.length!==1||!candidates.includes(image.RepoTags[0]))throw Error('Protected or shared candidate image');
}
for(const tag of candidates){
 console.log(docker(['image','rm',tag]).trim());
}
console.log(docker(['system','df']).trim());
