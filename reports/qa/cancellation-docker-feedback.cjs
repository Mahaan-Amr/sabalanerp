const {spawnSync}=require('child_process');
for(const [name,exe,args] of [
 ['docker-client','docker',['version','--format','{{.Client.Version}} {{.Server.Version}}']],
 ['compose-version','C:/Users/mahan/.docker/cli-plugins/docker-compose.exe',['version']],
 ['compose-direct-status','C:/Users/mahan/.docker/cli-plugins/docker-compose.exe',['-f','docker-compose.local.yml','ps','--format','json']]
]){const r=spawnSync(exe,args,{encoding:'utf8',timeout:12000});console.log(JSON.stringify({name,exit:r.status,error:r.error?.code,output:(r.stdout||r.stderr||'').slice(0,4000)}));}
