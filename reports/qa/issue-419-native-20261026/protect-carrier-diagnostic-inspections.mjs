/** Preserve raw diagnostic evidence privately; publish only bounded nonsecret observations. */
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {prepareOriginalPrivateEvidenceDirectory,assertOriginalPrivateEvidenceDirectory} from '../../../scripts/lib/original-private-evidence-directory.mjs';
const directory=import.meta.dirname,privateDirectory=path.resolve('D:/sabalanerp-online-qa/carrier-repair-private-'+randomBytes(16).toString('hex'));
const custody=await prepareOriginalPrivateEvidenceDirectory(privateDirectory),sha=b=>createHash('sha256').update(b).digest('hex');
const receipts=[];
for(const name of fs.readdirSync(directory).filter(n=>/^CARRIER-REPAIR-BEHAVIOR-[a-f0-9]{32}\.json$/.test(n))){
  const file=path.join(directory,name),raw=fs.readFileSync(file),record=JSON.parse(raw);
  assert.ok(!record.privateRawEvidence);assertOriginalPrivateEvidenceDirectory(custody,privateDirectory);
  const preserved=path.join(privateDirectory,name);fs.writeFileSync(preserved,raw,{flag:'wx',mode:0o600});assert.equal(sha(fs.readFileSync(preserved)),sha(raw));
  record.privateRawEvidence={file:preserved,sha256:sha(raw),bytes:raw.length,reason:'Docker inspect includes actual environment; raw evidence retained under strict private ACL, never repository evidence.'};
  for(const child of record.children){
    if(child.executable==='docker'&&child.args[0]==='inspect'){
      child.privateInspectionStdoutSha256=sha(child.stdout);child.privateInspectionStdoutBytes=Buffer.byteLength(child.stdout);
      delete child.stdout;child.stdoutRedacted='PRIVATE_FULL_INSPECTION_RETAINED';
    }
  }
  fs.writeFileSync(file,JSON.stringify(record,null,2)+'\n');receipts.push({file:name,privateRaw:record.privateRawEvidence,sanitizedSha256:sha(fs.readFileSync(file))});
}
fs.writeFileSync(path.join(directory,'CARRIER-DIAGNOSTIC-PRIVACY.json'),JSON.stringify({format:'sabalan-419-private-diagnostic-custody/v1',productionAdmission:false,receipts},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({protectedRawReceipts:receipts.length,privateDirectory,rawEvidencePreserved:true}));
