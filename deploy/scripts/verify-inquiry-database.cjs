const {createHash}=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
const baseline=require('./inquiry-baseline.json');
const sha256=value=>createHash('sha256').update(value).digest('hex');
const canonical=objects=>objects.map(row=>({...row,sql:row.sql.replace(/\s+/g,' ').trim().replace(/;$/,'').replace(/\s*([(),])\s*/g,'$1')}))
  .sort((a,b)=>`${a.type}:${a.name}`<`${b.type}:${b.name}`?-1:`${a.type}:${a.name}`>`${b.type}:${b.name}`?1:0);

/** One native read-only SQLite snapshot. No Prisma connection, schema change,
 * database creation or administrator creation occurs during runtime startup. */
function verifyInquiryDatabase(file) {
  if(typeof file!=='string'||!path.isAbsolute(file)||path.resolve(file)!==file||fs.realpathSync(file)!==file)throw new Error('INQUIRY_DATABASE_PATH_UNSAFE');
  const before=fs.lstatSync(file);
  if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size===0)throw new Error('INQUIRY_DATABASE_PATH_UNSAFE');
  const query=`.timeout 1000
PRAGMA query_only=ON;
SELECT json_object(
  'objects',json((SELECT json_group_array(json_object('type',type,'name',name,'table',tbl_name,'sql',sql)) FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%')),
  'history',json((SELECT json_group_array(json_object('id',id,'sqlSha256',sqlSha256,'schemaSha256',schemaSha256)) FROM "_sabalan_inquiry_migrations")),
  'integrity',json((SELECT json_group_array(integrity_check) FROM pragma_integrity_check)),
  'administrators',(SELECT count(*) FROM "Admin")
);`;
  let evidence;
  try{evidence=JSON.parse(execFileSync('sqlite3',['-readonly','-batch','-bail','-noheader',file],{input:query,encoding:'utf8',timeout:10000,maxBuffer:1000000,stdio:['pipe','pipe','pipe']}));}
  catch{throw new Error('INQUIRY_DATABASE_SNAPSHOT_UNPROVEN');}
  const after=fs.lstatSync(file);
  if(before.dev!==after.dev||before.ino!==after.ino||after.nlink!==1)throw new Error('INQUIRY_DATABASE_REPLACED');
  if(JSON.stringify(canonical(evidence.objects))!==JSON.stringify(canonical([...baseline.objects,...baseline.ledgerObjects])))throw new Error('INQUIRY_SCHEMA_UNPROVEN');
  const history=evidence.history;
  if(history.length!==1||history[0].id!==baseline.id||history[0].sqlSha256!==sha256(baseline.ledgerSql)
    ||history[0].schemaSha256!==sha256(JSON.stringify(canonical(baseline.objects))))throw new Error('INQUIRY_MIGRATION_HISTORY_UNPROVEN');
  if(JSON.stringify(evidence.integrity)!==JSON.stringify(['ok']))throw new Error('INQUIRY_SQLITE_INTEGRITY_FAILED');
  if(evidence.administrators===0)throw new Error('INQUIRY_BOOTSTRAP_REQUIRED');
}
module.exports={verifyInquiryDatabase};
if(require.main===module){
  try{
    const url=process.env.DATABASE_URL||'';
    if(!url.startsWith('file:')||/[?#\x00]/.test(url)||url.startsWith('file://'))throw new Error('INQUIRY_DATABASE_URL_INVALID');
    verifyInquiryDatabase(url.slice(5));console.log('INQUIRY_DATABASE_VERIFIED');
  }catch{console.error('INQUIRY_DATABASE_ADMISSION_FAILED');process.exitCode=1;}
}
