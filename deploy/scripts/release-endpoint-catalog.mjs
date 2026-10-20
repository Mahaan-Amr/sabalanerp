/** Append-only transport locations; this module grants no release admission.
 * Only the original controller's signed edge channel receives the writer. */
const catalogs=new WeakMap();
const canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])));
function fail(){throw Error('RELEASE_ENDPOINT_CATALOG_UNPROVEN');}
export function assertReleaseEndpointCatalog(token){if(!catalogs.has(token))fail();}
export function readReleaseEndpoint(token,kind,slotId){const state=catalogs.get(token);if(!state||!['ui','backend'].includes(kind))fail();return state[kind].get(slotId);}
export function createReleaseEndpointCatalog(){
 const token=Object.freeze({}),state={ui:new Map(),backend:new Map()};catalogs.set(token,state);
 function append({ui=[],backend=[]}){
  const pending=[];
  for(const [kind,entries] of [['ui',ui],['backend',backend]]){
   if(!Array.isArray(entries)||entries.length>1024)fail();
   for(const input of entries){
    const expected=kind==='backend'?['slotId','host','port','image','manifestSha256']:['slotId','host','port','image'];
    if(!input||Object.keys(input).sort().join(',')!==expected.sort().join(',')
      ||!/^[a-z][a-z0-9_-]{7,95}$/.test(input.slotId)
      ||!(kind==='backend'?/^backend(?:-[a-z0-9]+)*$/:/^(frontend|inquiry)(?:-[a-z0-9]+)*$/).test(input.host)
      ||!Number.isInteger(input.port)||input.port<1024||input.port>65535
      ||!/^sha256:[a-f0-9]{64}$/.test(input.image)
      ||(kind==='backend'&&!/^[a-f0-9]{64}$/.test(input.manifestSha256)))fail();
    const old=state[kind].get(input.slotId),queued=pending.find(value=>value.kind===kind&&value.input.slotId===input.slotId)?.input;
    if((old&&canonical(old)!==canonical(input))||(queued&&canonical(queued)!==canonical(input)))fail();
    pending.push({kind,input:Object.freeze({...input})});
   }
   if(new Set([...state[kind].keys(),...entries.map(value=>value.slotId)]).size>1024)fail();
  }
  for(const {kind,input} of pending)state[kind].set(input.slotId,input);
 }
 return Object.freeze({catalog:token,append});
}
