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
  candidateId: "hr-e2e-candidate",
  invitationId: "hr-e2e-invitation",
  unitId: "hr-e2e-unit",
  jobId: "hr-e2e-job",
  positionId: "hr-e2e-position",
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
    },
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
      candidateNotificationStatus: "FAILED",
      candidateNotificationError: "خطای آزمایشی ارسال پیامک پیشنهاد",
      candidateNotifiedAt: null,
    },
  });

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
