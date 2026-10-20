import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';import{randomBytes,createHash}from'node:crypto';
import{createCanonicalHostRecoveryCrypto}from'./lib/canonical-host-recovery-crypto.mjs';
const repository=path.resolve(import.meta.dirname,'..'),operation=randomBytes(16).toString('hex'),sha=raw=>createHash('sha256').update(raw).digest('hex');
const root=path.join('D:/sabalanerp-online-qa','host-crypto-remote-content-'+operation);fs.mkdirSync(root,{mode:0o700});
const canonical=await createCanonicalHostRecoveryCrypto({root});const files={};
for(const name of ['deploy/scripts/online-checkpoint-host-crypto.cjs','deploy/scripts/seal-online-checkpoint.cjs','scripts/postgres-recovery-coverage.mjs']){const raw=fs.readFileSync(path.join(repository,name));files[name]={base64:raw.toString('base64'),sha256:sha(raw)};}
const bundle=fs.readFileSync(canonical.provenance.bundleFile);files['deploy/scripts/online-release-host-crypto.cjs']={base64:bundle.toString('base64'),sha256:sha(bundle)};
const spec={operation,files,canonicalSourceSha256:canonical.provenance.sourceSha256};
const template=fs.readFileSync(path.join(repository,'deploy/scripts/host-checkpoint-crypto-content-remote.py'),'utf8');assert.equal(template.split('SPEC = None').length,2);const source=template.replace('SPEC = None','SPEC = '+JSON.stringify(spec));
const name='host-crypto-remote-content-'+operation,file=path.join('D:/sabalanerp-online-qa',name+'-remote.py');fs.writeFileSync(file,source,{flag:'wx',mode:0o600});canonical.revalidate();
process.stdout.write(JSON.stringify({file,sha256:sha(Buffer.from(source)),output:path.join(repository,'reports/qa',name+'.json'),actualExecuted:false})+'\n');
