import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';
import {protectedCandidateCreatedColumns,protectedCandidateLaterProjection} from '../protectedCandidateLaterProjection';

test('schema-witness table selection records unqueried ALTER/CREATE targets',t=>{
 const gaps:Record<string,string[]>={},functions:Record<string,string[]>={},triggers:Record<string,string[]>={};
 for(const stage of exactCandidateMigrationNames){
  const sql=fs.readFileSync(path.resolve(process.cwd(),'backend/prisma/migrations',stage,'migration.sql'),'utf8');
  // Source map only; this bounded recognizer is not a SQL parser or authority.
  const touched=[...new Set([...sql.matchAll(/\b(?:ALTER|CREATE)\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]))];
  const queried=new Set([...protectedCandidateCreatedColumns.filter(x=>x.stage===stage).map(x=>x.table),
   ...(protectedCandidateLaterProjection.find(x=>x.name===stage)?.facts??[]).filter(x=>x.kind==='column').map(x=>x.object),
   ...(stage===exactCandidateMigrationNames[0]?['online_releases','online_runtime_slots','online_migration_steps']:[])]);
  const missing=touched.filter(table=>!queried.has(table));if(missing.length)gaps[stage]=missing;
  const declaredFunctions=[...sql.matchAll(/\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:(?:"public"|public)\.)?"?([A-Za-z_][A-Za-z0-9_]*)"?\s*\(/gi)].map(m=>m[1]);
  const declaredTriggers=[...sql.matchAll(/\bCREATE\s+(?:CONSTRAINT\s+)?TRIGGER\s+"?([A-Za-z_][A-Za-z0-9_]*)"?/gi)].map(m=>m[1]);
  if(declaredFunctions.length)functions[stage]=declaredFunctions;
  if(declaredTriggers.length)triggers[stage]=declaredTriggers;
 }
 assert.deepEqual(gaps['20261028093000_sales_invoice_evidence_constraints'],['sales_dispatch_invoices']);
 t.diagnostic(JSON.stringify({alterCreateTableCoverageGaps:gaps,unobservedFunctionDefinitions:functions,unobservedTriggerDefinitions:triggers}));
 // Presence of another gap does not falsify this test: the output is an
 // incomplete witness, not a certificate of all other SQL object coverage.
});
