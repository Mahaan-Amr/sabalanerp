import assert from 'node:assert/strict';
import {
  archiveRosterMembershipEnd,
  assertSubsequentEmploymentRelationship,
  personnelSearchTokens,
  personnelSearchWhere,
  resolveExistingPersonnelLink,
  type PersonnelLinkClient
} from '../hrPersonnelBoundary';

const client = (record: { id: string; user: { id: string } | null } | null) => {
  let calls = 0;
  return {
    personnel: {
      findUnique: async () => {
        calls += 1;
        return record;
      }
    },
    calls: () => calls
  };
};

const run = async () => {
  assert.deepEqual(personnelSearchTokens('  سليمان   رحيمي  '), ['سلیمان', 'رحیمی']);
  assert.deepEqual(personnelSearchWhere('سلیمان رحیمی'), {
    AND: ['سلیمان', 'رحیمی'].map((token) => ({ OR: [
      { firstName: { contains: token, mode: 'insensitive' } },
      { lastName: { contains: token, mode: 'insensitive' } },
      { employeeNumber: { contains: token, mode: 'insensitive' } },
      { nationalCode: { contains: token } }
    ] }))
  });
  assert.equal(personnelSearchWhere('   '), undefined);

  const archiveDate = new Date('2026-07-30T00:00:00.000Z');
  assert.equal(archiveRosterMembershipEnd(new Date('2026-01-01T00:00:00.000Z'), null, archiveDate)?.toISOString(), archiveDate.toISOString());
  assert.equal(archiveRosterMembershipEnd(new Date('2026-08-01T00:00:00.000Z'), null, archiveDate)?.toISOString(), '2026-08-01T00:00:00.000Z');
  assert.equal(archiveRosterMembershipEnd(new Date('2026-01-01T00:00:00.000Z'), new Date('2026-07-01T00:00:00.000Z'), archiveDate), null);

  assert.throws(() => assertSubsequentEmploymentRelationship(0), /پرونده جذب یا مسیر صریح ثبت استثنایی/);
  assert.doesNotThrow(() => assertSubsequentEmploymentRelationship(1));

  {
    const db = client(null);
    const result = await resolveExistingPersonnelLink(db as unknown as PersonnelLinkClient, { personnelId: null });
    assert.equal(result, null);
    assert.equal(db.calls(), 0);
  }

  {
    const db = client({ id: 'personnel-1', user: null });
    const result = await resolveExistingPersonnelLink(db as unknown as PersonnelLinkClient, { personnelId: 'personnel-1' });
    assert.equal(result, 'personnel-1');
    assert.equal(db.calls(), 1);
  }

  {
    const db = client({ id: 'personnel-1', user: { id: 'user-1' } });
    const result = await resolveExistingPersonnelLink(db as unknown as PersonnelLinkClient, { personnelId: 'personnel-1', currentUserId: 'user-1' });
    assert.equal(result, 'personnel-1');
  }

  {
    const db = client({ id: 'personnel-1', user: { id: 'user-2' } });
    await assert.rejects(
      resolveExistingPersonnelLink(db as unknown as PersonnelLinkClient, { personnelId: 'personnel-1', currentUserId: 'user-1' }),
      /قبلاً به کاربر دیگری متصل شده است/
    );
  }

  {
    const db = client(null);
    await assert.rejects(
      resolveExistingPersonnelLink(db as unknown as PersonnelLinkClient, { personnelId: 'missing' }),
      /پرسنل انتخاب‌شده پیدا نشد/
    );
  }
};

run().then(() => {
  console.log('HR personnel boundary tests passed.');
}).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
