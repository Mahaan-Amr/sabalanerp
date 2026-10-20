import fs from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY} from './onlineReleaseControllerAuthority';

const canonical=(value:any):any=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'
  ?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const sha=(raw:Buffer)=>createHash('sha256').update(raw).digest('hex');
const need=(value:unknown)=>{if(!value)throw Error('ONLINE_ORIGINAL_GATE_CONTEXT_UNPROVEN');};
const pin=(s:fs.BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.uid,s.mode,s.nlink].map(String).join(':');
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
  return verifyOnlineDeploymentGateContext(read(file,32768,0o400),read(ONLINE_RELEASE_CONTROLLER_PUBLIC_KEY,4096,0o444),expected);
}
