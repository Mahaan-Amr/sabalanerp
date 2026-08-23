import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { applicantOtpHash, encryptApplicantOtp } from "../services/hrCandidateAccess";

const prisma = new PrismaClient();

const fixture = {
  userEmail: "hr.processor.e2e@sabalanerp.test",
  username: "hr_processor_e2e",
  password: "HrE2ePass123!",
  mobile: "09120000001",
  otp: "123456",
  applicationId: "hr-e2e-application",
  releaseApplicationId: "hr-e2e-release-application",
  blockedApplicationId: "hr-e2e-blocked-application",
  interviewApplicationId: "hr-e2e-interview-application",
  candidateId: "hr-e2e-candidate",
  releaseCandidateId: "hr-e2e-release-candidate",
  interviewCandidateId: "hr-e2e-interview-candidate",
  invitationId: "hr-e2e-invitation",
  unitId: "hr-e2e-unit",
  jobId: "hr-e2e-job",
  positionId: "hr-e2e-position",
  financeRecorderEmail: "finance.recorder.e2e@sabalanerp.test",
  financeManagerEmail: "finance.manager.e2e@sabalanerp.test",
};

const plusDays = (days: number) =>
  new Date(Date.now() + days * 24 * 60 * 60 * 1000);

async function main() {
  const password = await bcrypt.hash(fixture.password, 12);
  const user = await prisma.user.upsert({
    where: { email: fixture.userEmail },
    update: {
      username: fixture.username,
      password,
      firstName: "کارشناس",
      lastName: "آزمایشی منابع انسانی",
      role: "USER",
      isActive: true,
      mustChangePassword: false,
    },
    create: {
      email: fixture.userEmail,
      username: fixture.username,
      password,
      firstName: "کارشناس",
      lastName: "آزمایشی منابع انسانی",
      role: "USER",
      isActive: true,
      mustChangePassword: false,
      creationSource: "SYSTEM_SEEDED",
    },
  });
  const [financeRecorder, financeManager] = await Promise.all([
    { email: fixture.financeRecorderEmail, username: "finance_recorder_e2e", firstName: "ثبت‌کننده", lastName: "مالی" },
    { email: fixture.financeManagerEmail, username: "finance_manager_e2e", firstName: "مدیر", lastName: "مالی" },
  ].map((financeUser) => prisma.user.upsert({
    where: { email: financeUser.email },
    update: { ...financeUser, password, role: "USER", isActive: true, mustChangePassword: false },
    create: { ...financeUser, password, role: "USER", isActive: true, mustChangePassword: false, creationSource: "SYSTEM_SEEDED" },
  })));
  for (const financeUser of [financeRecorder, financeManager]) {
    await prisma.workspacePermission.upsert({
      where: { userId_workspace: { userId: financeUser.id, workspace: "accounting" } },
      update: { permissionLevel: "edit", isActive: true },
      create: { userId: financeUser.id, workspace: "accounting", permissionLevel: "edit", isActive: true, grantedBy: user.id },
    });
  }

  await prisma.workspacePermission.upsert({
    where: { userId_workspace: { userId: user.id, workspace: "hr" } },
    update: { permissionLevel: "edit", isActive: true },
    create: {
      userId: user.id,
      workspace: "hr",
      permissionLevel: "edit",
      isActive: true,
    },
  });
  await prisma.hrHiringAuthority.upsert({
    where: {
      userId_authority: {
        userId: user.id,
        authority: "HR_PROCESSOR",
      },
    },
    update: { isActive: true },
    create: {
      userId: user.id,
      authority: "HR_PROCESSOR",
      createdBy: user.id,
    },
  });

  const authorizationEffectiveFrom = new Date("2026-01-01T00:00:00.000Z");
  await prisma.hrWorkspaceCatalog.upsert({
    where: { code: "HUMAN_RESOURCES" },
    update: { isActive: true },
    create: { code: "HUMAN_RESOURCES", displayName: "Human Resources" },
  });
  await prisma.hrFeatureCatalog.upsert({
    where: { code: "RECRUITMENT_CASES" },
    update: { workspaceCode: "HUMAN_RESOURCES", isActive: true },
    create: { code: "RECRUITMENT_CASES", workspaceCode: "HUMAN_RESOURCES", displayName: "Recruitment Cases" },
  });
  for (const feature of [
    { code: "VIEW_INITIAL_INTERVIEW_CRITERIA", displayName: "View Initial Interview Criteria" },
    { code: "RECORD_INITIAL_INTERVIEW", displayName: "Record Initial Interview" },
    { code: "VIEW_FULL_APPLICANT_INFORMATION", displayName: "View Full Applicant Information" },
    { code: "VIEW_INITIAL_INTERVIEW_REPORT", displayName: "View Initial Interview Report" },
    { code: "VIEW_COMPANY_EVALUATION_RESULTS", displayName: "View Company Evaluation Results" },
    { code: "RECORD_COMPANY_EVALUATION_RESULT", displayName: "Record Company Evaluation Result" },
    { code: "MANAGE_RECRUITMENT_CASE", displayName: "Manage Recruitment Case" },
    { code: "PERSONNEL", displayName: "Personnel" },
    { code: "MANAGE_PERSONNEL_SCHEDULE", displayName: "Manage Personnel Schedule" },
    { code: "MANAGE_FINANCE_EVIDENCE", displayName: "Manage Finance Evidence" },
    { code: "REVIEW_IDENTITY_DOCUMENTS", displayName: "Review Identity Documents" },
    { code: "RECORD_COLLATERAL_CUSTODY", displayName: "Record Collateral Custody" },
    { code: "VERIFY_COLLATERAL_CUSTODY", displayName: "Verify Collateral Custody" },
    { code: "RECORD_SIGNED_EMPLOYMENT_CONTRACT", displayName: "Record Signed Employment Contract" },
    { code: "VERIFY_SIGNED_EMPLOYMENT_CONTRACT", displayName: "Verify Signed Employment Contract" },
  ]) {
    await prisma.hrFeatureCatalog.upsert({
      where: { code: feature.code },
      update: { workspaceCode: "HUMAN_RESOURCES", isActive: true },
      create: { ...feature, workspaceCode: "HUMAN_RESOURCES" },
    });
  }
  for (const [financeUser, featureCodes] of [
    [financeRecorder, ["RECORD_COLLATERAL_CUSTODY"]],
    [financeManager, ["VERIFY_COLLATERAL_CUSTODY", "VERIFY_SIGNED_EMPLOYMENT_CONTRACT"]],
  ] as const) {
    for (const featureCode of featureCodes) {
    await prisma.hrFeatureAccessGrant.upsert({
      where: { stableKey: `hr-e2e:feature:${financeUser.id}:${featureCode}` },
      update: { level: "EDIT", status: "ACTIVE", effectiveTo: null },
      create: {
        stableKey: `hr-e2e:feature:${financeUser.id}:${featureCode}`, userId: financeUser.id,
        featureCode, level: "EDIT", effectiveFrom: authorizationEffectiveFrom,
        grantedByUserId: user.id, reason: "Accounting-only hiring Finance E2E fixture",
      },
    });
    }
  }
  await prisma.hrFeatureCatalog.upsert({
    where: { code: "ORGANIZATIONAL_STRUCTURE" },
    update: { workspaceCode: "HUMAN_RESOURCES", isActive: true },
    create: { code: "ORGANIZATIONAL_STRUCTURE", workspaceCode: "HUMAN_RESOURCES", displayName: "Organizational Structure" },
  });
  await prisma.hrAuthorityCatalog.upsert({
    where: { code: "HR_PROCESSOR" },
    update: { isActive: true },
    create: { code: "HR_PROCESSOR", displayName: "HR Processor" },
  });
  await prisma.hrResponsibilityTypeCatalog.upsert({
    where: { code: "HR_PROCESSOR" },
    update: { isActive: true },
    create: { code: "HR_PROCESSOR", displayName: "HR Processor" },
  });
  await prisma.hrWorkspaceAccessGrant.upsert({
    where: { stableKey: `hr-e2e:workspace:${user.id}:HUMAN_RESOURCES` },
    update: { level: "EDIT", status: "ACTIVE", effectiveTo: null },
    create: {
      stableKey: `hr-e2e:workspace:${user.id}:HUMAN_RESOURCES`,
      userId: user.id,
      workspaceCode: "HUMAN_RESOURCES",
      level: "EDIT",
      effectiveFrom: authorizationEffectiveFrom,
      grantedByUserId: user.id,
      reason: "HR hiring E2E fixture",
    },
  });
  await prisma.hrFeatureAccessGrant.upsert({
    where: { stableKey: `hr-e2e:feature:${user.id}:RECRUITMENT_CASES` },
    update: { level: "EDIT", status: "ACTIVE", effectiveTo: null },
    create: {
      stableKey: `hr-e2e:feature:${user.id}:RECRUITMENT_CASES`,
      userId: user.id,
      featureCode: "RECRUITMENT_CASES",
      level: "EDIT",
      effectiveFrom: authorizationEffectiveFrom,
      grantedByUserId: user.id,
      reason: "HR hiring E2E fixture",
    },
  });
  for (const feature of [
    { code: "VIEW_INITIAL_INTERVIEW_CRITERIA", level: "VIEW" as const },
    { code: "RECORD_INITIAL_INTERVIEW", level: "EDIT" as const },
    { code: "VIEW_FULL_APPLICANT_INFORMATION", level: "VIEW" as const },
    { code: "VIEW_INITIAL_INTERVIEW_REPORT", level: "VIEW" as const },
    { code: "VIEW_COMPANY_EVALUATION_RESULTS", level: "VIEW" as const },
    { code: "RECORD_COMPANY_EVALUATION_RESULT", level: "EDIT" as const },
    { code: "MANAGE_RECRUITMENT_CASE", level: "EDIT" as const },
    { code: "PERSONNEL", level: "EDIT" as const },
    { code: "MANAGE_PERSONNEL_SCHEDULE", level: "EDIT" as const },
    { code: "REVIEW_IDENTITY_DOCUMENTS", level: "EDIT" as const },
  ]) {
    await prisma.hrFeatureAccessGrant.upsert({
      where: { stableKey: `hr-e2e:feature:${user.id}:${feature.code}` },
      update: { level: feature.level, status: "ACTIVE", effectiveTo: null },
      create: {
        stableKey: `hr-e2e:feature:${user.id}:${feature.code}`,
        userId: user.id,
        featureCode: feature.code,
        level: feature.level,
        effectiveFrom: authorizationEffectiveFrom,
        grantedByUserId: user.id,
        reason: "HR hiring E2E fixture",
      },
    });
  }
  await prisma.hrFeatureAccessGrant.upsert({
    where: { stableKey: `hr-e2e:feature:${user.id}:ORGANIZATIONAL_STRUCTURE` },
    update: { level: "VIEW", status: "ACTIVE", effectiveTo: null },
    create: {
      stableKey: `hr-e2e:feature:${user.id}:ORGANIZATIONAL_STRUCTURE`,
      userId: user.id,
      featureCode: "ORGANIZATIONAL_STRUCTURE",
      level: "VIEW",
      effectiveFrom: authorizationEffectiveFrom,
      grantedByUserId: user.id,
      reason: "HR hiring E2E fixture",
    },
  });
  await prisma.hrBusinessAuthorityGrant.upsert({
    where: { stableKey: `hr-e2e:authority:${user.id}:HR_PROCESSOR` },
    update: { status: "ACTIVE", effectiveTo: null },
    create: {
      stableKey: `hr-e2e:authority:${user.id}:HR_PROCESSOR`,
      userId: user.id,
      authorityCode: "HR_PROCESSOR",
      effectiveFrom: authorizationEffectiveFrom,
      grantedByUserId: user.id,
      reason: "HR hiring E2E fixture",
    },
  });
  await prisma.hrNamedResponsibility.upsert({
    where: { stableKey: `hr-e2e:responsibility:${user.id}:HR_PROCESSOR:GLOBAL` },
    update: { assignedUserId: user.id, effectiveTo: null },
    create: {
      stableKey: `hr-e2e:responsibility:${user.id}:HR_PROCESSOR:GLOBAL`,
      responsibilityTypeCode: "HR_PROCESSOR",
      scopeType: "GLOBAL",
      scopeId: null,
      assignedUserId: user.id,
      effectiveFrom: authorizationEffectiveFrom,
      reason: "HR hiring E2E fixture",
      createdByUserId: user.id,
    },
  });
  await prisma.hrResponsibilityDestination.upsert({
    where: { stableKey: "hr-e2e:destination:HR_PROCESSOR:GLOBAL" },
    update: { isActive: true },
    create: {
      stableKey: "hr-e2e:destination:HR_PROCESSOR:GLOBAL",
      responsibilityTypeCode: "HR_PROCESSOR",
      scopeType: "GLOBAL",
      scopeId: null,
      workspaceCode: "HUMAN_RESOURCES",
      featureCode: "RECRUITMENT_CASES",
      queueCode: "HR_HIRING",
      createdByUserId: user.id,
    },
  });

  await prisma.hrOrganizationalUnit.upsert({
    where: { id: fixture.unitId },
    update: { name: "واحد آزمایشی منابع انسانی", isActive: true },
    create: {
      id: fixture.unitId,
      code: "HR-E2E-UNIT",
      name: "واحد آزمایشی منابع انسانی",
      type: "DEPARTMENT",
      createdBy: user.id,
    },
  });
  await prisma.hrJob.upsert({
    where: { id: fixture.jobId },
    update: { title: "کارشناس حسابداری آزمایشی", isActive: true },
    create: {
      id: fixture.jobId,
      code: "HR-E2E-JOB",
      title: "کارشناس حسابداری آزمایشی",
      createdBy: user.id,
    },
  });
  await prisma.hrPosition.upsert({
    where: { id: fixture.positionId },
    update: {
      title: "جایگاه آزمایشی کارشناس حسابداری",
      jobId: fixture.jobId,
      organizationalUnitId: fixture.unitId,
      isActive: true,
    },
    create: {
      id: fixture.positionId,
      code: "HR-E2E-POSITION",
      title: "جایگاه آزمایشی کارشناس حسابداری",
      jobId: fixture.jobId,
      organizationalUnitId: fixture.unitId,
      createdBy: user.id,
    },
  });

  await prisma.hrCandidate.upsert({
    where: { id: fixture.candidateId },
    update: {
      firstName: "متقاضی",
      lastName: "آزمایشی",
      mobile: fixture.mobile,
    },
    create: {
      id: fixture.candidateId,
      firstName: "متقاضی",
      lastName: "آزمایشی",
      mobile: fixture.mobile,
    },
  });
  await prisma.hrJobApplication.upsert({
    where: { id: fixture.applicationId },
    update: {
      candidateId: fixture.candidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      outcome: null,
      createdBy: user.id,
      currentRevisionNumber: 1,
      identityClearance: "APPROVED",
      assessmentCompletedBy: user.id,
      assessmentCompletedAt: new Date(),
      assessmentDecision: "APPROVED",
      assessmentDecisionBy: user.id,
      assessmentDecisionAt: new Date(),
      assessmentReviewRequired: false,
      assessmentReviewAcknowledgedBy: null,
      assessmentReviewAcknowledgedAt: null,
      preIdentityReleasedAt: new Date(),
      acceptedOfferAt: null,
      collateralClearance: "NOT_STARTED",
      compensationClearance: "IN_PROGRESS",
    },
    create: {
      id: fixture.applicationId,
      candidateId: fixture.candidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      createdBy: user.id,
      currentRevisionNumber: 1,
      identityClearance: "APPROVED",
      assessmentCompletedBy: user.id,
      assessmentCompletedAt: new Date(),
      assessmentDecision: "APPROVED",
      assessmentDecisionBy: user.id,
      assessmentDecisionAt: new Date(),
      preIdentityReleasedAt: new Date(),
      collateralClearance: "NOT_STARTED",
      compensationClearance: "IN_PROGRESS",
    },
  });
  await prisma.hrCollateralRequirement.upsert({
    where: { applicationId_version: { applicationId: fixture.applicationId, version: 1 } },
    update: {
      type: "PROMISSORY_NOTE", amountRials: "20000000", status: "ACTIVE",
      candidateExplanation: "پس از پذیرش پیشنهاد، امور مالی برای دریافت سفته به مبلغ 20,000,000 ریال با شما هماهنگ می‌کند.",
      proposedBy: user.id, dueTiming: null,
    },
    create: {
      applicationId: fixture.applicationId, version: 1, type: "PROMISSORY_NOTE",
      amountRials: "20000000", status: "ACTIVE",
      candidateExplanation: "پس از پذیرش پیشنهاد، امور مالی برای دریافت سفته به مبلغ 20,000,000 ریال با شما هماهنگ می‌کند.",
      proposedBy: user.id,
    },
  });

  await prisma.hrCandidate.upsert({
    where: { id: fixture.interviewCandidateId },
    update: {
      firstName: "مصاحبه",
      lastName: "آزمایشی",
      mobile: "09120000003",
    },
    create: {
      id: fixture.interviewCandidateId,
      firstName: "مصاحبه",
      lastName: "آزمایشی",
      mobile: "09120000003",
    },
  });
  await prisma.hrJobApplication.upsert({
    where: { id: fixture.interviewApplicationId },
    update: {
      candidateId: fixture.interviewCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      outcome: null,
      createdBy: user.id,
    },
    create: {
      id: fixture.interviewApplicationId,
      candidateId: fixture.interviewCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      createdBy: user.id,
    },
  });
  await prisma.hrApplicationFormRevision.upsert({
    where: {
      applicationId_revisionNumber: {
        applicationId: fixture.interviewApplicationId,
        revisionNumber: 1,
      },
    },
    update: { status: "SUBMITTED", dataJson: {}, submittedAt: new Date() },
    create: {
      applicationId: fixture.interviewApplicationId,
      revisionNumber: 1,
      status: "SUBMITTED",
      dataJson: {},
      submittedAt: new Date(),
    },
  });

  await prisma.hrCandidate.upsert({
    where: { id: fixture.releaseCandidateId },
    update: {
      firstName: "تصمیم",
      lastName: "آزمایشی",
      mobile: "09120000002",
    },
    create: {
      id: fixture.releaseCandidateId,
      firstName: "تصمیم",
      lastName: "آزمایشی",
      mobile: "09120000002",
    },
  });

  await prisma.hrJobApplication.upsert({
    where: { id: fixture.releaseApplicationId },
    update: {
      candidateId: fixture.releaseCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      outcome: null,
      createdBy: user.id,
      preIdentityRequirementsFinalizedAt: new Date(),
      preIdentityManagementApprovedAt: new Date(),
      preIdentityReleasedAt: null,
    },
    create: {
      id: fixture.releaseApplicationId,
      candidateId: fixture.releaseCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      createdBy: user.id,
      preIdentityRequirementsFinalizedAt: new Date(),
      preIdentityManagementApprovedAt: new Date(),
    },
  });
  await prisma.hrApplicationFormRevision.upsert({
    where: {
      applicationId_revisionNumber: {
        applicationId: fixture.releaseApplicationId,
        revisionNumber: 1,
      },
    },
    update: { status: "SUBMITTED", dataJson: {}, submittedAt: new Date() },
    create: {
      applicationId: fixture.releaseApplicationId,
      revisionNumber: 1,
      status: "SUBMITTED",
      dataJson: {},
      submittedAt: new Date(),
    },
  });
  await prisma.hrApplicationDecision.deleteMany({
    where: { applicationId: fixture.releaseApplicationId },
  });
  await prisma.hrApplicationDecision.createMany({
    data: ["HR_INTERVIEW", "HR_PRELIMINARY_APPROVAL", "COMPANY_APPROVAL"].flatMap((kind) => [
      {
        applicationId: fixture.releaseApplicationId,
        kind: kind as "HR_INTERVIEW" | "HR_PRELIMINARY_APPROVAL" | "COMPANY_APPROVAL",
        outcome: "NEGATIVE" as const,
        version: 1,
        decidedBy: user.id,
      },
      {
        applicationId: fixture.releaseApplicationId,
        kind: kind as "HR_INTERVIEW" | "HR_PRELIMINARY_APPROVAL" | "COMPANY_APPROVAL",
        outcome: "POSITIVE" as const,
        version: 2,
        decidedBy: user.id,
      },
    ]),
  });
  await prisma.hrJobApplication.upsert({
    where: { id: fixture.blockedApplicationId },
    update: {
      candidateId: fixture.releaseCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      outcome: null,
      createdBy: user.id,
      preIdentityRequirementsFinalizedAt: new Date(),
      preIdentityManagementApprovedAt: new Date(),
      preIdentityReleasedAt: null,
    },
    create: {
      id: fixture.blockedApplicationId,
      candidateId: fixture.releaseCandidateId,
      positionId: fixture.positionId,
      stage: "SCREENING",
      createdBy: user.id,
      preIdentityRequirementsFinalizedAt: new Date(),
      preIdentityManagementApprovedAt: new Date(),
    },
  });
  await prisma.hrApplicationDecision.deleteMany({
    where: { applicationId: fixture.blockedApplicationId },
  });

  await prisma.hrApplicationFormRevision.upsert({
    where: {
      applicationId_revisionNumber: {
        applicationId: fixture.applicationId,
        revisionNumber: 1,
      },
    },
    update: {
      status: "SUBMITTED",
      dataJson: {
        firstName: "متقاضی",
        lastName: "آزمایشی",
        nationalCode: "0013547829",
        postalCode: "1234567890",
        mobile: fixture.mobile,
      },
      submittedAt: new Date(),
    },
    create: {
      applicationId: fixture.applicationId,
      revisionNumber: 1,
      status: "SUBMITTED",
      dataJson: {
        firstName: "متقاضی",
        lastName: "آزمایشی",
        nationalCode: "0013547829",
        postalCode: "1234567890",
        mobile: fixture.mobile,
      },
      submittedAt: new Date(),
    },
  });
  for (const fieldKey of ["nationalCode", "postalCode"]) {
    await prisma.hrIdentityCheck.upsert({
      where: {
        applicationId_fieldKey: {
          applicationId: fixture.applicationId,
          fieldKey,
        },
      },
      update: { status: "MISMATCH", reviewedBy: user.id },
      create: {
        applicationId: fixture.applicationId,
        fieldKey,
        status: "MISMATCH",
        reviewedBy: user.id,
      },
    });
  }

  await prisma.hrCompensationSnapshot.upsert({
    where: {
      applicationId_version: {
        applicationId: fixture.applicationId,
        version: 1,
      },
    },
    update: {
      componentsJson: [
        {
          label: "حقوق پایه",
          category: "BASE_SALARY",
          amountRials: "200000000",
        },
      ],
      totalRials: "200000000",
      proposedBy: user.id,
      preparedBy: user.id,
      preparedAt: new Date(),
      hrApprovedBy: user.id,
      hrApprovedAt: new Date(),
      financeApprovedBy: user.id,
      financeApprovedAt: new Date(),
      payrollReviewStatus: "VERIFIED",
      payrollVerifiedBy: user.id,
      payrollVerifiedAt: new Date(),
      candidateAcceptedAt: null,
      candidateAcceptedName: null,
      candidateDecision: null,
      candidateDecisionAt: null,
      candidateDecisionSource: null,
      candidateDecisionBy: null,
      candidateDecisionNote: null,
      candidateDeclineCategory: null,
      offlineCommunicationMethod: null,
      offlineCommunicatedAt: null,
      offlineReason: null,
      offlineConfirmedInformation: null,
      candidateNotificationStatus: "FAILED",
      candidateNotificationError: "خطای آزمایشی ارسال پیامک پیشنهاد",
      candidateNotificationClaimedAt: null,
      candidateNotificationClaimToken: null,
      candidateNotifiedAt: null,
      candidateNotificationAttempts: 1,
    },
    create: {
      id: "hr-e2e-compensation-snapshot",
      applicationId: fixture.applicationId,
      version: 1,
      componentsJson: [
        {
          label: "حقوق پایه",
          category: "BASE_SALARY",
          amountRials: "200000000",
        },
      ],
      totalRials: "200000000",
      proposedBy: user.id,
      preparedBy: user.id,
      preparedAt: new Date(),
      hrApprovedBy: user.id,
      hrApprovedAt: new Date(),
      financeApprovedBy: user.id,
      financeApprovedAt: new Date(),
      payrollReviewStatus: "VERIFIED",
      payrollVerifiedBy: user.id,
      payrollVerifiedAt: new Date(),
      candidateNotificationStatus: "FAILED",
      candidateNotificationError: "خطای آزمایشی ارسال پیامک پیشنهاد",
      candidateNotifiedAt: null,
    },
  });

  for (const applicationId of [fixture.applicationId, fixture.releaseApplicationId, fixture.blockedApplicationId]) {
    const companyExecutedDisc = applicationId === fixture.applicationId;
    const plan = await prisma.hrFormalAssessmentPlan.upsert({
      where: { stableKey: `hr-e2e:formal-assessment-plan:${applicationId}:1` },
      update: {
        status: "ACTIVE",
        explicitlyNoAssessment: !companyExecutedDisc,
        executionMethod: companyExecutedDisc ? "COMPANY" : null,
      },
      create: {
        stableKey: `hr-e2e:formal-assessment-plan:${applicationId}:1`,
        applicationId,
        version: 1,
        explicitlyNoAssessment: !companyExecutedDisc,
        executionMethod: companyExecutedDisc ? "COMPANY" : null,
        finalizedByUserId: user.id,
        reason: companyExecutedDisc
          ? "Company-executed DISC for localized score acceptance"
          : "Explicit no-assessment decision for the HR hiring E2E fixture",
      },
    });
    if (companyExecutedDisc) {
      await prisma.hrFormalAssessmentPlanSelection.upsert({
        where: { planId_assessmentKind: { planId: plan.id, assessmentKind: "DISC" } },
        update: { selected: true, executionMethod: "COMPANY" },
        create: { planId: plan.id, assessmentKind: "DISC", selected: true, executionMethod: "COMPANY" },
      });
    }
  }

  await prisma.hrCandidateInvitation.deleteMany({
    where: { applicationId: fixture.applicationId },
  });
  await prisma.hrCandidateInvitation.create({
    data: {
      id: fixture.invitationId,
      applicationId: fixture.applicationId,
      mobileSnapshot: fixture.mobile,
      otpHash: applicantOtpHash(fixture.mobile, fixture.otp),
      otpCiphertext: encryptApplicantOtp(fixture.mobile, fixture.otp),
      expiresAt: plusDays(7),
      createdBy: user.id,
    },
  });
}

main()
  .finally(async () => prisma.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
