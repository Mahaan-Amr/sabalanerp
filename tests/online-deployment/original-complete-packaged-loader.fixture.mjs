/** Test-only OS boundary. Never loaded by a runtime binding or native owner. */
const proxy=new URL('./original-complete-packaged-process.fixture.mjs',import.meta.url).href;
export async function resolve(specifier,context,next){if(specifier==='node:child_process'&&context.parentURL!==proxy)return{url:proxy,shortCircuit:true};return next(specifier,context);}
