import {isIP} from 'node:net';
const trusts=new WeakMap();
const normalized=value=>String(value??'').replace(/^::ffff:/,'');
export function createOriginalIngressTrust(){
 const token=Object.freeze({}),addresses=new Set();trusts.set(token,addresses);
 return Object.freeze({trust:token,append(values){
  if(!Array.isArray(values)||values.length>64||values.some(value=>!isIP(value)))throw Error('EDGE_ORIGINAL_INGRESS_INVALID');
  for(const value of values)addresses.add(normalized(value));
 }});
}
export function originalForwardedHeaders(request,token){
 const remote=normalized(request.socket.remoteAddress),fallback={'x-forwarded-for':remote,'x-forwarded-proto':'http'};
 if(!token)return fallback;const addresses=trusts.get(token);if(!addresses)throw Error('EDGE_ORIGINAL_INGRESS_UNPROVEN');
 if(!addresses.has(remote))return fallback;
 const proto=request.headers['x-forwarded-proto'],forward=request.headers['x-forwarded-for'];
 if(!['http','https'].includes(proto)||typeof forward!=='string'||forward.length>1024
   ||forward.split(',').some(value=>!isIP(value.trim())))throw Error('EDGE_ORIGINAL_FORWARDED_HEADERS_INVALID');
 return {'x-forwarded-proto':proto,'x-forwarded-for':forward};
}
