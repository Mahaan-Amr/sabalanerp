import fs from 'node:fs';
import path from 'node:path';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY} from './onlineReleaseControllerAuthority';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const need=(value:unknown)=>{if(!value)throw Error('ONLINE_ORIGINAL_GATE_CONTEXT_UNPROVEN');};
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
/** Measure only immutable Prisma inputs in the authenticated control image.
 * This neither applies migrations nor supplies a caller-selected catalog. */
export function readOnlineGateCatalogIdentity(directory:string){
  need(path.isAbsolute(directory)&&fs.realpathSync(directory)===directory);
  const directoryPin=pin(fs.lstatSync(directory,{bigint:true}));
  const rows:Array<{path:string;bytes:number;sha256:string}>=[];let total=0;
  const file=(name:string)=>{
    const target=path.join(directory,name),before=fs.lstatSync(target,{bigint:true});
    need(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n&&before.size>0n&&before.size<=8n*1024n**2n);
    const fd=fs.openSync(target,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
    try{
      const held=fs.fstatSync(fd,{bigint:true}),raw=fs.readFileSync(fd);
      need(pin(held)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(target,{bigint:true})));
      for(const key of ['ino','size','mtimeNs','ctimeNs','uid','mode','nlink']as const)need(held[key]===before[key]);
      if(process.platform!=='win32')need(held.dev===before.dev);
      total+=raw.length;need(total<=32*1024**2);return raw;
    }finally{fs.closeSync(fd);}
  };
  const schemaSha256=sha(file('schema.prisma')),migrations=path.join(directory,'migrations');
  need(fs.realpathSync(migrations)===migrations);
  const migrationsPin=pin(fs.lstatSync(migrations,{bigint:true}));
  const names=fs.readdirSync(migrations).sort();need(names.length>0&&names.length<=4096);
  for(const name of names){
    need(/^[A-Za-z0-9_-]{1,200}$/.test(name)||name==='migration_lock.toml');
    let folderPin:string|undefined;
    if(name!=='migration_lock.toml'){
      const folder=path.join(migrations,name),before=fs.lstatSync(folder,{bigint:true});need(before.isDirectory()&&!before.isSymbolicLink()&&fs.realpathSync(folder)===folder);folderPin=pin(before);
      need(JSON.stringify(fs.readdirSync(folder))===JSON.stringify(['migration.sql']));
    }
    const relative='migrations/'+name+(name==='migration_lock.toml'?'':'/migration.sql'),raw=file(relative);
    rows.push({path:relative,bytes:raw.length,sha256:sha(raw)});
    if(folderPin!==undefined){const folder=path.join(migrations,name);need(folderPin===pin(fs.lstatSync(folder,{bigint:true}))&&JSON.stringify(fs.readdirSync(folder))===JSON.stringify(['migration.sql']));}
  }
  need(directoryPin===pin(fs.lstatSync(directory,{bigint:true}))&&migrationsPin===pin(fs.lstatSync(migrations,{bigint:true}))
    &&JSON.stringify(names)===JSON.stringify(fs.readdirSync(migrations).sort()));
  return {schemaSha256,migrationCatalogSha256:sha(Buffer.from(JSON.stringify(canonical(rows))))};
}
function read(file:string,maximum:number,mode:number){
  need(fs.realpathSync(file)===file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{const before=fs.fstatSync(fd,{bigint:true});need(before.isFile()&&before.uid===0n&&before.nlink===1n
    &&(before.mode&0o777n)===BigInt(mode)&&before.size>0n&&before.size<=BigInt(maximum));
    const raw=fs.readFileSync(fd);need(pin(before)===pin(fs.fstatSync(fd,{bigint:true}))&&pin(before)===pin(fs.lstatSync(file,{bigint:true})));return raw;
  }finally{fs.closeSync(fd);}
}
/** A request path or environment URL is never sufficient authority to redirect
 * a canonical production health gate. Only the original controller signs it. */
export function verifyOnlineDeploymentGateContext(raw:Buffer,publicKey:Buffer,expected:{deploymentId:string;releaseId:string},now=Date.now()){
  const envelope=JSON.parse(raw.toString('utf8')),d=envelope.decision;
  need(envelope.format==='sabalan-signed-online-deployment-gates/v1'&&typeof envelope.signature==='string');
  need(d?.format==='sabalan-original-online-deployment-gates/v1'&&d.deploymentId===expected.deploymentId&&d.releaseId===expected.releaseId
    &&/^[a-f0-9]{64}$/.test(d.manifestSha256)&&/^[a-f0-9]{64}$/.test(d.checkpointSha256));
  if(d.controlRunner!==undefined){
    const r=d.controlRunner;
    need(r&&Object.keys(r).sort().join(',')==='format,image,imageInspectionSha256,migrationCatalogSha256,migrationLedgerSha256,releaseId,schemaSha256,sourceCommit');
    need(r.format==='sabalan-original-online-gate-control-runner/v1'&&/^[A-Za-z0-9_-]{8,128}$/.test(r.releaseId)
      &&/^[a-f0-9]{40}$/.test(r.sourceCommit)&&/^sha256:[a-f0-9]{64}$/.test(r.image));
    for(const key of ['imageInspectionSha256','schemaSha256','migrationCatalogSha256','migrationLedgerSha256'])need(/^[a-f0-9]{64}$/.test(r[key]));
  }
  const issued=Date.parse(d.issuedAt),expires=Date.parse(d.expiresAt);need(Number.isFinite(issued)&&Number.isFinite(expires)&&issued<=now&&expires>now&&expires-issued<=600000);
  need(verify(null,Buffer.concat([Buffer.from('sabalan-original-online-deployment-gates/v1\n'),Buffer.from(JSON.stringify(canonical(d)))]),
    createPublicKey(publicKey),Buffer.from(envelope.signature,'base64')));
  need(d.targets&&Object.keys(d.targets).sort().join(',')==='backend,frontend,inquiry,nginx');
  for(const [role,target]of Object.entries(d.targets) as Array<[string,any]>){
    need(/^[a-f0-9]{64}$/.test(target.containerId)&&/^sha256:[a-f0-9]{64}$/.test(target.image)&&typeof target.startedAt==='string');
    const url=new URL(target.url);need(url.protocol==='http:'&&!url.username&&!url.password&&!url.search&&!url.hash
      &&/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(url.hostname)
      &&url.pathname===(role==='backend'?'/api/ready':role==='nginx'?'/healthz':'/'));
  }
  return {decision:d,sha256:sha(raw)};
}
export function readOnlineDeploymentGateContext(file:string,expected:{deploymentId:string;releaseId:string}){
  const value=verifyOnlineDeploymentGateContext(read(file,32768,0o400),read(ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY,4096,0o444),expected);
  if(value.decision.controlRunner){
    const actual=readOnlineGateCatalogIdentity('/app/prisma');
    need(actual.schemaSha256===value.decision.controlRunner.schemaSha256&&actual.migrationCatalogSha256===value.decision.controlRunner.migrationCatalogSha256);
  }
  return value;
}
