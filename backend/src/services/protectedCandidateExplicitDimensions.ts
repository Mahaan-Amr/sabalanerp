/** Narrow dimensions read in the existing private transaction. These checks
 * do not assume an owner name, grant release authority, or cover runtime-role
 * access and sequence values. A missing witness is never treated as MATCH. */
export async function observeCandidateExplicitDimensions(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},prefix:number){
 if(!tx||typeof tx.$queryRaw!=='function'||!Number.isInteger(prefix)||prefix<0||prefix>14)return {state:'UNKNOWN' as const};
 const checks:string[]=[];
 if(prefix>=2){
  const rows=await tx.$queryRaw<Array<{present:boolean;publicPrivileges:number}>>`SELECT true AS present,
   (SELECT count(*)::integer FROM pg_catalog.aclexplode(COALESCE(c.relacl,pg_catalog.acldefault('r',c.relowner))) a WHERE a.grantee=0) AS "publicPrivileges"
   FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='online_financial_compatibility_barriers' AND c.relkind='r'`;
  if(!Array.isArray(rows)||rows.length>1)return {state:'UNKNOWN' as const};
  if(rows.length!==1||rows[0].present!==true||!Number.isInteger(rows[0].publicPrivileges))return {state:'UNKNOWN' as const};
  if(rows[0].publicPrivileges!==0)return {state:'MISMATCH' as const,dimension:'customer_barrier_public_revoke' as const};
  checks.push('customer_barrier_public_revoke');
 }
 if(prefix>=8){
  const rows=await tx.$queryRaw<Array<{increment:string;minimum:string;maximum:string;cache:string;cycle:boolean}>>`SELECT s.seqincrement::text AS increment,s.seqmin::text AS minimum,
   s.seqmax::text AS maximum,s.seqcache::text AS cache,s.seqcycle AS cycle FROM pg_catalog.pg_sequence s
   JOIN pg_catalog.pg_class c ON c.oid=s.seqrelid JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND c.relname='sales_dispatch_invoice_number_seq' AND c.relkind='S'`;
  if(!Array.isArray(rows)||rows.length>1)return {state:'UNKNOWN' as const};
  if(rows.length===0)return {state:'MISMATCH' as const,dimension:'sales_invoice_sequence' as const};
  const x=rows[0];if(typeof x.increment!=='string'||typeof x.minimum!=='string'||typeof x.maximum!=='string'||typeof x.cache!=='string'||typeof x.cycle!=='boolean')return {state:'UNKNOWN' as const};
  if(x.increment!=='1'||x.minimum!=='1'||x.maximum!=='9223372036854775807'||x.cache!=='1'||x.cycle)return {state:'MISMATCH' as const,dimension:'sales_invoice_sequence' as const};
  checks.push('sales_invoice_sequence');
 }
 if(prefix>=11){
  const rows=await tx.$queryRaw<Array<{bound:boolean}>>`SELECT pg_catalog.pg_get_serial_sequence('public.purchasing_documents','number')::regclass =
   pg_catalog.to_regclass('public.purchasing_documents_number_seq') AS bound`;
  if(!Array.isArray(rows)||rows.length!==1||typeof rows[0].bound!=='boolean')return {state:'UNKNOWN' as const};
  if(!rows[0].bound)return {state:'MISMATCH' as const,dimension:'purchasing_serial_binding' as const};
  checks.push('purchasing_serial_binding');
 }
 return Object.freeze({state:'SCOPED_MATCH' as const,checks:Object.freeze(checks),limitations:Object.freeze(['runtime-role-privileges','relation-security','sequence-current-value-not-compared'] as const)});
}
