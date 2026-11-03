import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {compileExactCandidatePending,exactCandidateMigrationNames} from '../protectedCandidateMigrationInventory';
import {readProtectedMigrationSources} from '../protectedMigrationHistory';
import {schemaWitnessSourceMap} from './protectedCandidateSchemaWitness';

test('extended witness selects pinned altered tables and declared trigger functions without claiming complete parsing',t=>{
 const files=readProtectedMigrationSources(path.resolve(process.cwd(),'backend/prisma/migrations'));
 const stages=compileExactCandidatePending(exactCandidateMigrationNames.map(name=>({name,bytes:files.get(name)!})));
 const maps=new Map(stages.map(stage=>[stage.name,schemaWitnessSourceMap(stage.name,files.get(stage.name)!.toString('utf8'),stage.statements)]));
 assert.equal(maps.size,14);
 assert.ok(maps.get('20261028093000_sales_invoice_evidence_constraints')!.tables.includes('sales_dispatch_invoices'));
 assert.ok(maps.get('20261028090000_sales_dispatch_invoices')!.functions.includes('protect_sales_dispatch_invoice'));
 assert.ok(maps.get('20261028090000_sales_dispatch_invoices')!.tables.includes('sales_dispatch_invoices'));
 const barrier=maps.get('20261019010000_customer_semantic_barrier')!;
 for(const table of ['accounting_customer_opening_reviews','accounting_customer_receipt_adjustments','accounting_customer_commands','accounting_customer_opening_attributions','accounting_customer_receipt_resolutions','accounting_treasury_transactions','accounting_check_instruments','accounting_check_instrument_events','accounting_settlement_allocation_lines'])assert.ok(barrier.tables.includes(table));
 assert.equal(barrier.tables.includes('public'),false);
 assert.equal(maps.get('20261028093000_sales_invoice_evidence_constraints')!.sourceMap,'BOUNDED_SQL_PATTERN_NOT_PARSER');
 t.diagnostic(JSON.stringify(Object.fromEntries(maps)));
});
