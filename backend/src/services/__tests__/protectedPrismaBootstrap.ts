import {spawn} from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import type {Result} from './protectedTemporaryDatabase';

/** Only invoked by the owned-test runner after identity verification. A timed
 * out child is retained until close; no signal or retry is issued. Output is
 * discarded after a bounded count and never logged because it may be private. */
export async function runProtectedPrismaBootstrap(directory:string,databaseUrl:string):Promise<Result<'SUCCESS'|'FAILURE'>>{
 const tempRoot=path.resolve(process.env.TEMP||process.env.TMP||'');const resolved=path.resolve(directory);
 if(!tempRoot||path.dirname(resolved)!==tempRoot||!/^sabalanerp-predecessor-bootstrap-[A-Za-z0-9]+$/.test(path.basename(resolved)))return {state:'UNKNOWN'};
 const schema=path.join(resolved,'schema.prisma');
 try{
  const root=path.resolve(__dirname,'../../../..');
  const requireLocal=createRequire(path.join(root,'backend/package.json'));
  const cli=requireLocal.resolve('prisma/build/index.js');
  const sha=(file:string)=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if(process.version!=='v22.13.0'||
   sha(process.execPath)!=='364dbc8442f8d5c04fd4226bcfcf8e60d3268627eb1d7be214a91bb7d74cdbb9'||
   sha(cli)!=='ff0102cdfadfecb884c5f0b6e43661f4ef2a31917dbfad3157236ba8e8532388')return {state:'UNKNOWN'};
  return await new Promise(resolve=>{
  let bytes=0,unknown=false;
  const environment:NodeJS.ProcessEnv={DATABASE_URL:databaseUrl,PATH:process.env.PATH,SYSTEMROOT:process.env.SYSTEMROOT,TEMP:process.env.TEMP,TMP:process.env.TMP,PRISMA_HIDE_UPDATE_MESSAGE:'1'};
  const child=spawn(process.execPath,[cli,'migrate','deploy','--schema',schema],{stdio:['ignore','pipe','pipe'],windowsHide:true,env:environment});
  const timer=setTimeout(()=>{unknown=true;},20*60*1000);
  const count=(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>8*1024*1024)unknown=true;};
  child.stdout.on('data',count);child.stderr.on('data',count);child.on('error',()=>{unknown=true;});
  child.on('close',(code,signal)=>{clearTimeout(timer);if(unknown||signal!==null||code===null)return resolve({state:'UNKNOWN'});
   resolve({state:'SUCCESS',value:code===0?'SUCCESS':'FAILURE'});});
  });
 }catch{return {state:'UNKNOWN'};}
}
