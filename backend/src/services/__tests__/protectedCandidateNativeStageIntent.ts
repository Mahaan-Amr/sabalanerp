import fs from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';

const digest=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
export function prepareNativeStageIntent(directory:string,targetCluster:string):{operationId:string;databaseName:string;sha256:string} {
 if(!/^\d+$/.test(targetCluster))throw Error('INTENT_CLUSTER_UNKNOWN');
 const operationId=randomUUID().replace(/-/g,''),databaseName=`sabalanerp_protected_${randomUUID().replace(/-/g,'')}`;
 const bytes=Buffer.from(JSON.stringify({format:'sabalan-native-stage-intent/v2',operationId,databaseName,targetCluster,productionAdmission:false})+'\n');
 const filename=path.join(directory,'native-stage-intent.json'),fd=fs.openSync(filename,'wx',0o600);
 try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 if(!fs.readFileSync(filename).equals(bytes))throw Error('INTENT_READBACK_UNKNOWN');
 return {operationId,databaseName,sha256:digest(bytes)};
}
/** Only the exact reviewed intent is accepted; the attempt is consumed first. */
export function consumeNativeStageIntent(directory:string,operationId:string,expectedSha256:string,targetCluster:string):string {
 if(!/^[a-f0-9]{32}$/.test(operationId)||!/^[a-f0-9]{64}$/.test(expectedSha256)||!/^\d+$/.test(targetCluster))throw Error('INTENT_UNKNOWN');
 const filename=path.join(directory,'native-stage-intent.json'),stat=fs.lstatSync(filename);
 if(!stat.isFile()||stat.isSymbolicLink())throw Error('INTENT_UNKNOWN');
 const bytes=fs.readFileSync(filename);if(digest(bytes)!==expectedSha256)throw Error('INTENT_UNKNOWN');
 const value=JSON.parse(bytes.toString('utf8'));
 if(value.format!=='sabalan-native-stage-intent/v2'||value.operationId!==operationId||!/^sabalanerp_protected_[a-f0-9]{32}$/.test(value.databaseName)||value.targetCluster!==targetCluster||value.productionAdmission!==false)throw Error('INTENT_UNKNOWN');
 const fd=fs.openSync(path.join(directory,'native-stage-attempt.json'),'wx',0o600);
 try{fs.writeFileSync(fd,JSON.stringify({format:'sabalan-native-stage-attempt/v1',operationId,intentSha256:expectedSha256,state:'UNKNOWN',productionAdmission:false})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 return value.databaseName;
}
