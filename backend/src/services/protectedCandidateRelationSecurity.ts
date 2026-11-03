import {createHash} from 'node:crypto';
import {candidateStageProjection} from './protectedCandidateStageProjection';

/** Conservative security dimension for source-mapped public relations. The
 * control connection's role is measured, never guessed by name. Binding that
 * role to every serving runtime remains a separate gate. */
export async function observeCandidateRelationSecurity(tx:{$queryRaw<T>(strings:TemplateStringsArray,...values:unknown[]):Promise<T>},prefix:number){
 const expected=candidateStageProjection(prefix);
 if(expected.state!=='SCOPED_EXPECTATION'||!tx||typeof tx.$queryRaw!=='function')return {state:'UNKNOWN' as const};
 const names=Object.keys(expected.tables).sort();
 const empty=createHash('sha256').update(JSON.stringify({columns:[],constraints:[],indexes:[],triggers:[]})).digest('hex');
 const rows=await tx.$queryRaw<Array<{name:string;kind:string;persistence:string;rls:boolean;forced:boolean;policies:number;inheritance:number;ownerRights:boolean;selectable:boolean;insertable:boolean;updatable:boolean;deletable:boolean}>>`
  SELECT c.relname AS name,c.relkind::text AS kind,c.relpersistence::text AS persistence,c.relrowsecurity AS rls,c.relforcerowsecurity AS forced,
   (SELECT count(*)::integer FROM pg_catalog.pg_policy p WHERE p.polrelid=c.oid) AS policies,
   (SELECT count(*)::integer FROM pg_catalog.pg_inherits i WHERE i.inhrelid=c.oid OR i.inhparent=c.oid) AS inheritance,
   pg_catalog.pg_has_role(current_user,c.relowner,'USAGE') AS "ownerRights",
   pg_catalog.has_table_privilege(current_user,c.oid,'SELECT') AS selectable,pg_catalog.has_table_privilege(current_user,c.oid,'INSERT') AS insertable,
   pg_catalog.has_table_privilege(current_user,c.oid,'UPDATE') AS updatable,pg_catalog.has_table_privilege(current_user,c.oid,'DELETE') AS deletable
  FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname='public' AND c.relname=ANY(${names}::text[]) ORDER BY c.relname`;
 if(!Array.isArray(rows)||rows.length>names.length)return {state:'UNKNOWN' as const};
 const actual=new Map(rows.map(row=>[row.name,row]));if(actual.size!==rows.length)return {state:'UNKNOWN' as const};
 for(const name of names){
  const row=actual.get(name),shouldBeAbsent=expected.tables[name]===empty;
  if(shouldBeAbsent){if(row)return {state:'MISMATCH' as const,dimension:'relation_expected_absent' as const};continue;}
  if(!row)return {state:'MISMATCH' as const,dimension:'relation_expected_present' as const};
  if(typeof row.kind!=='string'||typeof row.persistence!=='string'||typeof row.rls!=='boolean'||typeof row.forced!=='boolean'||
    !Number.isInteger(row.policies)||!Number.isInteger(row.inheritance)||[row.ownerRights,row.selectable,row.insertable,row.updatable,row.deletable].some(v=>typeof v!=='boolean'))return {state:'UNKNOWN' as const};
  if(row.kind!=='r'||row.persistence!=='p'||row.rls||row.forced||row.policies!==0||row.inheritance!==0||!row.ownerRights||!row.selectable||!row.insertable||!row.updatable||!row.deletable)
   return {state:'MISMATCH' as const,dimension:'relation_security_or_control_privileges' as const};
 }
 return Object.freeze({state:'SCOPED_MATCH' as const,coverage:'public_relation_kind_persistence_rls_policy_inheritance_control_role' as const,count:names.length,
  limitation:'serving_role_binding_not_proven' as const});
}
