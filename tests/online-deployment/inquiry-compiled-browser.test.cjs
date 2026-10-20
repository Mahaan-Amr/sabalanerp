'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {readInquiryCompiledBrowser,inquiryRuntimeBuildEnvironment}=require('../../deploy/scripts/inquiry-compiled-browser.cjs');
function fixture(t){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'sabalan-inquiry-manifest-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const files={'.next/BUILD_ID':'build-native-framework','.next/required-server-files.json':JSON.stringify({config:{deploymentId:'inquiry_online_12345678',env:{NEXT_PUBLIC_INQUIRY_BUILD_ID:'inquiry_online_12345678'}}}),'.next/server/server-reference-manifest.json':JSON.stringify({node:{['a'.repeat(40)]:{}},edge:{}}),'.next/static/chunks/browser.js':'const value=1;', 'public/logo.svg':'<svg/>','package.json':'{}','next.config.ts':'export default {};'};
 for(const [name,raw]of Object.entries(files)){const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,raw);}
 return root;
}
test('actual native framework ID stays distinct from the public Inquiry selector; same-size asset edits change manifest',t=>{
 const root=fixture(t),before=readInquiryCompiledBrowser(root);
 assert.equal(before.id,'inquiry_online_12345678');assert.equal(before.frameworkBuildId,'build-native-framework');assert.deepEqual(before.actionIds,['a'.repeat(40)]);assert.equal(before.assets[0].path,'/_next/static/chunks/browser.js');
 fs.writeFileSync(path.join(root,'.next/static/chunks/browser.js'),'const value=2;');const after=readInquiryCompiledBrowser(root);assert.notEqual(after.manifestSha256,before.manifestSha256);assert.notEqual(after.assets[0].sha256,before.assets[0].sha256);
});
test('mismatched public selector refuses and cache bytes do not become browser authority',t=>{
 const root=fixture(t),before=readInquiryCompiledBrowser(root);fs.mkdirSync(path.join(root,'.next/cache'));fs.writeFileSync(path.join(root,'.next/cache/opaque'),'runtime-cache');assert.equal(readInquiryCompiledBrowser(root).manifestSha256,before.manifestSha256);
 fs.writeFileSync(path.join(root,'.next/required-server-files.json'),JSON.stringify({config:{deploymentId:'inquiry_online_12345678',env:{NEXT_PUBLIC_INQUIRY_BUILD_ID:'inquiry_other_12345678'}}}));assert.throws(()=>readInquiryCompiledBrowser(root));
});

test('Linux Next Prisma links remain typed metadata rather than invented regular file bytes',{skip:process.platform!=='linux'},t=>{
 const root=fixture(t),target=path.join(root,'node_modules/@prisma/client');fs.mkdirSync(target,{recursive:true});fs.writeFileSync(path.join(target,'index.js'),'immutable-image-dependency');
 const relative='.next/node_modules/@prisma/client-2c3a283f134fdcb6',file=path.join(root,relative);fs.mkdirSync(path.dirname(file),{recursive:true});fs.symlinkSync('../../../node_modules/@prisma/client',file);
 const before=readInquiryCompiledBrowser(root);assert.deepEqual(before.manifest.links,[{path:relative,type:'symlink',target:'../../../node_modules/@prisma/client',resolvedPath:'node_modules/@prisma/client',targetType:'directory'}]);
 assert.ok(!before.manifest.files.some(row=>row.path===relative||row.path.startsWith('node_modules/')));assert.ok(!before.assets.some(row=>row.type==='symlink'));
 fs.unlinkSync(file);fs.symlinkSync('../../../node_modules/@prisma/./client',file);assert.notEqual(readInquiryCompiledBrowser(root).manifestSha256,before.manifestSha256,'EXACT_LINK_TARGET_BYTES_ARE_MANIFEST_IDENTITY');
});

test('Linux dependency links reject escapes, dangling targets, extra link chains and mutable cache targets',{skip:process.platform!=='linux'},t=>{
 for(const target of ['../../../../outside','../../../node_modules/missing','../../../.next/cache','../../../node_modules/chained']){
  const root=fixture(t),file=path.join(root,'.next/node_modules/@prisma/client-link');fs.mkdirSync(path.dirname(file),{recursive:true});fs.mkdirSync(path.join(root,'.next/cache'),{recursive:true});fs.mkdirSync(path.join(root,'node_modules/actual'),{recursive:true});fs.symlinkSync('actual',path.join(root,'node_modules/chained'));fs.symlinkSync(target,file);assert.throws(()=>readInquiryCompiledBrowser(root),target);
 }
});

test('Linux static and public assets never admit symlinks even to internal dependencies',{skip:process.platform!=='linux'},t=>{
 for(const relative of ['.next/static/chunks/linked.js','public/linked.js','.next/server/linked.js']){
  const root=fixture(t),target=path.join(root,'node_modules/dependency.js'),file=path.join(root,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,'asset');fs.symlinkSync(path.relative(path.dirname(file),target),file);assert.throws(()=>readInquiryCompiledBrowser(root),relative);
 }
});

test('runtime selector is derived from compiled deploymentId, rejects inherited conflicts, and preserves legacy null',t=>{
 const root=fixture(t),current=readInquiryCompiledBrowser(root),keys=['SABALAN_INQUIRY_BUILD_ID','NEXT_PUBLIC_INQUIRY_BUILD_ID','NEXT_DEPLOYMENT_ID'];
 const expected=Object.fromEntries(keys.map(key=>[key,current.deploymentId]));assert.deepEqual(inquiryRuntimeBuildEnvironment(current,{}),expected);
 assert.deepEqual(inquiryRuntimeBuildEnvironment(current,expected),expected);
 for(const key of keys)for(const wrong of ['',current.frameworkBuildId,'inquiry_other_12345678'])assert.throws(()=>inquiryRuntimeBuildEnvironment(current,{[key]:wrong}),/INQUIRY_RUNTIME_BUILD_ID_CONFLICT/);
 fs.writeFileSync(path.join(root,'.next/required-server-files.json'),JSON.stringify({config:{env:{}}}));const legacy=readInquiryCompiledBrowser(root);assert.equal(legacy.deploymentId,null);assert.deepEqual(inquiryRuntimeBuildEnvironment(legacy,{}),{});assert.deepEqual(inquiryRuntimeBuildEnvironment(legacy,Object.fromEntries(keys.map(key=>[key,'']))),{});
 for(const key of keys)assert.throws(()=>inquiryRuntimeBuildEnvironment(legacy,{[key]:current.id}),/INQUIRY_RUNTIME_BUILD_ID_CONFLICT/);
});

test('real ordinary wrapper derives compiled selector before DB verification and refuses conflicts first',{skip:process.platform!=='linux'},t=>{
 const {spawnSync}=require('node:child_process'),root=fixture(t),helper=path.resolve(__dirname,'../../deploy/scripts/inquiry-compiled-browser.cjs'),wrapper=path.resolve(__dirname,'../../deploy/scripts/run-inquiry-with-recovery.sh');
 const shell=`helper="$1"; compiled="$2"; wrapper="$3"
 node(){
  case "$1" in
   /app/inquiry-compiled-browser.cjs) /usr/local/bin/node "$helper" --runtime-exports "$compiled" ;;
   /app/verify-inquiry-database.cjs) /usr/local/bin/node -e 'const a=require("node:assert/strict");for(const k of ["SABALAN_INQUIRY_BUILD_ID","NEXT_PUBLIC_INQUIRY_BUILD_ID","NEXT_DEPLOYMENT_ID"])a.equal(process.env[k],"inquiry_online_12345678");console.log("DB_VERIFICATION_REACHED_WITH_COMPILED_ID");';return 1 ;;
   *) return 99 ;;
  esac
 }
 . "$wrapper"`;
 const env={...process.env,RECOVERY_COORDINATION_DIR:path.join(root,'coordination')};for(const key of ['SABALAN_INQUIRY_BUILD_ID','NEXT_PUBLIC_INQUIRY_BUILD_ID','NEXT_DEPLOYMENT_ID','BACKEND_ONLINE_SCOPE_FILE','BACKEND_ONLINE_SCOPE_SHA256','INQUIRY_NATIVE_AUTHORITY_FILE','INQUIRY_NATIVE_CLAIM_SHA256','INQUIRY_RUNTIME_GENERATION','BACKEND_RUNTIME_ROLE'])delete env[key];
 const valid=spawnSync('/bin/sh',['-c',shell,'wrapper-test',helper,root,wrapper],{env,encoding:'utf8'});assert.equal(valid.status,1);assert.match(valid.stdout,/DB_VERIFICATION_REACHED_WITH_COMPILED_ID/);assert.ok(fs.existsSync(env.RECOVERY_COORDINATION_DIR));fs.rmdirSync(env.RECOVERY_COORDINATION_DIR);
 const conflict=spawnSync('/bin/sh',['-c',shell,'wrapper-test',helper,root,wrapper],{env:{...env,SABALAN_INQUIRY_BUILD_ID:'inquiry_wrong_12345678'},encoding:'utf8'});assert.equal(conflict.status,1);assert.equal(conflict.stdout,'');assert.match(conflict.stderr,/INQUIRY_RUNTIME_BUILD_ID_CONFLICT/);assert.ok(!fs.existsSync(env.RECOVERY_COORDINATION_DIR));
 const online=spawnSync('/bin/sh',['-c',shell,'wrapper-test',helper,root,wrapper],{env:{...env,BACKEND_RUNTIME_ROLE:'serving'},encoding:'utf8'});assert.equal(online.status,75);assert.equal(online.stdout,'');assert.match(online.stderr,/INQUIRY_ONLINE_STARTUP_NOT_ADMITTED/);assert.ok(!fs.existsSync(env.RECOVERY_COORDINATION_DIR));
});
