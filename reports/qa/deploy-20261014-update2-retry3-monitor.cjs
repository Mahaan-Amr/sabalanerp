const fs=require('fs'),{execFileSync}=require('child_process'),cwd='/opt/sabalanerp';const file=cwd+'/reports/deploy/codex-update-20261014-update2-retry3.log';
const transfer=JSON.parse(execFileSync('node',['reports/qa/deploy-20261014-update2-retry3-transfer.cjs'],{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}));
const exitFile=file.replace('.log','.exit'),exit=fs.existsSync(exitFile)?fs.readFileSync(exitFile,'utf8').trim():null;
const lines=fs.readFileSync(file,'utf8').split('\n'),step=lines.filter(x=>/^#.*(RUN |DONE |exporting |ERROR)|^Creating, decrypt|^Applying migrations|^Deployment .*completed/.test(x)).slice(-1)[0];
console.log(JSON.stringify({at:new Date().toISOString(),...transfer,step:transfer.deploymentId?undefined:step?.slice(0,140),exit}));if(exit!==null)console.log('DEPLOY_EXIT='+exit);
