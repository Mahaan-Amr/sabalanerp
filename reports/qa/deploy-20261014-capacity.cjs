const fs=require('fs'),path=require('path');
const config=fs.readFileSync('/opt/sabalanerp/deploy/.env.prod','utf8');
const dir=config.match(/^DEPLOYMENT_REPORT_DIR_HOST=(.*)$/m)?.[1]?.trim();
if(!dir)throw new Error('REPORT_DIRECTORY_MISSING');
const checkpoint=JSON.parse(fs.readFileSync(path.resolve('/opt/sabalanerp',dir,'deployment-checkpoint.json'),'utf8'));
console.log(JSON.stringify({previousCheckpoint:checkpoint.deploymentId,previousCapacity:checkpoint.capacity?.estimate}));
