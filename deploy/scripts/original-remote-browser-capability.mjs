import assert from 'node:assert/strict';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {readOriginalRemoteBrowserEnvelope} from './readonly-transport-retirement.mjs';

const capabilities=new WeakMap(),hash=value=>createHash('sha256').update(value).digest('hex');
const fail=()=>{throw Error('ORIGINAL_REMOTE_BROWSER_CAPABILITY_UNPROVEN');};
const freeze=value=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};

export async function openOriginalRemoteBrowserConnection(retirementChannel){
  const enrolled=await readOriginalRemoteBrowserEnvelope(retirementChannel),value=enrolled.envelope;
  const key=Buffer.from(value.publicKey,'base64');if(hash(key)!==enrolled.publicKeySha256||key.length!==44)fail();
  const frame=value.envelope;
  if(frame.format!=='sabalan-original-host-controller/v1'||frame.role!=='main'||frame.command!=='CHROME_READY'
    ||!Number.isSafeInteger(frame.sequence)||frame.sequence<1||!/^[a-f0-9]{64}$/.test(frame.session))fail();
  const preimage=Buffer.from([frame.format,frame.session,frame.role,String(frame.sequence),frame.command,frame.payload].join('\0'),'ascii');
  if(!verify(null,preimage,createPublicKey({key,type:'spki',format:'der'}),Buffer.from(frame.signature,'base64')))fail();
  const body=JSON.parse(Buffer.from(frame.payload,'base64')),url=new URL(body.browserWSEndpoint);
  if(url.protocol!=='ws:'||url.hostname!==body.host||!/^\/[a-f0-9]{64}\/devtools\/browser\/[a-f0-9-]{36}$/.test(url.pathname)
    ||body.browserOrigin!=='http://localhost:3199'||body.originalChromePid!==body.birth.pid)fail();
  const ingress=body.ingress;
  if(!ingress||ingress.originalIngressPid!==ingress.birth.pid||ingress.host!=='127.0.0.1'
    ||ingress.port!==3199||ingress.targetPort!==3199||ingress.targetHost===body.host)fail();
  const proxy=body.proxy;
  if(!proxy||proxy.originalProxyPid!==proxy.birth.pid||proxy.endpoint!==body.browserWSEndpoint
    ||!/^[a-f0-9]{64}$/.test(proxy.configSha256))fail();
  for(const fact of [body.birth,ingress.birth,proxy.birth])if(!Number.isSafeInteger(fact.pid)||fact.pid<2
    ||!/^\d+$/.test(fact.startTicks)||!/^pid:\[\d+\]$/.test(fact.pidNamespace))fail();
  const token=Object.freeze({});capabilities.set(token,freeze(body));return token;
}
export function readOriginalRemoteBrowserConnection(token){
  const facts=capabilities.get(token);if(!facts)fail();return facts;
}
