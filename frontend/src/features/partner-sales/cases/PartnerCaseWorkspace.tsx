'use client';

import React from 'react';
import type { CustomerContractOutput, PartnerCaseView, PartnerCaseRuntimeRow } from '@sabalanerp/partner-sales-contracts';
import { RetailCollectionsPanel, type RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import { PartnerCaseDetail, type PartnerCaseActions } from './PartnerCaseDetail';
import { PartnerCorrectionPanel, type PartnerCorrectionStatus } from './PartnerCorrectionPanel';
import { ErpInlineState } from '@/components/erp';

export type PartnerCaseWorkspaceProps = {
  view: PartnerCaseView;
  customerOutput?: CustomerContractOutput;
  history?: PartnerCaseRuntimeRow['history'];
  accountingCorrectionRequests?: PartnerCaseRuntimeRow['accountingCorrectionRequests'];
  actions: PartnerCaseActions;
  collections?: RetailCollectionHistory;
  correction?: PartnerCorrectionStatus | null;
  correctionPending?: boolean;
  canRecordCollection?: boolean;
  onRecordCollection?: () => void;
  onReverseCollection?: (receiptId: string) => void;
  onRequestCorrection?: (scope: PartnerCorrectionStatus['scope']) => void;
  onSaveCorrection?: Parameters<typeof PartnerCorrectionPanel>[0]['onSave'];
};

export function PartnerCaseWorkspace({ view, actions, customerOutput, history, accountingCorrectionRequests, collections, correction, correctionPending = false,
  canRecordCollection = false, onRecordCollection, onReverseCollection, onRequestCorrection = () => undefined, onSaveCorrection = () => undefined }: PartnerCaseWorkspaceProps) {
  return <PartnerCaseDetail view={view} actions={actions} customerOutput={customerOutput} history={history}>
    {accountingCorrectionRequests?.map(request => <ErpInlineState key={request.id} kind="stale"
      title={<span>درخواست اصلاح سند داخلی سبلان: {request.reason}</span>}
      action={actions.canRequestCorrection ? { label: 'درخواست اصلاح پرونده',
        onClick: () => onRequestCorrection('SHARED') } : undefined} />)}
    <PartnerCaseSupplementary view={view} collections={collections} correction={correction}
      correctionPending={correctionPending} canRecordCollection={canRecordCollection} onRecordCollection={onRecordCollection} onReverseCollection={onReverseCollection}
      onRequestCorrection={onRequestCorrection} onSaveCorrection={onSaveCorrection} />
  </PartnerCaseDetail>;
}

export function PartnerCaseSupplementary({ view, collections, correction, correctionPending = false,
  canRecordCollection = false, onRecordCollection, onReverseCollection, onRequestCorrection = () => undefined, onSaveCorrection = () => undefined }:
  Omit<PartnerCaseWorkspaceProps, 'actions'>) {
  return <div className="space-y-5">
    {collections && <RetailCollectionsPanel history={collections} canRecord={canRecordCollection} onRecord={onRecordCollection} onReverse={onReverseCollection} />}
    {correction !== undefined && <PartnerCorrectionPanel view={view} correction={correction} pending={correctionPending}
      onRequest={onRequestCorrection} onSave={onSaveCorrection} />}
  </div>;
}
