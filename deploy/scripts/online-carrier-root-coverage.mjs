import path from 'node:path';
const assert=(value,code)=>{if(!value)throw Error(code);};
const normalized=value=>typeof value==='string'&&value.startsWith('/')&&path.posix.normalize(value)===value;
const contains=(parent,child)=>child===parent||child.startsWith(parent+'/');
export const ONLINE_EPHEMERAL_PDF_ROOTS=Object.freeze(['/app/storage/bi-reports','/app/storage/reports','/app/storage/sales-reports']);

/** Mount coverage is a prerequisite, not a baseline/adoption proof. Exact inode
 * and independently captured bytes remain the existing release authority. */
export function assertOnlineCarrierRootCoverage(plan,manifest){
 assert(plan?.kind==='backend'&&Array.isArray(plan.mounts)&&Array.isArray(plan.tmpfs),'ONLINE_ROOT_COVERAGE_PLAN_INVALID');
 assert(Array.isArray(manifest?.roots)&&manifest.roots.length===9&&new Set(manifest.roots.map(value=>value.live)).size===9&&new Set(manifest.roots.map(value=>value.store)).size===9,'ONLINE_ROOT_COVERAGE_RETAINED_SET_INVALID');
 assert(Array.isArray(manifest.ephemeralRoots)&&JSON.stringify([...manifest.ephemeralRoots].sort())===JSON.stringify(ONLINE_EPHEMERAL_PDF_ROOTS),'ONLINE_ROOT_COVERAGE_EPHEMERAL_SET_INVALID');
 const mounts=plan.mounts;for(const mount of mounts)assert(normalized(mount.target),'ONLINE_ROOT_COVERAGE_MOUNT_PATH_INVALID');
 for(let i=0;i<mounts.length;i++)for(let j=i+1;j<mounts.length;j++)assert(!contains(mounts[i].target,mounts[j].target)&&!contains(mounts[j].target,mounts[i].target),'ONLINE_ROOT_COVERAGE_NESTED_MOUNT_REFUSED');
 const tmpfs=plan.tmpfs.map(value=>value.split(':')[0]);assert(tmpfs.every(normalized)&&new Set(tmpfs).size===tmpfs.length,'ONLINE_ROOT_COVERAGE_TMPFS_INVALID');
 for(const retained of manifest.roots)for(const target of [retained.live,retained.store]){
  assert(normalized(target),'ONLINE_ROOT_COVERAGE_RETAINED_PATH_INVALID');
  const covering=mounts.filter(mount=>contains(mount.target,target)).sort((a,b)=>b.target.length-a.target.length)[0];
  assert(covering?.type==='volume'&&!covering.readOnly,'ONLINE_ROOT_COVERAGE_RETAINED_NOT_PERSISTENT');
  assert(!tmpfs.some(root=>contains(root,target)||contains(target,root)),'ONLINE_ROOT_COVERAGE_RETAINED_TMPFS_REFUSED');
 }
 for(const ephemeral of manifest.ephemeralRoots){
  assert(tmpfs.filter(root=>root===ephemeral).length===1,'ONLINE_ROOT_COVERAGE_EPHEMERAL_TMPFS_MISSING');
  assert(!mounts.some(mount=>contains(ephemeral,mount.target)),'ONLINE_ROOT_COVERAGE_EPHEMERAL_SHADOW_REFUSED');
 }
 return Object.freeze({retainedRoots:9,ephemeralRoots:3,persistentCoverageVerified:true,baselineAdoptionAuthorized:false});
}

/** Fixed source executed inside the newly created backend BEFORE native START.
 * It never creates directories or blesses newly mounted empty data. */
export const onlineCarrierRootIdentitySource=String.raw`const fs=require('fs'),assert=require('assert/strict');const input=JSON.parse(process.argv[1]);assert.equal(input.roots.length,9);for(const root of input.roots)for(const kind of ['live','store']){const file=root[kind];assert.equal(fs.realpathSync(file),file);const st=fs.lstatSync(file,{bigint:true});assert.ok(st.isDirectory()&&st.uid===0n&&(st.mode&0o077n)===0n);assert.equal(String(st.dev),root[kind+'Device']);assert.equal(String(st.ino),root[kind+'Inode']);}for(const file of input.ephemeralRoots){assert.equal(fs.realpathSync(file),file);const st=fs.lstatSync(file);assert.ok(st.isDirectory()&&st.uid===0&&(st.mode&0o077)===0);}console.log(JSON.stringify({retainedRoots:9,ephemeralRoots:3,existingIdentityVerified:true,baselineAdoptionAuthorized:false}));`;
