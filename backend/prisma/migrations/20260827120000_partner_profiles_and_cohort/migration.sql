-- Additive only. Closed activation; no historical contracts/users are converted.
BEGIN;
SET LOCAL lock_timeout = '5s';
-- CreateEnum
CREATE TYPE "PartnerProfileState" AS ENUM ('PENDING', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateTable
CREATE TABLE "partner_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "state" "PartnerProfileState" NOT NULL DEFAULT 'PENDING',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "firstActivatedAt" TIMESTAMPTZ(3),
    "irreversibleAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commercial_accounts" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_commercial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commercial_identities" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "legalName" TEXT NOT NULL,
    "tradeName" TEXT,
    "identifiers" JSONB NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "integrityHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_commercial_identities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_commercial_terms" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "terms" JSONB NOT NULL,
    "integrityHash" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_commercial_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_release_cohorts" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "activationEnabled" BOOLEAN NOT NULL DEFAULT false,
    "enrollmentPaused" BOOLEAN NOT NULL DEFAULT true,
    "operationalPaused" BOOLEAN NOT NULL DEFAULT true,
    "readinessEvidence" JSONB,

    CONSTRAINT "partner_release_cohorts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_cohort_memberships" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "eligibilityEvidence" JSONB NOT NULL,
    "enrolledAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_cohort_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_conversion_dispositions" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "disposition" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "successorId" TEXT,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_conversion_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_profile_events" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "fromState" "PartnerProfileState",
    "toState" "PartnerProfileState" NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_profile_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "partner_cohort_events" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "partner_cohort_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "partner_profiles_userId_key" ON "partner_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_commercial_accounts_profileId_key" ON "partner_commercial_accounts"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_commercial_identities_accountId_version_key" ON "partner_commercial_identities"("accountId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_commercial_terms_accountId_version_key" ON "partner_commercial_terms"("accountId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "partner_release_cohorts_name_key" ON "partner_release_cohorts"("name");

-- CreateIndex
CREATE UNIQUE INDEX "partner_cohort_memberships_profileId_cohortId_key" ON "partner_cohort_memberships"("profileId", "cohortId");

-- CreateIndex
CREATE INDEX "partner_conversion_dispositions_profileId_sourceType_source_idx" ON "partner_conversion_dispositions"("profileId", "sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_profile_events_commandId_key" ON "partner_profile_events"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_profile_events_profileId_revision_key" ON "partner_profile_events"("profileId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "partner_cohort_events_commandId_key" ON "partner_cohort_events"("commandId");

-- CreateIndex
CREATE UNIQUE INDEX "partner_cohort_events_cohortId_revision_key" ON "partner_cohort_events"("cohortId", "revision");

-- AddForeignKey
ALTER TABLE "partner_profiles" ADD CONSTRAINT "partner_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commercial_accounts" ADD CONSTRAINT "partner_commercial_accounts_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commercial_identities" ADD CONSTRAINT "partner_commercial_identities_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "partner_commercial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_commercial_terms" ADD CONSTRAINT "partner_commercial_terms_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "partner_commercial_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_cohort_memberships" ADD CONSTRAINT "partner_cohort_memberships_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_cohort_memberships" ADD CONSTRAINT "partner_cohort_memberships_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "partner_release_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_conversion_dispositions" ADD CONSTRAINT "partner_conversion_dispositions_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_profile_events" ADD CONSTRAINT "partner_profile_events_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "partner_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "partner_cohort_events" ADD CONSTRAINT "partner_cohort_events_cohortId_fkey" FOREIGN KEY ("cohortId") REFERENCES "partner_release_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION partner_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner evidence is append-only';
END $$;

CREATE FUNCTION partner_protect_identity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE field text;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner identity is retained';
  END IF;
  FOREACH field IN ARRAY TG_ARGV LOOP
    IF (to_jsonb(OLD)->field) IS DISTINCT FROM (to_jsonb(NEW)->field) THEN
      RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Partner identity cannot be replaced';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DO $$ DECLARE name text; BEGIN
  FOREACH name IN ARRAY ARRAY['partner_commercial_identities','partner_commercial_terms',
    'partner_cohort_memberships','partner_conversion_dispositions','partner_profile_events','partner_cohort_events'] LOOP
    EXECUTE format('CREATE TRIGGER partner_append_only BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
    EXECUTE format('CREATE TRIGGER partner_no_truncate BEFORE TRUNCATE ON %I FOR EACH STATEMENT EXECUTE FUNCTION partner_reject_evidence_mutation()', name);
  END LOOP;
END $$;
CREATE TRIGGER partner_profile_identity BEFORE UPDATE OR DELETE ON partner_profiles FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','userId','createdAt');
CREATE TRIGGER partner_account_identity BEFORE UPDATE OR DELETE ON partner_commercial_accounts FOR EACH ROW
  EXECUTE FUNCTION partner_protect_identity('id','profileId','createdAt');
ALTER TABLE partner_profiles ADD CONSTRAINT partner_profile_revision CHECK (revision > 0);
ALTER TABLE partner_commercial_identities ADD CONSTRAINT partner_identity_complete CHECK
  (version > 0 AND length(trim("legalName")) > 0 AND length(trim(phone)) > 0 AND length(trim(address)) > 0
   AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$');
ALTER TABLE partner_commercial_terms ADD CONSTRAINT partner_terms_version CHECK (version > 0 AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$');
COMMIT;
