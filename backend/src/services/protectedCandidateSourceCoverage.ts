import {candidateStageWitness} from './protectedCandidateStageWitness';
import {compileExactCandidatePending} from './protectedCandidateMigrationInventory';

/** Review-limited map for these exact 14 SQL byte strings. No generic SQL
 * parser, database evidence or permission to execute is provided here. */
export function checkCandidateSourceCoverage(files:ReadonlyMap<string,Buffer>){
 try{
  const plan=compileExactCandidatePending(candidateStageWitness.stages.map(stage=>({name:stage.name,bytes:files.get(stage.name)!})));
  for(const [index,stage] of plan.entries()){
   const source=files.get(stage.name)!.toString('utf8'),coverage=candidateStageWitness.stages[index].coverage;
   if(stage.name!==candidateStageWitness.stages[index].name||stage.sha256!==candidateStageWitness.stages[index].sqlSha256)return {state:'UNKNOWN' as const};
   const directTables=[...source.matchAll(/\b(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]);
   const functions=[...source.matchAll(/\b(?:CREATE\s+(?:OR\s+REPLACE\s+)?|ALTER\s+|DROP\s+)FUNCTION\s+(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi)].map(m=>m[1]);
   const indexes=[...source.matchAll(/\bCREATE\s+(?:UNIQUE\s+)?INDEX\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]);
   const directTriggerTables=stage.statements.flatMap(statement=>[...statement.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?[A-Za-z_][A-Za-z0-9_]*"?[\s\S]*?\bON\s+(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1])).filter(name=>name!=='public');
   if(directTables.some(name=>!coverage.tables.includes(name as never))||functions.some(name=>!coverage.functions.includes(name as never))||indexes.some(name=>!coverage.indexes.includes(name as never))||directTriggerTables.some(name=>!coverage.tables.includes(name as never)))return {state:'UNKNOWN' as const};
   const dynamic=[...source.matchAll(/\bEXECUTE\s+format\s*\(/gi)].length;
   if(stage.name==='20261019010000_customer_semantic_barrier'){
    const targets=['accounting_customer_opening_reviews','accounting_customer_receipt_adjustments','accounting_customer_commands','accounting_customer_opening_attributions',
     'accounting_customer_receipt_resolutions','accounting_treasury_transactions','accounting_check_instruments','accounting_check_instrument_events','accounting_settlement_allocation_lines'];
    if(dynamic!==4||targets.some(name=>!source.includes(`'${name}'`)||!coverage.tables.includes(name as never)))return {state:'UNKNOWN' as const};
   }else if(dynamic!==0)return {state:'UNKNOWN' as const};
  }
  return Object.freeze({state:'SCOPED_MATCH' as const,coverage:'PINNED_14_DECLARED_DDL_AND_KNOWN_DYNAMIC_TRIGGER_TARGETS' as const,
   limitation:'FUNCTION_DATA_DEPENDENCIES_AND_RUNTIME_AUTHORITY_ARE_SEPARATE' as const});
 }catch{return {state:'UNKNOWN' as const};}
}
