import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import type {SyntheticOwner} from './protectedCandidateSyntheticOwner';

/** Constructs private fixture bytes only. No process, Docker, database or file
 * mutation occurs here. Manifest must be independently produced from the
 * reviewed compiled output and migration source of this exact checkout. */
export function candidateProvisionPayload(checkout:string,root:string,databaseName:string,owner:SyntheticOwner,manifest:Readonly<Record<string,string>>):string{
 if(!/^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/.test(root)||
  !/^sabalanerp_protected_[a-f0-9]{32}$/.test(databaseName))throw Error('SYNTHETIC_FIXTURE_IDENTITY_UNPROVEN');
 const base=fs.realpathSync(checkout),files:Record<string,string>={};
 const entries=Object.entries(manifest);
 if(entries.length<3||entries.length>8192)throw Error('SYNTHETIC_FIXTURE_MANIFEST_UNPROVEN');
 for(const [name,expected] of entries){
  if(!/^(?:dist|prisma|scripts|fixture)\/[A-Za-z0-9_./-]+$/.test(name)||name.split('/').some(p=>p==='.'||p==='..')||!/^[a-f0-9]{64}$/.test(expected))throw Error('SYNTHETIC_FIXTURE_PATH_UNPROVEN');
  if(name.startsWith('fixture/')&&!['fixture/cli-worker.cjs','fixture/native-stage-sequence.cjs'].includes(name))throw Error('SYNTHETIC_FIXTURE_PATH_UNPROVEN');
  const source=name==='fixture/cli-worker.cjs'?path.join(base,'tests/online-deployment/protected-candidate-cli.worker.cjs'):name==='fixture/native-stage-sequence.cjs'?path.join(base,'tests/online-deployment/protected-native-stage-sequence.cjs'):name.startsWith('dist/')?path.join(base,'backend',name):name.startsWith('prisma/')?path.join(base,'backend',name):path.join(base,'deploy',name);
  const real=fs.realpathSync(source);
  if(!real.startsWith(base+path.sep)||!fs.statSync(real).isFile())throw Error('SYNTHETIC_FIXTURE_SOURCE_UNPROVEN');
  const bytes=fs.readFileSync(real);
  if(bytes.length>16*1024*1024||createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('SYNTHETIC_FIXTURE_SOURCE_UNPROVEN');
  files[name==='fixture/cli-worker.cjs'?'cli-worker.cjs':name==='fixture/native-stage-sequence.cjs'?'native-stage-sequence.cjs':name]=bytes.toString('base64');
 }
 if(!files['dist/scripts/deployment-owned-migrations.js']||!files['prisma/schema.prisma']||!files['cli-worker.cjs'])throw Error('SYNTHETIC_FIXTURE_MANIFEST_UNPROVEN');
 return JSON.stringify({root,files,configuration:{root,databaseName,owner:{deploymentId:owner.deploymentId,releaseId:owner.releaseId,leaseToken:owner.leaseToken}},checkpoint:owner.checkpoint});
}

/** Fixed code intended for docker exec -i node -e. A fresh exact root is
 * created exclusively. A partial failure is preserved for inspection. */
export const candidateProvisionScript=String.raw`
const fs=require('fs'),path=require('path'),input=JSON.parse(fs.readFileSync(0,'utf8'));
const root=input.root;
if(!/^\/app\/online-runtime-acceptance\/protected-bridge-[a-f0-9]{32}$/.test(root))throw Error('BAD_ROOT');
fs.mkdirSync(root,{mode:0o700});fs.mkdirSync(path.join(root,'coordination'),{mode:0o700});
for(const [name,bytes] of Object.entries(input.files)){
 if(!name.split('/').every(p=>/^[a-zA-Z0-9_.-]+$/.test(p)&&p!=='.'&&p!=='..'))throw Error('BAD_PATH');
 fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true,mode:0o700});
 fs.writeFileSync(path.join(root,name),Buffer.from(bytes,'base64'),{flag:'wx',mode:0o400});
}
fs.writeFileSync(path.join(root,'configuration.json'),JSON.stringify(input.configuration),{flag:'wx',mode:0o400});
fs.writeFileSync(path.join(root,'coordination/deployment-maintenance.json'),JSON.stringify(input.configuration.owner),{flag:'wx',mode:0o600});
fs.writeFileSync(path.join(root,'coordination/deployment-checkpoint.json'),JSON.stringify(input.checkpoint),{flag:'wx',mode:0o600});
`;
