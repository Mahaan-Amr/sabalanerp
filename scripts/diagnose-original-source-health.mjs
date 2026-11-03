/** Finite read-only source host census. Negative diagnostics never qualify a
 * baseline or alter a service, lock contract, source checkout or health gate. */
import assert from'node:assert/strict';import fs from'node:fs';import path from'node:path';import{randomBytes,createHash}from'node:crypto';
import{acquireSerialHostLease}from'./lib/serial-physical/host-lease.mjs';import{originalBackendBaseCommands}from'./lib/production-backend-base-process.mjs';
const Q='D:/sabalanerp-online-qa',sha=b=>createHash('sha256').update(b).digest('hex'),operation=randomBytes(16).toString('hex'),commands=originalBackendBaseCommands(),report={format:'sabalan-419-source-health-diagnostic/v1',operation,diagnosticOnly:true,qualificationAccepted:false,productionAdmission:false,children:[]};let lease;
const kernel=Q+'/C29-installed45cab-healthy-baseline-source-r2-exact-bytes-20261024/observe-baseline-remote.py';assert.equal(sha(fs.readFileSync(kernel)),'95582c20240571f96758df9e256415b5d8fd70b98474ff7df0b97e20c52a1a8f');
async function run(exe,args,input){lease.assertHeld();const row=await commands.run(exe,args,{input,maximum:2*1024**2});report.children.push(row);commands.assertSuccessful(row);assert.equal(row.stderr,'');return row.stdout;}
try{
 lease=await acquireSerialHostLease(Q+'/deployment.lock');report.leasePid=lease.originalPid;
 const suffix=String.raw`
import json,hashlib,sys,datetime
k={'__name__':'fixed_readonly_health_kernel'};exec(compile(KERNEL,'reviewed-source-install-kernel','exec'),k)
h=k['NativeHost']({'sourceHost':SOURCE_HOST},None)
try:
 h.acquire()
 host={key:hashlib.sha256(k['Path'](p).read_text().strip().lower().encode()).hexdigest()for key,p in [('machineUuidSha256','/sys/class/dmi/id/product_uuid'),('kernelBootIdSha256','/proc/sys/kernel/random/boot_id')]};assert host==SOURCE_HOST
 ids=h.run(['docker','ps','-aq','--no-trunc']).decode().split();assert len(ids)==8
 values=json.loads(h.run(['docker','container','inspect',*ids]));rows=sorted([{'id':c['Id'],'image':c['Image'],'startedAt':c['State']['StartedAt'],'restartCount':c['RestartCount'],'status':c['State']['Status'],'health':c['State'].get('Health',{}).get('Status'),'project':c['Config'].get('Labels',{}).get('com.docker.compose.project'),'service':c['Config'].get('Labels',{}).get('com.docker.compose.service'),'exitCode':c['State']['ExitCode'],'oomKilled':c['State']['OOMKilled']}for c in values],key=lambda r:r['id'])
 h.baseline=rows;h.lock_guard();h.no_lease();assert all(c['pipesClosed']and c['code']==0 and c['observationFault']is None for c in h.children)
 print(json.dumps({'format':'sabalan-source-health-readonly-diagnostic/v1','observedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'rows':rows,'children':h.children,'readOnly':True,'diagnosticOnly':True,'qualified':False,'productionAdmission':False}))
finally:h.close()
`;
 const generator="import ast,pathlib,sys,json,hashlib\np=pathlib.Path(sys.argv[1]);raw=p.read_bytes();assert hashlib.sha256(raw).hexdigest()=='95582c20240571f96758df9e256415b5d8fd70b98474ff7df0b97e20c52a1a8f';tree=ast.parse(raw);names={}\nfor n in tree.body:\n if isinstance(n,ast.Assign):\n  for t in n.targets:\n   if isinstance(t,ast.Name)and t.id in ('KERNEL','SOURCE_HOST'):names[t.id]=ast.literal_eval(n.value)\nassert hashlib.sha256(names['KERNEL'].encode()).hexdigest()=='36c1c3de4a74b3c858b9b9e7eaced6607f6604d7fecd52b6000b78b754afa262';print('KERNEL='+repr(names['KERNEL'])+'\\nSOURCE_HOST='+repr(names['SOURCE_HOST'])+'\\n'+sys.stdin.read())";
 const source=Buffer.from(await run('C:/Users/mahan/AppData/Local/Programs/Python/Python314/python.exe',['-I','-B','-c',generator,kernel],Buffer.from(suffix)));report.sourceSha256=sha(source);
 const profileRaw=fs.readFileSync(Q+'/fixed-production-openssh-profile-20261020.json');assert.equal(sha(profileRaw),'71c591618aff78625652a341d3798bc231e9617f0c626c55c12c9a93a453e298');const p=JSON.parse(profileRaw);
 for(const[file,pin]of[['sshExecutable','sshExecutableSha256'],['privateKeyPath','privateKeySha256'],['knownHostsPath','knownHostsSha256']])assert.equal(sha(fs.readFileSync(p[file])),p[pin]);
 assert.deepEqual([p.host,p.user,p.port],['94.182.85.254','root',22]);
 const out=await run(p.sshExecutable,['-T','-p','22','-i',p.privateKeyPath,'-o','BatchMode=yes','-o','IdentitiesOnly=yes','-o','IdentityAgent=none','-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+p.knownHostsPath,'-o','GlobalKnownHostsFile=none','root@94.182.85.254','python3 -I -B -'],source);report.observation=JSON.parse(out);
}catch(error){report.failure={name:error.name,code:error.code??null,message:error.message};process.exitCode=1;}
finally{report.originalChildren=await commands.close();if(lease){await lease.release();report.leaseClosed=true;}const file=path.resolve('reports/qa/issue-419-c3-bindings-20261026/SOURCE-HEALTH-DIAGNOSTIC-'+operation+'.json');fs.writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({file,failure:report.failure??null,rows:report.observation?.rows,qualificationAccepted:false}));}
