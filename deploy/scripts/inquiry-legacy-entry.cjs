'use strict';
// Only the augmentation recipe installs this entry. Business .next bytes,
// actions, schema and dependencies remain the exact original compiled image.
const assert=require('node:assert/strict');
const net=require('node:net');
async function main(){
 assert.equal(process.cwd(),'/app');
 const argv=process.argv.slice(2);assert.equal(argv.length,4);assert.equal(argv[0],'--hostname');assert.equal(argv[2],'--port');
 const host=argv[1],port=Number(argv[3]);assert.equal(net.isIP(host),4);assert.ok(host!=='0.0.0.0');assert.equal(port,3001);
 assert.match(process.env.INQUIRY_RUNTIME_GENERATION||'',/^[1-9][0-9]*$/);
 const owner=await require('./entry.cjs').initialize(Number(process.env.INQUIRY_RUNTIME_GENERATION));
 const pool=require('./inquiry-legacy-owned-prisma.cjs').installOwnedInquiryPrisma(owner);
 const next=require('/app/node_modules/next');const application=next({dev:false,dir:'/app',hostname:host,port});
 const service=await require('./inquiry-legacy-owned-http.cjs').createOwnedLegacyInquiryHttp({owner,
  prepare:()=>application.prepare(),handle:(req,res)=>application.getRequestHandler()(req,res),
  close:async()=>{try{await application.close();}finally{await pool.disconnect();}}});
 try{await service.listen(host,port);}catch(error){await service.close();throw error;}
 let closing;const stop=()=>{if(!closing)closing=service.close().catch(()=>{process.stderr.write('INQUIRY_ORIGINAL_SHUTDOWN_FAILED\n');process.exitCode=1;});};
 process.on('SIGTERM',stop);process.on('SIGINT',stop);
 process.stdout.write('SABALAN_LEGACY_INQUIRY_OWNED_READY\n');
}
void main().catch(()=>{process.stderr.write('INQUIRY_LEGACY_NATIVE_STARTUP_FAILED\n');process.exitCode=1;});
