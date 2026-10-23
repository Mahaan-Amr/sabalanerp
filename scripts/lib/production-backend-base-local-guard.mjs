import {assertLocalDevSuspensionCurrent,assertLocalDevCensus} from './local-dev-frontend-suspension.mjs';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';

export const backendBaseProtectedServices=Object.freeze(['backend','frontend','postgres','inquiry','redis','clamav','backend-candidate','backend-retained','frontend-candidate','frontend-retained']);
const services=backendBaseProtectedServices;
const compose=['compose','-f','D:/sabalanerp/docker-compose.local.yml'];
const rows=text=>{try{const value=JSON.parse(text);return Array.isArray(value)?value:[value];}
  catch{return text.trim().split(/\r?\n/).map(line=>JSON.parse(line));}};

export function backendBaseLocalGuards(commands,{localDevSuspension}={}){
  async function status(){
    const scope=assertLocalDevSuspensionCurrent(localDevSuspension);const result=await commands.run('docker',[...compose,'ps','--all','--no-trunc','--format','json']);commands.assertSuccessful(result);
    const actual=assertBackendBaseProtectedStatus(result.stdout,scope);
    return actual;
  }
  async function docker(args){await status();const result=await commands.run('docker',args);commands.assertSuccessful(result);return result.stdout;}
  async function protectedIdentities(){
    const names=(await status()).map(row=>row.ID??row.Name);
    const inspected=JSON.parse(await docker(['inspect',...names]));assert.equal(inspected.length,services.length);
    const result={};
    for(const row of inspected){const labels=row.Config?.Labels;assert.equal(labels?.['com.docker.compose.project'],'sabalanerp-local');
      const service=labels['com.docker.compose.service'];assert.ok(services.includes(service)&&!result[service]);
      if(service!=='frontend'||!localDevSuspension){assert.equal(row.State.Running,true);assert.equal(row.State.Health.Status,'healthy');}else assert.equal(row.State.Running,false);
      result[service]={id:row.Id,image:row.Image,startedAt:row.State.StartedAt};}
    return result;
  }
  async function aliases(){const result={};
    for(const row of rows(await docker(['image','ls','--no-trunc','--format','{{json .}}']))){
      if(row.Repository==='<none>'||row.Tag==='<none>')continue;
      const name=row.Repository+':'+row.Tag;assert.ok(!result[name]||result[name]===row.ID);result[name]=row.ID;
    }
    return Object.fromEntries(Object.entries(result).sort(([a],[b])=>a.localeCompare(b)));
  }
  return Object.freeze({status,docker,protectedIdentities,aliases});
}

export function assertBackendBaseProtectedStatus(stdout,localDevSuspension=null){
  const actual=rows(stdout);assert.equal(actual.length,services.length);
  assertLocalDevCensus(actual,localDevSuspension);
  return actual;
}

export function backendBaseLocalCapacity(source){
  const observed={};
  for(const [volume,required]of [['C:/',source.rawBytes*3+512*1024**2],['D:/',source.rawBytes+512*1024**2]]){
    const space=fs.statfsSync(volume,{bigint:true}),available=space.bavail*space.bsize;
    assert.ok(available>=BigInt(required),'LOCAL_BASE_CAPACITY_REFUSED_'+volume);
    observed[volume]={availableBytes:String(available),requiredBytes:required};
  }
  const availableMemory=os.freemem();assert.ok(availableMemory>=512*1024**2,'LOCAL_BASE_MEMORY_REFUSED');
  return {volumes:observed,availableMemoryBytes:availableMemory,requiredMemoryBytes:512*1024**2};
}

/** Read metadata only after the complete OCI graph/bytes have been verified.
 * Refuse an archive that would install mutable tag aliases before docker load. */
export function assertBackendArchiveHasNoAliases(file){
  const descriptor=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),header=Buffer.alloc(512);
  try{
    const length=Number(fs.fstatSync(descriptor,{bigint:true}).size),found={};
    const text=bytes=>bytes.toString('utf8').split('\0')[0];
    for(let offset=0,count=0;offset+512<=length;){
      assert.ok(++count<250000);assert.equal(fs.readSync(descriptor,header,0,512,offset),512);if(header.every(value=>value===0))break;
      const prefix=text(header.subarray(345,500)),name=(prefix?prefix+'/':'')+text(header.subarray(0,100));
      const sizeText=text(header.subarray(124,136)).trim();assert.match(sizeText,/^[0-7]+$/);const size=parseInt(sizeText,8);
      assert.ok(Number.isSafeInteger(size)&&offset+512+size<=length);
      if(name==='manifest.json'||name==='index.json'){
        assert.ok(size>0&&size<=1024**2&&!found[name]);const buffer=Buffer.alloc(size);
        assert.equal(fs.readSync(descriptor,buffer,0,size,offset+512),size);found[name]=JSON.parse(buffer.toString('utf8'));
      }
      offset+=512+Math.ceil(size/512)*512;
    }
    assert.equal(found['manifest.json']?.length,1);
    const tags=found['manifest.json'][0].RepoTags;assert.ok(tags===null||tags===undefined||(Array.isArray(tags)&&tags.length===0),'BACKEND_ARCHIVE_MUTABLE_TAGS_REFUSED');
    assert.equal(found['index.json']?.schemaVersion,2);
    for(const item of [found['index.json'],...found['index.json'].manifests])
      for(const name of ['org.opencontainers.image.ref.name','io.containerd.image.name'])assert.ok(!item.annotations?.[name],'BACKEND_ARCHIVE_IMPORT_ALIAS_REFUSED');
    return {manifestTagsAbsent:true,ociImportAliasesAbsent:true};
  }finally{fs.closeSync(descriptor);}
}
