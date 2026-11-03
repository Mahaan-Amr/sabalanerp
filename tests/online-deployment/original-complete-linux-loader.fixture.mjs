/** Test-only transport boundary. Never included in an operational capsule. */
export async function resolve(specifier,context,next){
 if(context.parentURL?.endsWith('/restored-qa/create-complete-work.mjs')){
  if(specifier==='./original-issuer-client.mjs')return{url:'data:text/javascript,'+encodeURIComponent("export async function createOriginalLinuxRestoredIssuerClient(){return{close(){globalThis.testClosureCalls.push('issuer');if(process.env.COMPLETE_LINUX_TEST_MODE==='issuer')throw Error('TEST_ISSUER_FAILURE');return{failed:false,allOriginalHttpReadersClosed:true};}}}"),shortCircuit:true};
  if(specifier==='./inquiry-current-client.cjs')return next(specifier,context);
 }
 return next(specifier,context);
}
