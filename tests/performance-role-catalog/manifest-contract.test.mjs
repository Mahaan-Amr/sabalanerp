import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { manifestContentHash, validateRoleCatalogManifest } from '../../scripts/personnel-performance-role-catalog-contract.mjs';

const fixtureUrl = new URL('../../docs/specs/personnel-performance-role-catalog.synthetic.json', import.meta.url);

const loadFixture = async () => JSON.parse(await readFile(fixtureUrl, 'utf8'));

test('the synthetic role catalog satisfies the proposed v1 contract', async () => {
  assert.deepEqual(validateRoleCatalogManifest(await loadFixture()), []);
});

test('the contract rejects approval claims for synthetic or AI-authored content', async () => {
  const manifest = await loadFixture();
  manifest.review.status = 'APPROVED';

  assert.match(validateRoleCatalogManifest(manifest).join('\n'), /cannot be approved/i);
});

test('the contract rejects person-specific applicability and automatic grades', async () => {
  const manifest = await loadFixture();
  manifest.jobs[0].criteria[0].applicability = {
    fact: 'personnelId',
    operator: 'EQUALS',
    values: ['synthetic-personnel-1'],
  };
  manifest.jobs[0].criteria[0].evidencePolicy.automaticGrade = true;

  const errors = validateRoleCatalogManifest(manifest).join('\n');
  assert.match(errors, /controlled applicability fact/i);
  assert.match(errors, /automatic grade/i);
});

test('the applicability dictionary is versioned and fails closed on unknown facts', async () => {
  const manifest = await loadFixture();
  manifest.applicabilityDictionary[0].unknown = 'NOT_APPLICABLE_PENDING_REVIEW';
  delete manifest.applicabilityDictionary[1].sourceVersion;
  manifest.catalog.contentHash = manifestContentHash(manifest);

  const errors = validateRoleCatalogManifest(manifest).join('\n');
  assert.match(errors, /unknown must be BLOCK/i);
  assert.match(errors, /sourceVersion/i);
});

test('the producer snapshot contract carries versioned effective metadata', async () => {
  const manifest = await loadFixture();
  if (manifest.applicabilitySnapshotContract) delete manifest.applicabilitySnapshotContract.sourceVersions;
  manifest.catalog.contentHash = manifestContentHash(manifest);

  assert.match(validateRoleCatalogManifest(manifest).join('\n'), /sourceVersions/i);
});

test('typed applicability enforces v1 fact types and operator value shapes', async () => {
  const manifest = await loadFixture();
  const safetyRule = manifest.jobs[3].criteria[0].applicability;
  safetyRule.factType = 'STRING';
  safetyRule.values = ['true', 'false'];
  manifest.catalog.contentHash = manifestContentHash(manifest);

  const errors = validateRoleCatalogManifest(manifest).join('\n');
  assert.match(errors, /factType must match/i);
  assert.match(errors, /EQUALS requires exactly one/i);
});

test('the contract requires five Persian anchors for every judgment criterion', async () => {
  const manifest = await loadFixture();
  manifest.jobs[0].criteria[0].anchorsFa.pop();

  assert.match(validateRoleCatalogManifest(manifest).join('\n'), /five Persian anchors/i);
});

test('the contract enforces job/addendum composition limits', async () => {
  const manifest = await loadFixture();
  manifest.positions[0].composition = { jobWeight: 60, addendumWeight: 40 };

  const errors = validateRoleCatalogManifest(manifest).join('\n');
  assert.match(errors, /job weight must be at least 70/i);
  assert.match(errors, /addendum weight must not exceed 30/i);
});

test('the contract rejects content drift under a stable import identity', async () => {
  const manifest = await loadFixture();
  manifest.jobs[0].purposeFa = `${manifest.jobs[0].purposeFa} تغییر`;

  assert.match(validateRoleCatalogManifest(manifest).join('\n'), /content hash does not match/i);
});

test('the coverage contract keeps inventory, eligibility, readiness, cohort, and result counts separate', async () => {
  const manifest = await loadFixture();
  manifest.coverage.status = 'AVAILABLE';
  manifest.coverage.counts = {
    personnel: 4,
    employmentRelationships: 4,
    assignmentSections: 4,
    periodEligiblePersonnel: 4,
    structurallyReadyPersonnel: 3,
    cohortMembers: 2,
    acceptedResults: 1,
    badgesAvailable: 1,
  };
  manifest.catalog.contentHash = manifestContentHash(manifest);

  assert.deepEqual(validateRoleCatalogManifest(manifest), []);

  delete manifest.coverage.counts.assignmentSections;
  manifest.catalog.contentHash = manifestContentHash(manifest);
  assert.match(validateRoleCatalogManifest(manifest).join('\n'), /assignmentSections/i);
});
