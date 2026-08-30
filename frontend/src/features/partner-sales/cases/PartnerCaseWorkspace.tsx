'use client';

import React from 'react';
import type { PartnerAccountView, PartnerCaseView } from '@sabalanerp/partner-sales-contracts';
import { PartnerAccountPanel } from '../account/PartnerAccountPanel';
import { RetailCollectionsPanel, type RetailCollectionHistory } from '../collections/RetailCollectionsPanel';
import { PartnerCaseDetail, type PartnerCaseActions } from './PartnerCaseDetail';
import { PartnerCorrectionPanel, type PartnerCorrectionStatus } from './PartnerCorrectionPanel';

export type PartnerCaseWorkspaceProps = {
  view: PartnerCaseView;
  actions: PartnerCaseActions;
  account?: PartnerAccountView;
  collections?: RetailCollectionHistory;
  correction?: PartnerCorrectionStatus | null;
  correctionPending?: boolean;
  canRecordCollection?: boolean;
  onRecordCollection?: () => void;
  onRequestCorrection?: (scope: PartnerCorrectionStatus['scope']) => void;
  onSaveCorrection?: Parameters<typeof PartnerCorrectionPanel>[0]['onSave'];
};

export function PartnerCaseWorkspace({ view, actions, account, collections, correction, correctionPending = false,
  canRecordCollection = false, onRecordCollection, onRequestCorrection = () => undefined, onSaveCorrection = () => undefined }: PartnerCaseWorkspaceProps) {
  return <PartnerCaseDetail view={view} actions={actions}>
    <PartnerCaseSupplementary view={view} account={account} collections={collections} correction={correction}
      correctionPending={correctionPending} canRecordCollection={canRecordCollection} onRecordCollection={onRecordCollection}
      onRequestCorrection={onRequestCorrection} onSaveCorrection={onSaveCorrection} />
  </PartnerCaseDetail>;
}

export function PartnerCaseSupplementary({ view, account, collections, correction, correctionPending = false,
  canRecordCollection = false, onRecordCollection, onRequestCorrection = () => undefined, onSaveCorrection = () => undefined }:
  Omit<PartnerCaseWorkspaceProps, 'actions'>) {
  return <div className="space-y-5">
    {collections && <RetailCollectionsPanel history={collections} canRecord={canRecordCollection} onRecord={onRecordCollection} />}
    {correction !== undefined && <PartnerCorrectionPanel view={view} correction={correction} pending={correctionPending}
      onRequest={onRequestCorrection} onSave={onSaveCorrection} />}
    {account && <PartnerAccountPanel view={account} />}
  </div>;
}
