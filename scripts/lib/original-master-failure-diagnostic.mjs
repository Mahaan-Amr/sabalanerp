import {createHash} from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const names=new Set(['Error','AssertionError','TypeError','RangeError','SyntaxError','ReferenceError','AggregateError']);
const codes=new Set(['ERR_ASSERTION','MODULE_NOT_FOUND','ERR_MODULE_NOT_FOUND','ENOENT','EACCES','EPERM','EINVAL','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE','ERR_OUT_OF_RANGE']);
const root=path.resolve(import.meta.dirname,'../..');
/** Locations only: exception text, values, absolute private paths and raw stacks never escape. */
export function describeOriginalMasterFailure(error){
 const message=typeof error?.message==='string'?error.message:'';
 const result={name:names.has(error?.name)?error.name:'Error',code:codes.has(error?.code)?error.code:'UNKNOWN',
  messageSha256:createHash('sha256').update(message).digest('hex'),frames:[]};
 for(const line of (typeof error?.stack==='string'?error.stack:'').split(/\r?\n/).slice(1,33)){
  if(result.frames.length===8)break;
  if(!/^\s+at /.test(line))continue;
  const match=/(?:\(|\s)((?:file:\/\/\/|[A-Za-z]:[\\/]|\/)[^()\r\n]+):(\d{1,8}):(\d{1,8})\)?$/.exec(line);
  if(!match)continue;
  let file;try{file=match[1].startsWith('file:')?fileURLToPath(match[1]):match[1];}catch{continue;}
  const relative=path.relative(root,path.resolve(file)).split(path.sep).join('/');
  if(!/^(?:scripts|deploy\/scripts|backend\/src|tests\/online-deployment)\/[A-Za-z0-9_./-]+\.(?:mjs|cjs|js|ts|py)$/.test(relative)||relative.split('/').includes('..'))continue;
  try{const stat=fs.lstatSync(path.join(root,relative));if(!stat.isFile()||stat.isSymbolicLink())continue;}catch{continue;}
  const lineNumber=Number(match[2]),column=Number(match[3]);if(!lineNumber||!column)continue;
  result.frames.push({file:relative,line:lineNumber,column});
 }
 return result;
}
export function writeOriginalMasterFailureDiagnostic(error,sequence,output=process.stderr){
 try{output.write(JSON.stringify({format:'sabalan-original-master-error-location/v1',sequence,...describeOriginalMasterFailure(error)})+'\n');}catch{/* Reporting cannot release or replace the original held owner. */}
}
