import assert from 'node:assert/strict';
/** Docker's unset DNS lists serialize as either null or []. No configured
 * entry, other HostConfig field, mount, network or service value is omitted. */
export function containerSemantic(container,{normalizeUnsetDns=true}={}){
 const c=container.Config,host=structuredClone(container.HostConfig);
 if(normalizeUnsetDns)for(const key of ['Dns','DnsOptions','DnsSearch']){
  assert.ok(host[key]==null||Array.isArray(host[key]),'UNREVIEWED_DNS_CONFIGURATION');
  if(host[key]==null)host[key]=[];
 }
 return {image:container.Image,config:{User:c.User,Env:[...c.Env].sort(),Cmd:c.Cmd,Entrypoint:c.Entrypoint,WorkingDir:c.WorkingDir,
  StopSignal:c.StopSignal,Healthcheck:c.Healthcheck,ExposedPorts:c.ExposedPorts,Volumes:c.Volumes},host,
  mounts:container.Mounts,networks:Object.fromEntries(Object.entries(container.NetworkSettings.Networks).map(([n,v])=>[n,{NetworkID:v.NetworkID,Aliases:v.Aliases,IPAMConfig:v.IPAMConfig}]))};
}
