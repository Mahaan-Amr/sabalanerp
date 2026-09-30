import assert from 'node:assert/strict';
import test from 'node:test';
import { prisma } from '../../lib/prisma';
import { readPartnerSnapshot } from '../partnerSales/authorization/readSnapshot';
import { lockPartnerOperationsControl, PARTNER_OPERATIONS_CONTROL_ID } from '../partnerSales/authorization/technicalRollout';

const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

test('Partner read snapshots coexist while a writer waits for their shared boundary', async () => {
  const control = await prisma.partnerOperationsControl.findUnique({ where: { id: PARTNER_OPERATIONS_CONTROL_ID } });
  assert.ok(control, 'local Partner control row is required for lock verification');
  let releaseFirst!: () => void;
  const held = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstEntered!: () => void;
  const firstStarted = new Promise<void>(resolve => { firstEntered = resolve; });
  let secondEntered = false;
  let writerEntered = false;

  const first = readPartnerSnapshot(prisma, async () => { firstEntered(); await held; });
  await firstStarted;
  const second = readPartnerSnapshot(prisma, async () => { secondEntered = true; });
  let writer: Promise<void> | null = null;
  try {
    await pause(300);
    assert.equal(secondEntered, true, 'a second authorized reader should not queue behind the first reader');
    writer = prisma.$transaction(async tx => {
      await lockPartnerOperationsControl(tx);
      writerEntered = true;
    });
    await pause(100);
    assert.equal(writerEntered, false, 'a writer must wait until the first read snapshot finishes');
  } finally {
    releaseFirst();
    await Promise.all([first, second, ...(writer ? [writer] : [])]);
  }
  assert.equal(writerEntered, true);
});
