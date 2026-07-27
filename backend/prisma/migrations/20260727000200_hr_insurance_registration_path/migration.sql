CREATE TYPE "HrInsuranceRegistrationPath" AS ENUM ('COMPANY', 'INDEPENDENT_REQUEST');

ALTER TABLE "hr_insurance_enrollments"
  ADD COLUMN "registrationPath" "HrInsuranceRegistrationPath" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "communicationMethod" TEXT,
  ADD COLUMN "communicatedAt" TIMESTAMP(3);
