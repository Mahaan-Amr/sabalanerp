export type ApplicantInformationGroup =
  | 'PROFILE_IDENTITY'
  | 'EXPERIENCE_QUALIFICATIONS'
  | 'APPLICATION_ANSWERS'
  | 'DOCUMENT_EVIDENCE';

const GROUPS: ApplicantInformationGroup[] = [
  'PROFILE_IDENTITY',
  'EXPERIENCE_QUALIFICATIONS',
  'APPLICATION_ANSWERS',
  'DOCUMENT_EVIDENCE',
];

const persianDigits = '۰۱۲۳۴۵۶۷۸۹';
const arabicDigits = '٠١٢٣٤٥٦٧٨٩';

export const normalizeHiringRial = (input: unknown): string => {
  const raw = String(input ?? '').trim();
  if (!raw) return '';
  const normalized = [...raw]
    .map((character) => {
      const persianIndex = persianDigits.indexOf(character);
      if (persianIndex >= 0) return String(persianIndex);
      const arabicIndex = arabicDigits.indexOf(character);
      return arabicIndex >= 0 ? String(arabicIndex) : character;
    })
    .join('')
    .replace(/[٬,،\s]/g, '');
  if (!/^\d+$/.test(normalized)) throw new Error('Hiring amount must be a non-negative whole Rial value.');
  return normalized.replace(/^0+(?=\d)/, '');
};

export const normalizeCoveredHiringAmounts = <T extends Record<string, any>>(data: T): T => ({
  ...data,
  ...('desiredSalary' in data ? { desiredSalary: normalizeHiringRial(data.desiredSalary) } : {}),
  ...('workHistory' in data && Array.isArray(data.workHistory) ? { workHistory: data.workHistory
    ? data.workHistory.map((row: Record<string, any>) => ({
        ...row,
        ...('lastSalaryBenefits' in row ? { lastSalaryBenefits: normalizeHiringRial(row.lastSalaryBenefits) } : {}),
      }))
    : data.workHistory } : {}),
});

const revisionIdentity = (revision: any) => ({
  id: revision.id,
  revisionNumber: revision.revisionNumber,
  status: revision.status,
  submittedAt: revision.submittedAt,
});

const available = (key: ApplicantInformationGroup, value: Record<string, unknown>) => ({
  key,
  status: 'AVAILABLE' as const,
  ...value,
});

const restricted = (key: ApplicantInformationGroup) => ({
  key,
  status: 'RESTRICTED' as const,
  restrictionCode: 'FIELD_GROUP_PERMISSION_REQUIRED',
});

export const projectApplicantFullInformation = (
  source: any,
  permittedGroups: ReadonlySet<ApplicantInformationGroup>,
) => {
  const revisions = Array.isArray(source.formRevisions) ? source.formRevisions : [];
  const groups = GROUPS.map((key) => {
    if (!permittedGroups.has(key)) return restricted(key);
    if (key === 'PROFILE_IDENTITY') {
      return available(key, {
        revisions: revisions.map((revision: any) => {
          const data = revision.dataJson || {};
          return {
            ...revisionIdentity(revision),
            identity: {
              firstName: data.firstName ?? null,
              lastName: data.lastName ?? null,
              alias: data.alias ?? null,
              birthDate: data.birthDate ?? null,
              birthPlace: data.birthPlace ?? null,
              nationalCode: data.nationalCode ?? null,
              foreignIdentityType: data.foreignIdentityType ?? null,
              foreignIdentityNumber: data.foreignIdentityNumber ?? null,
            },
            contact: {
              mobile: data.mobile ?? null,
              homePhone: data.homePhone ?? null,
              email: data.email ?? null,
              socialMedia: data.socialMedia ?? null,
            },
            residence: {
              address: data.address ?? null,
              postalCode: data.postalCode ?? null,
            },
            family: {
              fatherName: data.fatherName ?? null,
              fatherOccupation: data.fatherOccupation ?? null,
              maritalStatus: data.maritalStatus ?? null,
              childrenCount: data.childrenCount ?? null,
              spouseOccupation: data.spouseOccupation ?? null,
            },
          };
        }),
      });
    }
    if (key === 'EXPERIENCE_QUALIFICATIONS') {
      return available(key, {
        revisions: revisions.map((revision: any) => ({
          ...revisionIdentity(revision),
          education: {
            educationLevel: revision.dataJson?.educationLevel ?? null,
            fieldOfStudy: revision.dataJson?.fieldOfStudy ?? null,
            graduationYear: revision.dataJson?.graduationYear ?? null,
          },
          workHistory: revision.dataJson?.workHistory ?? [],
          skills: revision.dataJson?.skills ?? [],
          languages: revision.dataJson?.languages ?? [],
          hasSocialSecurityHistory: source.candidate.hasSocialSecurityHistory,
        })),
      });
    }
    if (key === 'APPLICATION_ANSWERS') {
      return available(key, {
        revisions: revisions.map((revision: any) => ({
          ...revisionIdentity(revision),
          cooperationType: revision.dataJson?.cooperationType ?? null,
          cooperationDuration: revision.dataJson?.cooperationDuration ?? null,
          requestedPosition: revision.dataJson?.requestedPosition ?? null,
          desiredSalary: revision.dataJson?.desiredSalary ?? null,
          answers: revision.dataJson?.questions ?? [],
        })),
      });
    }
    return available(key, {
      documents: (source.documents || []).map((document: any) => ({
        id: document.id,
        category: document.category,
        side: document.side ?? undefined,
        customTitle: document.customTitle ?? undefined,
        version: document.version,
        status: document.status,
        inspectionSource: document.inspectionSource,
        originalName: document.originalName ?? undefined,
        note: document.note ?? undefined,
        verifiedAt: document.verifiedAt ?? undefined,
      })).map((document: Record<string, unknown>) => Object.fromEntries(Object.entries(document).filter(([, value]) => value !== undefined))),
      identityChecks: (source.identityChecks || []).map((check: any) => ({
        fieldKey: check.fieldKey,
        status: check.status,
        note: check.note,
        reviewedAt: check.reviewedAt,
      })),
      assessments: (source.assessments || []).map((assessment: any) => ({
        id: assessment.id,
        type: assessment.type,
        version: assessment.version,
        recordedAt: assessment.recordedAt,
        resultJson: assessment.resultJson,
        originalName: assessment.originalName,
      })),
      preIdentityEvidence: (source.preIdentityChecklistItems || []).map((item: any) => ({
        id: item.id,
        title: item.title,
        status: item.status,
        evidencePolicy: item.evidencePolicy,
        resultNote: item.resultNote,
        originalName: item.originalName,
        recordedAt: item.recordedAt,
      })),
    });
  });
  return {
    applicationId: source.id,
    candidateName: `${source.candidate.firstName} ${source.candidate.lastName}`.trim(),
    positionTitle: source.position?.title ?? null,
    groups,
  };
};

export const projectApplicantClosureSummary = (
  source: any,
  closureAudit: any,
  access: { canViewExplanation: boolean; actorDisplayName?: string | null },
) => {
  if (source.stage !== 'CLOSED' || !source.outcome || !closureAudit) return { available: false };
  const payload = closureAudit.payloadJson || {};
  return {
    available: true,
    outcome: payload.outcome || source.outcome,
    previousStage: source.preClosureStage ?? null,
    closedAt: new Date(closureAudit.createdAt).toISOString(),
    closedBy: access.actorDisplayName || closureAudit.actorUserId || 'SYSTEM',
    ...(access.canViewExplanation
      ? { explanation: payload.reason || source.outcomeReason || null, explanationRestricted: false }
      : { explanationRestricted: true }),
  };
};

export const buildCandidateClosedState = (source: any) => ({
  closed: true as const,
  outcome: source.outcome,
  candidateMessageCode: source.outcome === 'HIRED'
    ? 'APPLICATION_HIRED'
    : source.outcome === 'WITHDRAWN'
      ? 'APPLICATION_WITHDRAWN'
      : source.outcome === 'REQUEST_CANCELLED'
        ? 'APPLICATION_CANCELLED'
        : 'APPLICATION_NOT_SELECTED',
  positionTitle: source.position?.title ?? null,
});

const allowedReturnKeys = new Set([
  'archived',
  'attention',
  'phase',
  'outcome',
  'search',
  'positionId',
  'disposition',
  'sortBy',
  'sortDirection',
  'page',
  'view',
  'focus',
]);

export const validateApplicantReturnContext = (raw: unknown, applicationId: string) => {
  const fallback = `/dashboard/hr/hiring?focus=${encodeURIComponent(applicationId)}`;
  if (typeof raw !== 'string' || !raw.startsWith('/')) return fallback;
  try {
    const url = new URL(raw, 'https://sabalan.invalid');
    if (url.pathname !== '/dashboard/hr/hiring') return fallback;
    let containsUnknownKey = false;
    url.searchParams.forEach((_value, key) => {
      if (!allowedReturnKeys.has(key)) containsUnknownKey = true;
    });
    if (containsUnknownKey) return fallback;
    url.searchParams.set('focus', applicationId);
    return `${url.pathname}?${url.searchParams.toString()}`;
  } catch {
    return fallback;
  }
};
