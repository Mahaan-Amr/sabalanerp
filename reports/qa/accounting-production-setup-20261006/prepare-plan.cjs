const fs = require('node:fs');
const crypto = require('node:crypto');
const readline = require('node:readline');
const directory = 'C:/Users/mahan/Downloads/Sepidar-analysis-private';
const sha = value => crypto.createHash('sha256').update(value).digest('hex');
const expectedHash = '53cce4d9a9cf8f561307fd6e5cac8a8191dc6486b934480bfcc15a97f9004325';
const proposalBytes = fs.readFileSync(`${directory}/sepidar-mapping-proposal-v1.json`);
if (sha(proposalBytes) !== expectedHash) throw Error('Source mapping checksum changed');
const proposal = JSON.parse(proposalBytes);
const roles = {receivable:'111201', revenue:'411001', outputTax:'211112', inventory:'111401', cost:'510101', bankClearing:'111005', customerAdvance:'211201'};
const codes = new Set(Object.values(roles));
for (const code of [...codes]) { let row=proposal.accounts.find(a=>a.proposedTargetCode===code); if(!row)throw Error(`Missing ${code}`); while(row.parentCode){ codes.add(row.parentCode);row=proposal.accounts.find(a=>a.proposedTargetCode===row.parentCode);if(!row)throw Error('Missing parent'); } }
const accounts = proposal.accounts.filter(a=>codes.has(a.proposedTargetCode));
(async()=>{
  const sourceAccounts = new Map();
  for await (const line of readline.createInterface({input:fs.createReadStream(`${directory}/source-records.jsonl`)})) {
    const row=JSON.parse(line); if(row.table==='ACC.Account')sourceAccounts.set(String(row.key), row.payload);
  }
  for(const account of accounts){if(sha(JSON.stringify(sourceAccounts.get(account.sourceId)))!==account.sourceHash)throw Error(`Source account hash mismatch: ${account.sourceId}`);}
  const plan={schemaVersion:1,legalEntityId:'cmutt56450711ynty5tto4r61',bookId:'cmutt56460712yntysnwk3sl1',codeSchemeId:'cmutt56460713yntyxifw7m4i',actorId:'cmlyasz6u0009o2si3kfbt524',effectiveFrom:'2026-03-21T00:00:00.000Z',sourceProposalHash:expectedHash,sourcePackageHash:proposal.sourcePackageHash,sourceSnapshotId:proposal.snapshotId,roles,accounts:accounts.map(a=>({code:a.proposedTargetCode,titlePersian:a.titlePersian,level:a.level,parentCode:a.parentCode,statementRole:a.proposedStatementRole,normalSide:['LIABILITY','EQUITY','REVENUE'].includes(a.proposedStatementRole)?'CREDIT':'DEBIT',partyRequirement:[roles.receivable,roles.customerAdvance].includes(a.proposedTargetCode)?'REQUIRED':'FORBIDDEN',financialAccountRequirement:a.proposedTargetCode===roles.bankClearing?'REQUIRED':'FORBIDDEN',sourceId:a.sourceId,sourceHash:a.sourceHash}))};
  const output = `${__dirname}/setup-plan.json`;
  fs.writeFileSync(output,JSON.stringify(plan,null,2));
  console.log(JSON.stringify({accounts:plan.accounts.length,roles,planHash:sha(fs.readFileSync(output)),sourceHashesVerified:true}));
})().catch(e=>{console.error(e.message);process.exitCode=1});
