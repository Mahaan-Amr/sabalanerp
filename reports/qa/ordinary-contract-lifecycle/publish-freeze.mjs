import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:20_000_000});
const base=git('rev-parse','origin/main').trim();
const head=git('rev-parse','HEAD').trim();
const patch=git('diff','--binary',base,head);
const paths=git('diff','--name-only',base,head).trim().split('\n');
const files=paths.map(path=>({path,blob:git('rev-parse',`${head}:${path}`).trim()}));
const directory='reports/qa/ordinary-contract-lifecycle';
writeFileSync(`${directory}/publish-candidate.patch`,patch);
const candidate={capturedAt:new Date().toISOString(),base,head,files,
  patchSha256:createHash('sha256').update(patch).digest('hex')};
writeFileSync(`${directory}/publish-candidate.json`,JSON.stringify(candidate,null,2));
console.log(JSON.stringify({base,head,files:files.length,patchSha256:candidate.patchSha256}));
