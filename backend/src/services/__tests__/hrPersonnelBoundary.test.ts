import assert from 'node:assert/strict';
import { resolveExistingPersonnelLink, type PersonnelLinkClient } from '../hrPersonnelBoundary';

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
