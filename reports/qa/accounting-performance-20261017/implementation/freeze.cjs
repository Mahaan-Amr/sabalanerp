const fs=require('node:fs'),crypto=require('node:crypto'),cp=require('node:child_process');
const git=args=>cp.execFileSync('git',args,{maxBuffer:64*1024*1024});
const output='reports/qa/accounting-performance-20261017/implementation/';
const files=[
 'backend/src/services/accountingContractSearch.ts','backend/src/services/__tests__/accountingContractSearch.test.ts',
 'backend/src/services/accountingService.ts','backend/src/services/accountingListProjection.ts',
 'backend/src/services/partnerSales/accounting/preFinancialDocument.ts','backend/src/services/partnerSales/accounting/internalDocumentContent.ts',
 'backend/src/services/partnerSales/authorization/audited.ts','backend/src/services/partnerSales/authorization/centralAuthority.ts',
 'backend/src/services/partnerSales/authorization/workspaceAuthority.ts','backend/src/services/__tests__/partnerAccountingPurposeAuthority.test.ts',
 'backend/src/services/__tests__/partnerResponderRouteAccess.test.ts','frontend/src/app/dashboard/accounting/contracts/page.tsx',
 'frontend/src/lib/api.ts','frontend/src/features/accounting/accountingContractsLoader.ts',
 'frontend/src/features/accounting/__tests__/accountingContractsLoader.test.ts','tests/design-system-e2e/accounting-contract-search.spec.ts',
];
const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
let patch=git(['diff','--binary']).toString('utf8');
for(const file of files){
 if(cp.spawnSync('git',['ls-files','--error-unmatch',file],{stdio:'ignore'}).status===0)continue;
 const content=fs.readFileSync(file,'utf8').replace(/\r\n/g,'\n');const lines=content.trimEnd().split('\n');
 patch+=`diff --git a/${file} b/${file}\nnew file mode 100644\n--- /dev/null\n+++ b/${file}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line=>'+'+line).join('\n')}\n`;
}
fs.writeFileSync(output+'candidate.patch',patch);
const manifest={time:new Date().toISOString(),base:git(['merge-base','HEAD','origin/main']).toString().trim(),head:git(['rev-parse','HEAD']).toString().trim(),
 patchSha256:hash(patch),preexistingPatchSha256:hash(fs.readFileSync(output+'preexisting.patch')),
 scope:'Task source delta plus complete tracked dirty-worktree patch; preexisting.patch identifies original unrelated work. No commit, push or production deployment.',
 taskFiles:files.map(file=>{const bytes=fs.readFileSync(file);return{file,sha256:hash(bytes),benchmarkCompatibleTextJsonSha256:hash(JSON.stringify(bytes.toString('utf8')))}}),
 completeWorktreeInventory:git(['status','--short','--untracked-files=all']).toString('utf8')};
fs.writeFileSync(output+'candidate.json',JSON.stringify(manifest,null,2));
console.log(JSON.stringify({head:manifest.head,patchSha256:manifest.patchSha256,taskFiles:files.length}));
