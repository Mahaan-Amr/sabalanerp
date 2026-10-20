/** Standalone diagnostic observer. All business commands use the installed HTTP runtime. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import path from 'node:path';
import {runInstalledDomainWriterCases,verifyRestoredInstalledDomainWriters,verifyInstalledBrowserTickets,verifyInstalledLegacyBrowserTickets} from './installed-domain-writers-native.fixture';

function privateBytes(file:string,maximum=65536){
 assert.ok(path.isAbsolute(file)&&path.resolve(file)===file&&fs.realpathSync(file)===file);
 const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid!())&&(before.mode&0o077n)===0n&&before.size>0n&&before.size<=BigInt(maximum));
  const bytes=fs.readFileSync(fd);for(const after of [fs.fstatSync(fd,{bigint:true}),fs.lstatSync(file,{bigint:true})])for(const key of ['dev','ino','size','mtimeNs','ctimeNs','mode','uid','nlink']as const)assert.equal(after[key],before[key]);return bytes;
 }finally{fs.closeSync(fd);}
}

async function main(){
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;assert.ok(size<=65536);chunks.push(Buffer.from(chunk));}
 const input=JSON.parse(Buffer.concat(chunks).toString());
 assert.equal(input.format,'sabalan-installed-domain-input/v1');
 assert.ok(input.mode===undefined||input.mode==='restore-verify'||input.mode==='browser-verify'||input.mode==='legacy-browser-verify');
 assert.match(input.seedSha256,/^[a-f0-9]{64}$/);
 assert.equal(process.cwd(),input.qualificationRoot);
 const raw=privateBytes(path.join(input.qualificationRoot,'acceptance-seed.json'));
 assert.equal(createHash('sha256').update(raw).digest('hex'),input.seedSha256);
 const require=createRequire('/app/package.json'),{PrismaClient}=require('@prisma/client');
 const db=new PrismaClient({datasources:{db:{url:process.env.DATABASE_URL}}});
 let qualification,restored,browserReceipts;
 try{
  if(input.mode==='restore-verify'||input.mode==='browser-verify'||input.mode==='legacy-browser-verify'){
   const [{name,oid,systemIdentifier}]=await db.$queryRaw`SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
   assert.match(name,input.mode==='restore-verify'?/^qa_application_native_[a-f0-9]{32}$/:/^qa_application_restored_[a-f0-9]{32}$/);assert.deepEqual({name,oid,systemIdentifier},input.scope.database);
   assert.match(input.expectationsSha256,/^[a-f0-9]{64}$/);
   const expected=privateBytes(input.expectationsPath,2*1024*1024);assert.equal(createHash('sha256').update(expected).digest('hex'),input.expectationsSha256);
   if(input.mode==='legacy-browser-verify')browserReceipts=await verifyInstalledLegacyBrowserTickets(db,JSON.parse(raw.toString()).adminId,JSON.parse(expected.toString()));
   else if(input.mode==='browser-verify')browserReceipts=await verifyInstalledBrowserTickets(db,JSON.parse(raw.toString()).adminId,JSON.parse(expected.toString()));
   else{qualification=JSON.parse(expected.toString());assert.equal(qualification.format,'sabalan-installed-domain-writers/v1');restored=await verifyRestoredInstalledDomainWriters({db,scope:input.scope,qualification});}
  }else{
   qualification=await runInstalledDomainWriterCases({db,origin:input.origin,scope:input.scope,
   seed:JSON.parse(raw.toString()),adminPassword:'PRIVATE NATIVE APPLICATION CONFIRMATION'});
  // Independent reads of the actual surviving SQL/live heads. This is not a
  // second checkpoint restore, and must never be described as one.
  await verifyRestoredInstalledDomainWriters({db,scope:input.scope,qualification});
  }
 }finally{await db.$disconnect();}
 process.stdout.write(JSON.stringify({format:'sabalan-installed-domain-original-result/v1',qualification,
  restored,browserReceipts,observerDisconnected:true,durableStateReadback:true,independentRestoreVerified:input.mode==='restore-verify'})+'\n');
}
main().catch(()=>{process.stderr.write('INSTALLED_DOMAIN_WRITER_QUALIFICATION_FAILED\n');process.exitCode=1;});
