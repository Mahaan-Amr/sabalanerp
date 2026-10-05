import assert from 'node:assert/strict';
import type { PrismaClient } from '@prisma/client';
import { currentPersonnelAssignmentWhere, loadCurrentPersonnelUnits } from '../hrPersonnelUnits';
import { buildPersonnelCollection } from '../hrPersonnelCollection';

async function main() {
  const at = new Date('2026-10-05T08:00:00Z');
  const where = currentPersonnelAssignmentWhere(['shared'], at);
  assert.deepEqual(where.effectiveFrom, { lte: at });
  assert.deepEqual(where.OR, [{ effectiveTo: null }, { effectiveTo: { gte: at } }]);
  assert.deepEqual(where.employmentRelationship, {
    personnelId: { in: ['shared'] }, status: { in: ['ACTIVE', 'SUSPENDED'] },
    effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gte: at } }],
  });
  assert.equal(where.type, undefined, 'all current assignment types participate');
  const people = Array.from({ length: 12 }, (_, i) => ({ id: `p${i}`, firstName: 'نام', lastName: String(i) }));
  const assignments = [
    ...people.map(person => ({ organizationalUnit: { id: 'sales', name: 'فروش' }, employmentRelationship: { personnelId: person.id } })),
    { organizationalUnit: { id: 'sales', name: 'فروش' }, employmentRelationship: { personnelId: 'p0' } },
    { organizationalUnit: { id: 'warehouse', name: 'انبار' }, employmentRelationship: { personnelId: 'p0' } },
  ];
  const client = { hrEmploymentAssignment: { findMany: async (query: any) => {
    assert.deepEqual(query.where, currentPersonnelAssignmentWhere(people.map(p => p.id), at));
    return assignments;
  } } } as unknown as PrismaClient;
  const units = await loadCurrentPersonnelUnits(client, people.map(p => p.id), at);
  assert.deepEqual(units.map(u => u.name), ['انبار', 'فروش']);
  assert.equal(units[1].personnelIds.size, 12, 'duplicate assignments do not duplicate personnel');
  assert(units.every(u => u.personnelIds.has('p0')), 'one person belongs to both units');
  const filtered = people.filter(p => units[1].personnelIds.has(p.id));
  assert.equal(buildPersonnelCollection(filtered, { page: 2 }).rows.length, 2, 'unit filtering precedes pagination');
  assert.deepEqual(await loadCurrentPersonnelUnits(client, [], at), []);
  console.log('Current personnel unit tests passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
