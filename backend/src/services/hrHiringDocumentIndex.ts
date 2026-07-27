import { paperContractReviewState } from './hrEmploymentContract';

type Authority = string;

const identityTitle = (row: any) =>
  [row.category, row.side].filter(Boolean).join(' - ');

const restricted = (entry: any) => ({
  id: entry.id,
  title: entry.title,
  category: entry.category,
  version: entry.version,
  reviewStatus: entry.reviewStatus,
  safeOwner: entry.safeOwner,
  restricted: true,
  canOpen: false,
});

export const buildHiringDocumentIndex = (
  application: any,
  authorities: Set<Authority>
) => {
  const canHr = authorities.has('HR_PROCESSOR') || authorities.has('HR_MANAGER');
  const canCompanyManagement = authorities.has('COMPANY_MANAGER');
  const canFinance = authorities.has('FINANCE_RECORDER') || authorities.has('FINANCE_MANAGER');
  const entries: any[] = [];

  for (const row of application.preIdentityChecklistItems || []) {
    if (!row.originalName) continue;
    const entry = {
      id: row.id, title: row.title, category: 'PRE_IDENTITY', version: row.attempt,
      uploader: row.recordedBy, date: row.recordedAt || row.createdAt, reviewStatus: row.status,
      safeOwner: 'منابع انسانی', originalName: row.originalName,
      downloadKind: 'PRE_IDENTITY', canOpen: canHr, restricted: !canHr,
    };
    entries.push(canHr ? entry : restricted(entry));
  }

  for (const row of application.documents || []) {
    const entry = {
      id: row.id, title: identityTitle(row), category: 'IDENTITY', version: row.version,
      uploader: row.uploadedBy, date: row.createdAt, reviewStatus: row.status,
      safeOwner: 'منابع انسانی', originalName: row.originalName,
      downloadKind: 'DOCUMENT', canOpen: canHr, restricted: !canHr,
    };
    entries.push(canHr ? entry : restricted(entry));
  }
  for (const row of application.assessments || []) {
    const companySafe = row.assessmentType !== 'OTHER';
    const canOpenAssessment = canHr || (canCompanyManagement && companySafe);
    const entry = {
      id: row.id, title: `ارزیابی ${row.assessmentType}`, category: 'ASSESSMENT', version: row.version,
      uploader: row.recordedBy, date: row.recordedAt, reviewStatus: row.status,
      safeOwner: 'منابع انسانی', originalName: row.originalName,
      downloadKind: 'ASSESSMENT', canOpen: canOpenAssessment && Boolean(row.originalName), restricted: !canOpenAssessment,
    };
    entries.push(canOpenAssessment ? entry : restricted(entry));
  }
  for (const row of application.contracts || []) {
    const entry = {
      id: row.id, title: 'قرارداد استخدامی امضاشده', category: 'FINANCE_CONTRACT', version: row.version,
      uploader: row.uploadedBy, date: row.createdAt,
      reviewStatus: paperContractReviewState(row),
      safeOwner: 'امور مالی', originalName: row.originalName,
      downloadKind: 'CONTRACT', canOpen: canFinance, restricted: !canFinance,
    };
    entries.push(canFinance ? entry : restricted(entry));
  }
  for (const row of application.collateralItems || []) {
    if (row.originalName) {
      const entry = {
        id: row.id, title: `مدرک وثیقه ${row.type}`, category: 'FINANCE_COLLATERAL', version: row.version,
        uploader: row.recordedBy, date: row.createdAt, reviewStatus: row.status,
        safeOwner: 'امور مالی', originalName: row.originalName,
        downloadKind: 'COLLATERAL', canOpen: canFinance, restricted: !canFinance,
      };
      entries.push(canFinance ? entry : restricted(entry));
    }
    if (row.returnEvidenceOriginalName) {
      const returnEntry = {
        id: row.id, title: `مدرک بازگشت وثیقه ${row.type}`, category: 'FINANCE_COLLATERAL_RETURN', version: row.version,
        uploader: row.returnedBy, date: row.returnedAt, reviewStatus: row.returnConfirmedAt ? 'APPROVED' : 'SUBMITTED',
        safeOwner: 'امور مالی', originalName: row.returnEvidenceOriginalName,
        downloadKind: 'COLLATERAL_RETURN', canOpen: canFinance, restricted: !canFinance,
      };
      entries.push(canFinance ? returnEntry : restricted(returnEntry));
    }
  }
  return entries.sort((a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime());
};
