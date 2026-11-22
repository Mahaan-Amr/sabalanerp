/** Private, native-owned observation of the installed image before diagnostic
 * history is enabled. No backend source is bundled into this observer. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {qualifyInstalledDisabledPerformanceProfile} from './installed-performance-disabled-profile.fixture';

const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
function installedTree(){
 const rows:Array<{bytes:number;path:string;sha256:string}>=[];
 const walk=(directory:string)=>{assert.equal(fs.realpathSync(directory),directory);for(const name of fs.readdirSync(directory).sort()){
  const file=directory+'/'+name,st=fs.lstatSync(file);assert.ok(!st.isSymbolicLink());
  if(st.isDirectory())walk(file);else{assert.ok(st.isFile()&&st.nlink===1);const raw=fs.readFileSync(file);assert.equal(raw.length,st.size);rows.push({bytes:st.size,path:file.slice('/app/dist/'.length),sha256:sha(raw)});}
 }};walk('/app/dist');assert.ok(rows.length>0&&rows.length<=32768);rows.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return sha(Buffer.from(JSON.stringify(rows)));
}
async function main(){
 assert.equal(process.platform,'linux');assert.equal(process.env.NODE_ENV,'test');
 assert.equal(process.umask(),0o077);
 const chunks:Buffer[]=[];let size=0;
 for await(const chunk of process.stdin){size+=chunk.length;assert.ok(size<=65536);chunks.push(Buffer.from(chunk));}
 const input=JSON.parse(Buffer.concat(chunks).toString());
 assert.equal(input.format,'sabalan-installed-pristine-performance-input/v1');
 assert.match(input.database.name,/^qa_application_native_[a-f0-9]{32}$/);
 assert.equal(process.cwd(),input.root);assert.equal(fs.realpathSync(input.root),input.root);
 const require=createRequire('/app/package.json');
 const scope=require('/app/dist/services/onlineRuntimeScope.js').loadOnlineRuntimeScope();assert.ok(scope);
 assert.equal(scope.scope.purpose,'http');assert.equal(scope.scope.role,'serving');
 assert.equal(scope.sha256,input.scopeSha256);
 assert.equal(scope.scope.database.name,input.database.name);
 const entry='/app/dist/application.js';assert.equal(fs.realpathSync(entry),entry);
 assert.equal(installedTree(),input.runtimeBundleSha256);const entrySha256=sha(fs.readFileSync(entry));
 const seedFile=input.root+'/acceptance-seed.json';assert.equal(fs.realpathSync(seedFile),seedFile);
 const seedBytes=fs.readFileSync(seedFile);assert.ok(seedBytes.length<=65536);assert.equal(sha(seedBytes),input.seedSha256);
 const seed=JSON.parse(seedBytes.toString());assert.equal(seed.database,input.database.name);
 process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR=input.root+'/storage/performance-exports';
 const {createScopedRuntimeWork}=require('/app/dist/services/onlineRuntimeWork.js');
 let boundary:any,application:any,stopping=false;
 const pool=require('/app/dist/lib/prisma.js');
 let result:any;
 try{
  boundary=await createScopedRuntimeWork({registrySha256:scope.scope.manifestSha256,generation:1,canJoin:()=>!stopping});
  const [identity]=await pool.prisma.$queryRaw`SELECT current_database()::text AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid,(SELECT system_identifier::text FROM pg_control_system()) AS "systemIdentifier"`;
  assert.deepEqual(identity,input.database);
  // This isolated diagnostic uses the installed ordinary application factory;
  // it does not issue ONLINE admission or install a public route.
  application=require(entry).createApplication({runtimeRole:'standalone',isShuttingDown:()=>stopping});
  await new Promise<void>((resolve,reject)=>{application.server.once('error',reject);application.server.listen(0,input.bindHost,resolve);});
  const address=application.server.address();assert.equal(address.address,input.bindHost);
  result=await qualifyInstalledDisabledPerformanceProfile({db:pool.prisma,
   base:`http://${input.bindHost}:${address.port}`,actorId:seed.performanceProductionProfile.actorId,
   sessionToken:seed.performanceProductionProfile.sessionToken,exportRoot:process.env.PERSONNEL_PERFORMANCE_EXPORT_DIR!});
  assert.equal(installedTree(),input.runtimeBundleSha256);assert.equal(sha(fs.readFileSync(entry)),entrySha256);assert.equal(sha(fs.readFileSync(seedFile)),input.seedSha256);
 }finally{
  stopping=true;application?.closeExternalAdmission();
  if(boundary)await boundary.requests.waitForDrain(240000);
  if(application)await application.realtimeDelivery.stop(240000);
  if(boundary)await boundary.stopAndDrain(240000);
  if(application?.server.listening)await new Promise<void>((resolve,reject)=>application.io.close((error:any)=>error?reject(error):resolve()));
  await pool.disconnectDatabase();
 }
 process.stdout.write('SABALAN_INSTALLED_PRISTINE '+JSON.stringify({format:'sabalan-installed-pristine-performance-result/v1',
  result,database:input.database,runtimeId:scope.scope.runtimeId,scopeSha256:scope.sha256,
  installedApplicationSha256:entrySha256,runtimeBundleSha256:input.runtimeBundleSha256,seedSha256:input.seedSha256,
  observerDisconnected:true,productionAdmission:false})+'\n');
}
void main().catch(error=>{console.error('INSTALLED_PRISTINE_PERFORMANCE_FAILED',error instanceof Error?error.message:'UNKNOWN');process.exitCode=1;});
