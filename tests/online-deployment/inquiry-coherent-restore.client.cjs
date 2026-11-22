'use strict';
const fs=require('fs'),path=require('path'),http=require('http'),assert=require('assert/strict');
const root=process.argv[2],mode=process.argv[3],url='http://127.0.0.1:3287';
assert.match(root,/^\/app\/online-runtime-acceptance\/inquiry-coherent-[a-f0-9]{32}$/);
const state=path.join(root,'client-state.json');
const decode=s=>s.replace(/&(?:amp|quot|lt|gt|#39|#x([0-9a-f]+)|#([0-9]+));/gi,(m,h,d)=>h?String.fromCodePoint(parseInt(h,16)):d?String.fromCodePoint(Number(d)):({'&amp;':'&','&quot;':'"','&lt;':'<','&gt;':'>','&#39;':"'"}[m]||m));
function form(html,field){const found=[...html.matchAll(/<form\b[^>]*>([\s\S]*?)<\/form>/gi)].find(m=>m[1].includes('name="'+field+'"'));assert.ok(found,'NATIVE_FORM_MISSING');
 const data=new FormData();for(const tag of found[1].matchAll(/<input\b[^>]*>/gi)){const a=Object.fromEntries([...tag[0].matchAll(/([\w$:-]+)="([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));if(a.name&&a.type==='hidden')data.append(a.name,a.value||'');}
 assert.ok([...data.keys()].some(k=>k.startsWith('$ACTION_')),'COMPILED_ACTION_DESCRIPTOR_MISSING');return data;}
async function login(){const response=await fetch(url+'/admin/login');assert.equal(response.status,200);const data=form(await response.text(),'email');data.set('email','coherent@example.invalid');data.set('password','private-coherent-only');
 const result=await fetch(url+'/admin/login',{method:'POST',body:data,redirect:'manual',headers:{Origin:url}});assert.equal(result.status,303);const cookies=result.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ');assert.ok(cookies.includes('sabalan_admin_session='));await result.arrayBuffer();return cookies;}
async function product(cookie,row){const page=await fetch(url+'/admin/products/new',{headers:{Cookie:cookie}});assert.equal(page.status,200);const data=form(await page.text(),'rowNumber');for(const[k,v]of Object.entries({rowNumber:row,name:'Coherent actual Next product',description:'Same captured submission',listPrice:'1234567',finalPrice:'2345678',discountAvailability:'ندارد',lastDiscountPercent:''}))data.set(k,v);return data;}
(async()=>{
 if(mode==='login'){const cookie=await login();fs.writeFileSync(state,JSON.stringify({cookie}),{flag:'wx',mode:0o600});console.log('LOGIN_OK');return;}
 const {cookie}=JSON.parse(fs.readFileSync(state));
 if(mode==='prepare-queued'){const data=await product(cookie,'COHERENT-QUEUED');fs.writeFileSync(path.join(root,'queued-form.json'),JSON.stringify([...data]),{flag:'wx',mode:0o600});console.log('QUEUED_NATIVE_FORM_PREPARED');return;}
 if(mode==='ambiguous'){
  const data=await product(cookie,'COHERENT-ACK-LOST');const encoded=new Request(url,{method:'POST',body:data});const bytes=Buffer.from(await encoded.arrayBuffer());
  await new Promise((resolve,reject)=>{let closed=false;const request=http.request(url+'/admin/products/new',{method:'POST',headers:{Cookie:cookie,Origin:url,'content-type':encoded.headers.get('content-type'),'content-length':String(bytes.length),'x-private-inquiry-case':'lost-ack'}},response=>{response.resume();reject(Error('ACK_WAS_NOT_LOST'));});
   request.on('error',error=>closed?resolve():reject(error));request.end(bytes);
   (async()=>{while(!fs.existsSync(path.join(root,'action-delayed')))await new Promise(r=>setTimeout(r,5));closed=true;request.destroy();})().catch(reject);
  });console.log('ACK_LOST_NO_REPLAY');return;
 }
 if(mode==='queued'||mode==='retry'){
  const data=mode==='queued'?new FormData():await product(cookie,'COHERENT-ACK-LOST');if(mode==='queued')for(const[k,v]of JSON.parse(fs.readFileSync(path.join(root,'queued-form.json'))))data.append(k,v);
  const response=await fetch(url+'/admin/products/new',{method:'POST',body:data,redirect:'manual',headers:{Cookie:cookie,Origin:url,...(mode==='queued'?{'x-private-inquiry-case':'queued'}:{})}});
  assert.equal(response.status,303);const location=response.headers.get('location');await response.arrayBuffer();
  if(mode==='retry')assert.ok(location.includes('error='),'DUPLICATE_RETRY_NOT_REJECTED');else assert.equal(location,'/admin');
  console.log(mode==='retry'?'DUPLICATE_REFUSED':'QUEUED_COMMITTED');return;
 }
 if(mode==='restored'){
  const restoredCookie=await login();fs.writeFileSync(state,JSON.stringify({cookie:restoredCookie}));
  const response=await fetch(url+'/admin',{headers:{Cookie:restoredCookie}});assert.equal(response.status,200);assert.ok((await response.text()).includes('COHERENT-ACK-LOST'));console.log('RESTORED_NEXT_READ_OK');return;
 }
 throw Error('UNKNOWN_CLIENT_MODE');
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
