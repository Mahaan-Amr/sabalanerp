// Isolated QA database only. Reuse the real historical evidence fixture builder
// with namespaced identities BEFORE hashing/projection; never clone signed hashes.
const assert=require('node:assert/strict'),fs=require('node:fs'),Module=require('node:module');
const ts=require('/app/accounting-qa-tools/typescript.js');
const {prisma}=require('/app/accounting-qa-after/src/lib/prisma');
const root='/app/accounting-qa-after/src/services/__tests__/';
function moduleFrom(source,filename,overrides={}){
 const module=new Module(filename);module.filename=filename;module.paths=Module._nodeModulePaths(root);
 const normal=module.require.bind(module);module.require=request=>overrides[request]||normal(request);
 module._compile(ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText,filename);
 return module.exports;
}
(async()=>{
 assert.equal(new URL(process.env.DATABASE_URL).pathname,'/sabalanerp_accounting_perf_20261017');
 for(let i=1;i<=12;i++){
  const namespace=`scale${i}-`;
  const convert=text=>text.replaceAll('historical-',namespace).replaceAll('current-plan-',`${namespace}current-plan-`);
  const fixture=moduleFrom(convert(fs.readFileSync(root+'partnerAccountingHistoricalReadFixture.ts','utf8')),root+`scale-fixture-${i}.ts`);
  let seed=convert(fs.readFileSync(root+'partnerAccountingHistoricalReadSeed.ts','utf8'));
  seed=seed.replace("name: 'Historical'",`name: 'Historical ${i}'`).replace("namePersian: 'آزمون'",`namePersian: 'آزمون ${i}'`)
   .replace('await tx.effectiveAuthorizationState.create({ data: { id: 1, revision: 1 } });',
    'await tx.effectiveAuthorizationState.upsert({where:{id:1},create:{id:1,revision:1},update:{}});');
  const seeder=moduleFrom(seed,root+`scale-seed-${i}.ts`,{'./partnerAccountingHistoricalReadFixture':fixture});
  await seeder.seedHistoricalAccountingRead(prisma);
 }
 console.log(JSON.stringify({partnerCases:await prisma.partnerSaleCase.count(),note:'Canonical schema/evidence builders run before persistence; isolated QA DB only.'}));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(()=>prisma.$disconnect());
