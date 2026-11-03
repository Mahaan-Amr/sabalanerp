/** Actual HTTP/EOF/cookie and pinned asset path; modeled application/FS boundary.
 * This does not substitute for native backend, frontend or browser acceptance. */
import test from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import Module,{createRequire}from'node:module';import{createHash}from'node:crypto';
const sha=b=>createHash('sha256').update(b).digest('hex');
function reader(){const file=path.resolve('scripts/lib/restored-qa/original-complete-frontend-reader.cjs'),m=new Module(file),r=createRequire(file);m.filename=file;m.require=id=>id==='./coherent-layout.cjs'?{snapshot:()=>({files:[],directories:[]})}:r(id);m._compile(fs.readFileSync(file,'utf8'),file);return m.exports;}
test('same finite frontend path requires real auth responses, asset bytes and closed HTTP readers',async()=>{
 const admin='a'.repeat(43),denied='b'.repeat(43),login='c'.repeat(43),database={name:'modeled_private_b',oid:'12',systemIdentifier:'123'},asset=Buffer.from('immutable-next-asset');let revoked=false,assetChanged=false;const seen=[];
 const server=http.createServer((req,res)=>{seen.push(req.url);res.setHeader('Connection','close');let chunks=[];req.on('data',b=>chunks.push(b));req.on('end',()=>{
  const token=req.headers.cookie?.slice('sabalan_session='.length),body=chunks.length?JSON.parse(Buffer.concat(chunks)):null;let status=200,value={success:true};
  if(req.url==='/api/health')value={status:'OK',database:'OK'};
  else if(req.url==='/login'){res.end('<html><script src="/_next/static/app.js"></script></html>');return;}
  else if(req.url==='/_next/static/app.js'){res.end(assetChanged?'drift':asset);return;}
  else if(req.url==='/api/auth/me'){if(token===admin)value={data:{id:'restored-admin'}};else if(token===login&&!revoked)value={data:{id:'owned-probe'}};else status=401;}
  else if(req.url==='/api/users?limit=1'){status=token===admin?200:token===denied?403:401;}
  else if(req.url==='/api/auth/login'){if(body.password==='private-password'){revoked=false;res.setHeader('set-cookie','sabalan_session='+login+'; HttpOnly; Path=/');value={data:{user:{id:'owned-probe'}}};}else status=401;}
  else if(req.url==='/api/auth/logout'){assert.equal(token,login);revoked=true;}
  else if(req.url==='/api/customers/customer-a'){assert.equal(token,admin);value={success:true,data:{id:'customer-a'}};}
  else status=404;
  res.statusCode=status;res.end(JSON.stringify(value));
 });});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 const fixture={format:'sabalan-original-complete-browser-private-input/v1',database,adminToken:admin,deniedToken:denied,originalAdminId:'restored-admin',passwordProbe:{id:'owned-probe',username:'probe',password:'private-password'},businessCustomerId:'customer-a'};
 const inquiryRaw=Buffer.from('<html>Inquiry login</html>'),images=Object.fromEntries(['backend','frontend','inquiry'].map((role,i)=>[role,{image:'sha256:'+String(i+1).repeat(64),executionImage:'sha256:'+String(i+4).repeat(64),sourceCommit:'a'.repeat(40)}]));
 const input={database,backend:{url:base},frontend:{url:base,asset:{path:'/_next/static/app.js',sha256:sha(asset)}},inquiry:{ready:true,loginResponse:{status:200,rawBase64:inquiryRaw.toString('base64'),bytes:inquiryRaw.length,sha256:sha(inquiryRaw)}},images},baseline={format:'sabalan-application-restored-file-baseline/v1',sources:Array.from({length:9},(_,i)=>({liveRoot:'modeled/'+i,files:[],directories:[]}))};
 try{const result=await reader().observeOriginalCompleteFrontend(input,fixture,baseline);assert.equal(result.authenticated,true);assert.equal(result.readers.length,13);assert.ok(result.readers.every(v=>v.requestClosed&&v.responseEof&&v.responseClosed));const raw=Buffer.from(result.healthRawBase64,'base64'),health=JSON.parse(raw);assert.equal(sha(raw),result.healthSha256);assert.equal(health.applications.backend.image,images.backend.image);assert.equal(health.applications.backend.executionImage,images.backend.executionImage);assert.doesNotMatch(JSON.stringify(result),/private-password|restored-admin|owned-probe/);assetChanged=true;await assert.rejects(reader().observeOriginalCompleteFrontend(input,fixture,baseline));assert.equal(seen.filter(p=>p==='/api/auth/login').length,2);
 }finally{await new Promise(resolve=>server.close(resolve));}
});
