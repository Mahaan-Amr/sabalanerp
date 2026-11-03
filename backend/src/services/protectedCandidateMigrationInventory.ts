/** Candidate-specific identification only. No deployment authority is granted. */
import {createHash} from 'node:crypto';
const definitions = [
  ['20261014140000_online_deployment_control','872f0f0858473546cee56b836fa64c95d668997304ae462ac2c18428e69f4cb2'],
  ['20261019010000_customer_semantic_barrier','f21138c410c8653d8fcfc46b266c4ae91e82385adb0263fa0696bad9fa36ce55'],
  ['20261019020000_hr_versioned_file_cleanup','cb25c720d02d37ad036c95583ef9ba1ba7856bcd483a62ef1c8e03930947b9a9'],
  ['20261020010000_online_realtime_completion','f92e8c7dca2ef0c1798275c0e3fe3d1735aec67ef52875dd4df3fed4744df181'],
  ['20261020093000_online_serving_epochs','7f4b2b3dc5f7084047409e7c59d29b8667d37a85d33920e95bc7a8f37f48eb9c'],
  ['20261021120000_attendance_effective_rest_windows','5f01ad2761a2464e85ad1f4827e7613dda22db8a8f3d9112492aea4914fb4700'],
  ['20261025120000_preserve_exact_fulfillment_quantities','07086e6738ba752d96358e8491b00528827cb5c8af1544f4fc34fe7828974955'],
  ['20261028090000_sales_dispatch_invoices','7ae25295e7ad168a8481dc350a8bd6cc677fc2a869ad4c934503fc7b41821c66'],
  ['20261028093000_sales_invoice_evidence_constraints','7f02ab81a3c9aeee1f04455ff7a8e7d223f3de9fb4dd472036871e121685a719'],
  ['20261028100000_sales_invoice_correction_evidence','351034a7c0584e26ee149567f57f9e86bdaeeeba0325ff870a2ffaacf46dfbec'],
  ['20261031130000_purchasing_operational_workspace','16f16342572d47dee3627a27609666008619e9b748843b63d8bfb14a7e2689c5'],
  ['20261101160000_supply_chain_exact_purchase_quantities','3060d9534e03fbfa4191fe7755bc4121c207b0f43cae051e942414d945dc1dad'],
  ['20261101170000_purchasing_private_attachments','6c564dffad127a402ca6bbec87e57695d501b4f2b7b87427d6fd16e3e7ee84a9'],
  ['20261102120000_accounting_financial_approval_receipts','d8ee324f20554891f7b276725326f07ac22658cf8180af0d70baf95f9e54f378'],
] as const;
export const exactCandidateMigrationNames: readonly string[]=Object.freeze(definitions.map(([name])=>name));
export const exactCandidateMigrationDigests: Readonly<Record<string,string>>=Object.freeze(Object.fromEntries(definitions));
const expectedStatementCounts=Object.freeze([29,1,1,10,5,4,34,8,1,3,30,8,4,1]);
export const exactCandidatePlanSha256=createHash('sha256').update(JSON.stringify(definitions)).digest('hex');
function invalid(code:string):never { throw Object.assign(new Error(code),{code}); }
export function candidateNeedsPreflight(pending:readonly string[],sourceNames:readonly string[]):boolean {
 if(!Array.isArray(pending)||!Array.isArray(sourceNames)||pending.some(name=>typeof name!=='string')||sourceNames.some(name=>typeof name!=='string'))invalid('CANDIDATE_PENDING_SET_UNPROVEN');
 // Without an independently bound manifest, an incomplete candidate cannot
 // be distinguished from a legacy release. Refuse both paths rather than
 // treating absence of files as proof of legacy identity.
 // Presence selects a stricter verification path, never grants identity.
 // This includes fully applied candidates with no pending SQL.
 return [...pending,...sourceNames].some(name=>Object.prototype.hasOwnProperty.call(exactCandidateMigrationDigests,name));
}
export function assertNoPendingHasPreflightRoute(pending:readonly string[],sourceNames:readonly string[]):void {
 if(!candidateNeedsPreflight(pending,sourceNames)&&pending.length===0)invalid('PROTECTED_MIGRATION_SOURCE_IDENTITY_UNPROVEN');
}
/** Parse all inputs before any DDL. This does not authorize or execute SQL. */
export function compileExactCandidatePending(files:readonly {name:string;bytes:Buffer}[]) {
 if(!Array.isArray(files)||files.length!==definitions.length)invalid('CANDIDATE_PENDING_SET_UNPROVEN');
 return Object.freeze(files.map((file,i)=>{
  const [name,expected]=definitions[i];
  if(!file||file.name!==name||!Buffer.isBuffer(file.bytes)||createHash('sha256').update(file.bytes).digest('hex')!==expected)invalid('CANDIDATE_PENDING_IDENTITY_UNPROVEN');
  const statements=splitPinnedSql(file.bytes.toString('utf8'));
  if(statements.length!==expectedStatementCounts[i])invalid('CANDIDATE_STATEMENT_BOUNDARY_UNPROVEN');
  return Object.freeze({name,sha256:expected,statements:Object.freeze(statements)});
 }));
}
/**
 * Pure consistency check only: caller must obtain rows, original owned receipts
 * and independently measured current catalog under the same real lease and
 * checkpoint transaction. Caller-supplied objects are not proof of authority.
 * Catalog projections must account for reviewed successor schema evolution;
 * unverified/missing projections fail closed.
 */
type CandidateReceiptRow={name:string;checksum:string;finished:boolean;rolledBack:boolean;receipt:{format:string;planSha256:string;sqlSha256:string;checkpointSha256:string;beforeScopedProjectionSha256:string;afterScopedProjectionSha256:string}};
export function validateCandidateReceiptPrefix(rows:readonly CandidateReceiptRow[],checkpointSha256:string):string|null {
 if(!Array.isArray(rows)||rows.length>definitions.length)invalid('CANDIDATE_RESUME_HISTORY_UNPROVEN');
 if(!/^[a-f0-9]{64}$/.test(checkpointSha256))invalid('CANDIDATE_RESUME_CONTEXT_UNPROVEN');
 for(let i=0;i<rows.length;i++){
  const row=rows[i], [name,sha256]=definitions[i];
  if(!row||row.name!==name||row.checksum!==sha256||row.finished!==true||row.rolledBack!==false||
     !row.receipt||Object.keys(row.receipt).sort().join(',')!==['afterScopedProjectionSha256','beforeScopedProjectionSha256','checkpointSha256','format','planSha256','sqlSha256'].sort().join(',')||
     row.receipt.format!=='sabalan-owned-candidate-migration/v2'||row.receipt.planSha256!==exactCandidatePlanSha256||
     row.receipt.sqlSha256!==sha256||row.receipt.checkpointSha256!==checkpointSha256||
     !/^[a-f0-9]{64}$/.test(row.receipt.beforeScopedProjectionSha256)||!/^[a-f0-9]{64}$/.test(row.receipt.afterScopedProjectionSha256)||
     (i>0&&row.receipt.beforeScopedProjectionSha256!==rows[i-1].receipt.afterScopedProjectionSha256))invalid('CANDIDATE_RESUME_RECEIPT_UNPROVEN');
 }
 return rows.length?rows[rows.length-1].receipt.afterScopedProjectionSha256:null;
}
export function deriveCandidateResumeIndex(rows:readonly CandidateReceiptRow[],currentCatalogSha256:string,checkpointSha256:string):number {
 if(!/^[a-f0-9]{64}$/.test(currentCatalogSha256))invalid('CANDIDATE_RESUME_CONTEXT_UNPROVEN');
 const last=validateCandidateReceiptPrefix(rows,checkpointSha256);
 if(last!==null&&last!==currentCatalogSha256)invalid('CANDIDATE_RESUME_CATALOG_CHANGED');
 return rows.length;
}
/** Lexical statement splitting after byte identity: preserve literals, comments and dollar bodies. */
function splitPinnedSql(sql:string):string[] {
 const result:string[]=[];let start=0,i=0,state:'plain'|'single'|'double'|'line'|'block'|'dollar'='plain',depth=0,tag='';
 while(i<sql.length){const a=sql[i],b=sql[i+1];
  if(state==='line'){if(a==='\n')state='plain';i++;continue;}
  if(state==='block'){if(a==='/'&&b==='*'){depth++;i+=2;continue;}if(a==='*'&&b==='/'){if(--depth===0)state='plain';i+=2;continue;}i++;continue;}
  if(state==='single'){if(a==="'"&&b==="'"){i+=2;continue;}if(a==="'")state='plain';i++;continue;}
  if(state==='double'){if(a==='"'&&b==='"'){i+=2;continue;}if(a==='"')state='plain';i++;continue;}
  if(state==='dollar'){if(sql.startsWith(tag,i)){i+=tag.length;state='plain';}else i++;continue;}
  if(a==='-'&&b==='-'){state='line';i+=2;continue;}
  if(a==='/'&&b==='*'){state='block';depth=1;i+=2;continue;}
  if(a==="'"){state='single';i++;continue;}
  if(a==='"'){state='double';i++;continue;}
  if(a==='$'){const m=/^\$(?:[a-zA-Z_][a-zA-Z_0-9]*)?\$/.exec(sql.slice(i));if(m){tag=m[0];state='dollar';i+=tag.length;continue;}}
  if(a===';'){const value=sql.slice(start,i+1).trim();if(value)result.push(value);start=i+1;}i++;
 }
 if(!['plain','line'].includes(state))invalid('CANDIDATE_SQL_LEXICAL_UNPROVEN');
 const rest=sql.slice(start).replace(/--[^\r\n]*/g,'').trim();if(rest)invalid('CANDIDATE_SQL_TRAILING_UNPROVEN');
 if(result.length===0)invalid('CANDIDATE_SQL_EMPTY');return result;
}
