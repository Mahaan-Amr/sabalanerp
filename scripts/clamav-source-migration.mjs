import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
export const mirrorOrigin='https://mirrors.fe.up.pt/pub/clamav';
const originalOrigin='https://database.clamav.net';
const stateNames=['freshclam.dat','.sabalan-updater-state','.sabalan-freshclam-result'];
const sha256=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const readRegular=async file=>{
 const stat=await fs.lstat(file);
 if(!stat.isFile()||stat.isSymbolicLink())throw new Error('Source migration accepts regular files only');
 return {bytes:await fs.readFile(file),stat};
};

export function validateSourceMigration(value) {
 if(value?.kind!=='CLAMAV_ACQUISITION_SOURCE_MIGRATION_V1'||value.originalOrigin!==originalOrigin||value.targetOrigin!==mirrorOrigin
  ||value.intervalSeconds!==7200||!Number.isSafeInteger(value.lastActualAttempt)||value.lastActualAttempt<=0
  ||value.firstEligibleAttempt!==value.lastActualAttempt+7200
  ||!Number.isSafeInteger(value.vendorCooldownUntil)||value.vendorCooldownUntil<value.firstEligibleAttempt
  ||Object.keys(value.originalStateFiles||{}).length!==stateNames.length
  ||stateNames.some(name=>!/^[a-f0-9]{64}$/.test(value.originalStateFiles[name]?.sha256||''))
  ||value.cdnFallback!==false)throw new Error('Invalid explicit acquisition-source migration evidence');
 return value;
}

export async function verifySourceMigration(bank) {
 const manifest=validateSourceMigration(JSON.parse((await readRegular(path.join(bank,'.source-state','migration.json'))).bytes));
 for(const name of stateNames){
  const original=await readRegular(path.join(bank,'.source-state','vendor-cdn',name));
  if(sha256(original.bytes)!==manifest.originalStateFiles[name].sha256)throw new Error('Archived vendor cooldown or scheduler bytes changed');
 }
 return manifest;
}

export async function prepareSourceMigration(source,verifiedBank,output) {
 // A new inactive bank is created exclusively. Recreate/retry never overwrites
 // a prior mirror identity, its schedule or an archived CDN refusal.
 const sourcePath=await fs.realpath(source),verifiedPath=await fs.realpath(verifiedBank);
 const destination=path.resolve(output);
 if(destination===sourcePath||destination.startsWith(sourcePath+path.sep)||destination===verifiedPath||destination.startsWith(verifiedPath+path.sep))throw new Error('Target bank must be separate from original state and verified downloads');
 const originals={};
 for(const name of stateNames)originals[name]=await readRegular(path.join(sourcePath,name));
 const fields=originals['.sabalan-updater-state'].bytes.toString().trim().split(/\s+/).map(Number);
 if(fields.length!==4||fields.some(value=>!Number.isSafeInteger(value)||value<0)||fields[0]<=0||fields[2]===0)throw new Error('Expected the actual failed CDN acquisition schedule');
 const [lastActualAttempt,,,vendorCooldownUntil]=fields;
 const manifest=validateSourceMigration({kind:'CLAMAV_ACQUISITION_SOURCE_MIGRATION_V1',originalOrigin,targetOrigin:mirrorOrigin,
  intervalSeconds:7200,lastActualAttempt,firstEligibleAttempt:lastActualAttempt+7200,vendorCooldownUntil,cdnFallback:false,
  originalStateFiles:Object.fromEntries(stateNames.map(name=>[name,{sha256:sha256(originals[name].bytes),mode:originals[name].stat.mode&0o777,uid:originals[name].stat.uid,gid:originals[name].stat.gid}]))});
 // Validate every source before creating anything at the destination.
 const databases={};for(const family of ['main','daily','bytecode'])databases[family]=await readRegular(path.join(verifiedPath,family+'.cvd'));
 await fs.mkdir(destination,{mode:0o700});
 const archive=path.join(destination,'.source-state','vendor-cdn');await fs.mkdir(archive,{recursive:true,mode:0o700});
 for(const name of stateNames)await fs.writeFile(path.join(archive,name),originals[name].bytes,{mode:0o400,flag:'wx'});
 await fs.writeFile(path.join(destination,'.source-state','migration.json'),JSON.stringify(manifest,null,2)+'\n',{mode:0o400,flag:'wx'});
 for(const [family,{bytes}]of Object.entries(databases))await fs.writeFile(path.join(destination,family+'.cvd'),bytes,{mode:0o644,flag:'wx'});
 await fs.writeFile(path.join(destination,'.sabalan-updater-state'),`${lastActualAttempt} 0 1 ${manifest.firstEligibleAttempt}\n`,{mode:0o600,flag:'wx'});
 await verifySourceMigration(destination);
 return manifest;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [command,...args]=process.argv.slice(2);
  const result=command==='prepare'?await prepareSourceMigration(...args):command==='verify'?await verifySourceMigration(args[0]):null;
  if(!result)throw new Error('Use prepare <inactive-CDN-bank> <verified-CVD-directory> <new-inactive-bank> or verify <bank>');
  console.log(JSON.stringify(result,null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
