import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';

const idPattern=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=()=>{throw new Error('Previous environment custody unavailable; recovery must remain closed.');};
const paths=(custody,operation)=>{
 if(!idPattern.test(operation))fail();
 const directory=fs.realpathSync(custody);
 const stat=fs.lstatSync(custody);
 if(!stat.isDirectory()||stat.isSymbolicLink()||(process.platform!=='win32'&&(stat.mode&0o077)!==0))fail();
 return {directory,snapshot:path.join(directory,`${operation}.previous-env`),metadata:path.join(directory,`${operation}.previous-env.json`)};
};
const checkedFile=file=>{
 const stat=fs.lstatSync(file);
 if(!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1||(process.platform!=='win32'&&(stat.mode&0o077)!==0))fail();
 return fs.readFileSync(file);
};
const writeExclusive=(file,bytes)=>{
 const fd=fs.openSync(file,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
};

// Call before changing the production env file. This host-only custody is not
// a release gate or checkpoint proof; callers must independently protect it.
export function preservePreviousEnvironment(custody,operation,environment){
 const {directory,snapshot,metadata}=paths(custody,operation);
 if(fs.existsSync(snapshot)||fs.existsSync(metadata))fail();
 const source=fs.realpathSync(environment);
 const bytes=checkedFile(environment);
 if(bytes.length===0)fail();
 writeExclusive(snapshot,bytes);
 const record={format:'sabalan-previous-environment-custody/v1',operation,source,sha256:digest(bytes),size:bytes.length};
 writeExclusive(metadata,Buffer.from(JSON.stringify(record)));
 if(process.platform!=='win32'){const fd=fs.openSync(directory,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
}

export function selectPreviousEnvironment(custody,operation){
 const {snapshot,metadata}=paths(custody,operation);
 const record=JSON.parse(checkedFile(metadata).toString('utf8'));
 if(record.format!=='sabalan-previous-environment-custody/v1'||record.operation!==operation||
   !path.isAbsolute(record.source)||!Number.isSafeInteger(record.size)||record.size<1||
   !/^[a-f0-9]{64}$/.test(record.sha256)||Object.keys(record).sort().join(',')!=='format,operation,sha256,size,source')fail();
 const bytes=checkedFile(snapshot);
 if(bytes.length!==record.size||digest(bytes)!==record.sha256)fail();
 return snapshot;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  const [command,custody,operation,environment]=process.argv.slice(2);
  if(command==='preserve'&&environment)preservePreviousEnvironment(custody,operation,environment);
  else if(command==='select'&&!environment)process.stdout.write(selectPreviousEnvironment(custody,operation)+'\n');
  else fail();
 }catch{
  console.error('Previous environment custody unavailable; recovery must remain closed.');
  process.exitCode=1;
 }
}
