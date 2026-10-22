import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const a29KnownNegativeRetirement=Object.freeze({
  "format": "sabalan-a29-known-negative-retirement/v1",
  "operationRoot": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4",
  "indexSha256": "07cd839e9ca807c2c34e23380d1c701cd280240f768710a2859d3334941228be",
  "records": [
    {
      "runtimeId": "4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc",
      "nativeFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/native/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc/deployment-runtime-native.json",
      "workFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/work/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc/state.json",
      "claimFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/work/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc/claim.json",
      "nativeSha256": "1926f67c7dd92babb028d99541008496f32e9695809b99c4879f558449b33a2b",
      "workSha256": "bd6e2e70979cdae5102eb38bf895cb59d872d2a07c3fc69f152b4fad0832553d",
      "claimSha256": "88e85011fcde246c874d45453405c227471c245cc34761bf18659b6a74cac423",
      "guardian": {
        "bootId": "9bd69626-b779-430a-a212-846ab54f8ce0",
        "pid": 1735,
        "pidNamespace": "pid:[4026532608]",
        "startTicks": "2414952"
      }
    },
    {
      "runtimeId": "e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5",
      "nativeFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/native/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5/deployment-runtime-native.json",
      "workFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/work/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5/state.json",
      "claimFile": "/app/online-runtime-acceptance/application-native-a29ec8246742c597d98d43686df535b4/coordination/online/work/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5/claim.json",
      "nativeSha256": "6bc9343db5c2ba955efc82f36ae5c8fb62953c49bf7f64d0bb204c281cef0ced",
      "workSha256": "6d4f6dd6fdf857dad811e07dba25700b85cd3e4a54f4c0e75f51bb45d57e6970",
      "claimSha256": "66acaeab10173f1b55888e3295e81aad4e5feb3af2f86c64b07bb0bbef349bed",
      "guardian": {
        "bootId": "9bd69626-b779-430a-a212-846ab54f8ce0",
        "pid": 2012,
        "pidNamespace": "pid:[4026532608]",
        "startTicks": "2417945"
      }
    }
  ],
  "successfulNativeClosure": false,
  "nativeReapedClaimed": false,
  "productionAdmission": false,
  "evidenceSha256": {
    "negativeStop": "e6c8cc1634cc5e2a2394a891029b7a9f66cb363df7f453fb2646f84453fa47a0",
    "negativeHost": "2a241d2e0e14d5c126f6412ffe1dd15cea10f86fe9708a5c4d50206bcb87e4a7",
    "originalClosed": "acb62b7622c5406f88102beb921db2b332a42ec344f74e2035cb59f6324642de"
  }
});
export function validateA29NegativeRetirementEvidence({negativeStop,negativeHost,originalClosed,index,records}){
 const c=a29KnownNegativeRetirement,e=c.evidenceSha256;
 for(const[name,bytes]of Object.entries({negativeStop,negativeHost,originalClosed}))assert.equal(sha(bytes),e[name],'A29_NEGATIVE_EVIDENCE_BYTES_CHANGED');
 assert.equal(sha(index),c.indexSha256);assert.equal(records.length,2);
 const stop=JSON.parse(negativeStop),host=JSON.parse(negativeHost),closed=JSON.parse(originalClosed);
 assert.equal(stop.pass,true);assert.deepEqual(stop.stopped,['backend-candidate','backend-retained']);assert.equal(stop.qualificationSucceeded,false);assert.equal(stop.dataRemoved,false);assert.equal(stop.volumesRemoved,false);
 assert.equal(host.pass,true);assert.equal(host.qualificationSucceeded,false);assert.equal(host.originalParentReapingClaimed,false);assert.deepEqual(host.negativeControls.map(v=>v.pid),[20180,42740]);
 for(const row of host.negativeControls){assert.equal(row.handleDeathObserved,true);assert.equal(row.negativeExitCode,3758096385);}
 assert.equal(closed.originalPid,42740);assert.equal(closed.code,3758096385);assert.equal(closed.pipesClosed,true);assert.deepEqual(closed.readerErrors,[]);assert.equal(closed.commandsSent,3);
 for(const row of Object.values(closed.logs)){assert.equal(row.closed,true);assert.equal(row.truncated,false);}
 for(let i=0;i<2;i++){
  const wanted=c.records[i],raw=records[i];for(const[k,key]of [['native','nativeSha256'],['work','workSha256'],['claim','claimSha256']])assert.equal(sha(raw[k]),wanted[key]);
  const n=JSON.parse(raw.native),w=JSON.parse(raw.work),claim=JSON.parse(raw.claim);assert.equal(n.phase,'ACTIVE');assert.equal(n.nativeReaped,undefined);assert.deepEqual(n.guardian,wanted.guardian);assert.equal(w.phase,'QUIESCENT');assert.equal(claim.native.claimSha256,wanted.nativeSha256);
  assert.equal(n.onlineScope.scope.nativeDirectory+'/deployment-runtime-native.json',wanted.nativeFile);assert.equal(n.onlineScope.scope.boundaryDirectory+'/state.json',wanted.workFile);assert.equal(n.onlineScope.scope.runtimeId,wanted.runtimeId);
 }
 return structuredClone(c);
}
export function validateA29RetirementCertificate(value,evidence){
 const expected=validateA29NegativeRetirementEvidence(evidence),{creation,...base}=value;assert.deepEqual(base,expected);assert.ok(creation&&Number.isFinite(creation.observedUnix)&&creation.observedUnix>0);validateA29StoppedCreationObservation(creation);return value;
}
export function validateA29StoppedCreationObservation({slots,sql}){
 const expected={'backend-candidate':'526afe1599f1aad65ecd7233ceb8ca962ab90112d9e57292211fae0cecf38995','backend-retained':'de3b31e3a2c99052f4af5173e4e33e0f7f24354ab2febad533090b884b6deacd'};
 assert.deepEqual(Object.keys(slots).sort(),Object.keys(expected).sort());for(const[role,id]of Object.entries(expected)){assert.equal(slots[role].id,id);assert.equal(slots[role].running,false);assert.equal(slots[role].pid,0);}
 const expectedBirths={"backend-candidate": {"id": "526afe1599f1aad65ecd7233ceb8ca962ab90112d9e57292211fae0cecf38995", "image": "sha256:bc2f028d43f64175258d65ab777e062d9491897687f566efdfdb02c7acd1d1a7", "startedAt": "2026-10-22T12:12:19.318298116Z"}, "backend-retained": {"id": "de3b31e3a2c99052f4af5173e4e33e0f7f24354ab2febad533090b884b6deacd", "image": "sha256:89dd62e901f2077f70c800bd9b705251730fa23531f7c3cc42fdaee1d9c71186", "startedAt": "2026-10-22T12:12:19.072738104Z"}};for(const[role,wanted]of Object.entries(expectedBirths))for(const key of ['id','image','startedAt'])assert.equal(slots[role][key],wanted[key]);
 assert.equal(String(sql.systemIdentifier),'7667464637415309346');assert.equal(sql.visible,true);
 assert.equal(String(sql.databaseOid),'22660403');assert.equal(sql.sessions,0);assert.equal(sql.prepared,0);return true;
}

export const a29EvidenceFiles=Object.freeze(["D:/sabalanerp-online-qa/two-qa-negative-stop-33f66c77d68e4cb7b4b2abbf1aa10a78/result.json", "D:/sabalanerp-online-qa/original42740-negative-windows-f18d4e68756747fc9341a46ca2b5e957/result.json", "D:/sabalanerp-online-qa/original-master-preparation-494ecad9-repl20261022/original-evidence/original-closed.json", "D:/sabalanerp-online-qa/a29-original-negative-index-20261022.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc-deployment-runtime-native.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc-state.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/4277379effcec10061f63a611425206df5b398ac791abe03f9e19ffb20ff89dc-claim.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5-deployment-runtime-native.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5-state.json", "D:/sabalanerp-online-qa/a29-negative-raw-scopes-20261022/e3edb9046fb3b2485001ef00919c0a41fe8990d3e9aca99cd7a2cdb552350fa5-claim.json"]);
export function loadA29Evidence(){
 const read=file=>{assert.equal(fs.realpathSync(file),path.resolve(file));const a=fs.lstatSync(file,{bigint:true});assert.ok(a.isFile()&&!a.isSymbolicLink()&&a.nlink===1n);const raw=fs.readFileSync(file),b=fs.lstatSync(file,{bigint:true});for(const key of ['dev','ino','size','mtimeNs','ctimeNs','nlink'])assert.equal(a[key],b[key]);return raw;};
 const [negativeStop,negativeHost,originalClosed,index,...raw]=a29EvidenceFiles.map(read);return{negativeStop,negativeHost,originalClosed,index,records:[{native:raw[0],work:raw[1],claim:raw[2]},{native:raw[3],work:raw[4],claim:raw[5]}]};
}
