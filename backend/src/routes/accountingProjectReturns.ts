import { Prisma } from '@prisma/client';
import express from 'express';
import { prisma } from '../lib/prisma';
import { StoneReturnAllocationError } from '../services/stoneReturnAllocationRules';
import { openProjectReturnCorrection, returnProjectReturnCorrection } from '../services/projectReturnCorrections';
import { changeProjectReturnOperation, readProjectReturnOperationalState } from '../services/projectReturnOperations';
import { projectReturnId } from '../services/projectReturnReceipts';
import {
  listProjectReturnAllocationReviews, readProjectReturnAllocationReview, saveProjectReturnAllocationDraft,
} from '../services/projectReturnAllocations';
import { accountingStoneReturnsEdit, accountingStoneReturnsView, hasStoneReturnEditAccess, stoneReturnEndpoint } from './stoneReturns';

const router = express.Router();
const readOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 30_000 };

router.get('/', ...accountingStoneReturnsView, stoneReturnEndpoint(async req => ({
  ...await prisma.$transaction(tx => listProjectReturnAllocationReviews(tx,
    req.query.after === undefined ? undefined : projectReturnId(req.query.after, 'صفحه')), readOptions),
  canAllocate: hasStoneReturnEditAccess(req),
})));
router.post('/legacy/:id/correction', ...accountingStoneReturnsEdit, stoneReturnEndpoint(req =>
  openProjectReturnCorrection(prisma, req.params.id, req.user!.id)));
router.post('/:id/correction/return', ...accountingStoneReturnsEdit, stoneReturnEndpoint(req =>
  returnProjectReturnCorrection(prisma, req.params.id, req.user!.id, req.body?.expectedVersionId, req.body?.expectedDraftNumber)));
router.get('/:id', ...accountingStoneReturnsView, stoneReturnEndpoint(async req => ({
  ...await prisma.$transaction(async tx => {
    const review = await readProjectReturnAllocationReview(tx, req.params.id);
    return { ...review, operational: await readProjectReturnOperationalState(tx, review.receipt) };
  }, readOptions),
  canAllocate: hasStoneReturnEditAccess(req),
})));
router.post('/:id/return-to-logistics', ...accountingStoneReturnsEdit, stoneReturnEndpoint(async req => {
  await changeProjectReturnOperation(prisma, req.params.id, req.user!.id, 'return-to-logistics', req.body ?? {});
  return prisma.$transaction(async tx => ({
    ...await readProjectReturnAllocationReview(tx, req.params.id), operational: null, canAllocate: true,
  }), readOptions);
}));
router.put('/:id/allocations', ...accountingStoneReturnsEdit, stoneReturnEndpoint(async req => ({
  ...await saveProjectReturnAllocationDraft(prisma, req.params.id, req.user!.id, req.body),
  canAllocate: true,
})));
router.post('/:id/finalize', ...accountingStoneReturnsEdit, stoneReturnEndpoint(async req => {
  const review = await prisma.$transaction(tx => readProjectReturnAllocationReview(tx, req.params.id), readOptions);
  throw new StoneReturnAllocationError(409, review.postingBlock.message);
}));

export default router;
