-- CreateEnum
CREATE TYPE "AccountingFiscalYearStatus" AS ENUM ('DRAFT', 'ACTIVE', 'SOFT_CLOSED', 'HARD_CLOSED');

-- CreateEnum
CREATE TYPE "AccountingPostingPeriodStatus" AS ENUM ('OPEN', 'SOFT_CLOSED', 'HARD_CLOSED');

-- CreateEnum
CREATE TYPE "AccountingLedgerAccountLevel" AS ENUM ('GROUP', 'KOL', 'MOIN');

-- CreateEnum
CREATE TYPE "AccountingNormalSide" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "AccountingStatementRole" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'OTHER_COMPREHENSIVE_INCOME', 'MEMO');

-- CreateEnum
CREATE TYPE "AccountingCurrencyBehavior" AS ENUM ('BASE_ONLY', 'MULTI_CURRENCY');

-- CreateEnum
CREATE TYPE "AccountingDimensionRequirement" AS ENUM ('REQUIRED', 'OPTIONAL', 'FORBIDDEN');

-- CreateEnum
CREATE TYPE "AccountingPartyRoleType" AS ENUM ('CUSTOMER', 'SUPPLIER', 'EMPLOYEE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountingFinancialAccountKind" AS ENUM ('BANK', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountingLedgerVoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "AccountingAuditResult" AS ENUM ('SUCCEEDED', 'DENIED');

-- CreateTable
CREATE TABLE "accounting_legal_entities" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "namePersian" TEXT NOT NULL,
    "nationalId" TEXT,
    "economicCode" TEXT,
    "baseCurrency" TEXT NOT NULL DEFAULT 'IRR',
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_legal_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_books" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "namePersian" TEXT NOT NULL,
    "baseCurrency" TEXT NOT NULL DEFAULT 'IRR',
    "isPrimary" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_fiscal_years" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountingFiscalYearStatus" NOT NULL DEFAULT 'DRAFT',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_posting_periods" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPostingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "isAdjustment" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "closeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_posting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_code_schemes" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "groupLength" INTEGER NOT NULL,
    "kolLength" INTEGER NOT NULL,
    "moinLength" INTEGER NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_code_schemes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_accounts" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "codeSchemeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "level" "AccountingLedgerAccountLevel" NOT NULL,
    "normalSide" "AccountingNormalSide" NOT NULL,
    "statementRole" "AccountingStatementRole" NOT NULL,
    "currencyBehavior" "AccountingCurrencyBehavior" NOT NULL DEFAULT 'BASE_ONLY',
    "parentId" TEXT,
    "contraAccountId" TEXT,
    "successorAccountId" TEXT,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "retiredBy" TEXT,
    "retirementReason" TEXT,
    "meaningLockedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_dimension_types" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_dimension_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_dimension_members" (
    "id" TEXT NOT NULL,
    "dimensionTypeId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "code" TEXT,
    "titlePersian" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_dimension_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_account_dimension_rules" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "dimensionTypeId" TEXT NOT NULL,
    "requirement" "AccountingDimensionRequirement" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_ledger_account_dimension_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_parties" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "sourceKind" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "nationalId" TEXT,
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_parties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_party_role_assignments" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "role" "AccountingPartyRoleType" NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_party_role_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_financial_accounts" (
    "id" TEXT NOT NULL,
    "legalEntityId" TEXT NOT NULL,
    "kind" "AccountingFinancialAccountKind" NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "institutionName" TEXT,
    "branchName" TEXT,
    "accountNumber" TEXT,
    "iban" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'IRR',
    "activeFrom" TIMESTAMP(3) NOT NULL,
    "activeTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_vouchers" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "statutoryNumber" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "status" "AccountingLedgerVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL,
    "discoveredAt" TIMESTAMP(3),
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceVersion" INTEGER NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "debitTotalRials" DECIMAL(20,0) NOT NULL,
    "creditTotalRials" DECIMAL(20,0) NOT NULL,
    "contentHash" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_ledger_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_lines" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "creditRials" DECIMAL(20,0) NOT NULL DEFAULT 0,
    "description" TEXT,
    "originalAmount" DECIMAL(30,8),
    "originalCurrency" TEXT,
    "exchangeRate" DECIMAL(30,10),
    "exchangeRateDate" TIMESTAMP(3),
    "exchangeRateSource" TEXT,
    "rawAmountBeforeRounding" DECIMAL(30,8),
    "roundingRuleVersion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_ledger_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_line_dimensions" (
    "id" TEXT NOT NULL,
    "lineId" TEXT NOT NULL,
    "dimensionTypeId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_ledger_line_dimensions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_voucher_sequences" (
    "id" TEXT NOT NULL,
    "bookId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "nextNumber" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounting_voucher_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_ledger_audit_entries" (
    "id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "action" TEXT NOT NULL,
    "result" "AccountingAuditResult" NOT NULL,
    "actorId" TEXT NOT NULL,
    "effectiveProfile" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "correlationId" TEXT NOT NULL,
    "reason" TEXT,
    "payloadHash" TEXT NOT NULL,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,
    "sessionContext" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_ledger_audit_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_legal_entities_code_key" ON "accounting_legal_entities"("code");

-- CreateIndex
CREATE INDEX "accounting_legal_entities_activeFrom_activeTo_idx" ON "accounting_legal_entities"("activeFrom", "activeTo");

-- CreateIndex
CREATE INDEX "accounting_books_legalEntityId_isPrimary_idx" ON "accounting_books"("legalEntityId", "isPrimary");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_books_legalEntityId_code_key" ON "accounting_books"("legalEntityId", "code");

-- CreateIndex
CREATE INDEX "accounting_fiscal_years_bookId_startsAt_endsAt_idx" ON "accounting_fiscal_years"("bookId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "accounting_fiscal_years_bookId_status_idx" ON "accounting_fiscal_years"("bookId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_fiscal_years_bookId_code_key" ON "accounting_fiscal_years"("bookId", "code");

-- CreateIndex
CREATE INDEX "accounting_posting_periods_fiscalYearId_startsAt_endsAt_idx" ON "accounting_posting_periods"("fiscalYearId", "startsAt", "endsAt");

-- CreateIndex
CREATE INDEX "accounting_posting_periods_fiscalYearId_status_idx" ON "accounting_posting_periods"("fiscalYearId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_posting_periods_fiscalYearId_code_key" ON "accounting_posting_periods"("fiscalYearId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_posting_periods_fiscalYearId_sequence_key" ON "accounting_posting_periods"("fiscalYearId", "sequence");

-- CreateIndex
CREATE INDEX "accounting_code_schemes_bookId_effectiveFrom_retiredAt_idx" ON "accounting_code_schemes"("bookId", "effectiveFrom", "retiredAt");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_code_schemes_bookId_version_key" ON "accounting_code_schemes"("bookId", "version");

-- CreateIndex
CREATE INDEX "accounting_ledger_accounts_bookId_level_retiredAt_idx" ON "accounting_ledger_accounts"("bookId", "level", "retiredAt");

-- CreateIndex
CREATE INDEX "accounting_ledger_accounts_parentId_idx" ON "accounting_ledger_accounts"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_accounts_bookId_code_key" ON "accounting_ledger_accounts"("bookId", "code");

-- CreateIndex
CREATE INDEX "accounting_dimension_types_bookId_effectiveFrom_effectiveTo_idx" ON "accounting_dimension_types"("bookId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_dimension_types_bookId_code_key" ON "accounting_dimension_types"("bookId", "code");

-- CreateIndex
CREATE INDEX "accounting_dimension_members_dimensionTypeId_effectiveFrom__idx" ON "accounting_dimension_members"("dimensionTypeId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_dimension_members_dimensionTypeId_sourceId_key" ON "accounting_dimension_members"("dimensionTypeId", "sourceId");

-- CreateIndex
CREATE INDEX "accounting_ledger_account_dimension_rules_dimensionTypeId_idx" ON "accounting_ledger_account_dimension_rules"("dimensionTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_account_dimension_rules_accountId_dimensi_key" ON "accounting_ledger_account_dimension_rules"("accountId", "dimensionTypeId");

-- CreateIndex
CREATE INDEX "accounting_parties_legalEntityId_activeFrom_activeTo_idx" ON "accounting_parties"("legalEntityId", "activeFrom", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_parties_legalEntityId_sourceKind_sourceId_key" ON "accounting_parties"("legalEntityId", "sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "accounting_party_role_assignments_partyId_role_effectiveTo_idx" ON "accounting_party_role_assignments"("partyId", "role", "effectiveTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_party_role_assignments_partyId_role_effectiveFro_key" ON "accounting_party_role_assignments"("partyId", "role", "effectiveFrom");

-- CreateIndex
CREATE INDEX "accounting_financial_accounts_legalEntityId_kind_activeTo_idx" ON "accounting_financial_accounts"("legalEntityId", "kind", "activeTo");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_financial_accounts_legalEntityId_iban_key" ON "accounting_financial_accounts"("legalEntityId", "iban");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_vouchers_referenceNumber_key" ON "accounting_ledger_vouchers"("referenceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_vouchers_idempotencyKey_key" ON "accounting_ledger_vouchers"("idempotencyKey");

-- CreateIndex
CREATE INDEX "accounting_ledger_vouchers_bookId_fiscalYearId_documentDate_idx" ON "accounting_ledger_vouchers"("bookId", "fiscalYearId", "documentDate");

-- CreateIndex
CREATE INDEX "accounting_ledger_vouchers_periodId_status_idx" ON "accounting_ledger_vouchers"("periodId", "status");

-- CreateIndex
CREATE INDEX "accounting_ledger_vouchers_sourceType_sourceId_sourceVersio_idx" ON "accounting_ledger_vouchers"("sourceType", "sourceId", "sourceVersion");

-- CreateIndex
CREATE INDEX "accounting_ledger_vouchers_reversalOfId_idx" ON "accounting_ledger_vouchers"("reversalOfId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_vouchers_bookId_fiscalYearId_statutoryNum_key" ON "accounting_ledger_vouchers"("bookId", "fiscalYearId", "statutoryNumber");

-- CreateIndex
CREATE INDEX "accounting_ledger_lines_accountId_voucherId_idx" ON "accounting_ledger_lines"("accountId", "voucherId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_lines_voucherId_sequence_key" ON "accounting_ledger_lines"("voucherId", "sequence");

-- CreateIndex
CREATE INDEX "accounting_ledger_line_dimensions_dimensionTypeId_memberId_idx" ON "accounting_ledger_line_dimensions"("dimensionTypeId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_line_dimensions_lineId_dimensionTypeId_key" ON "accounting_ledger_line_dimensions"("lineId", "dimensionTypeId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_voucher_sequences_bookId_fiscalYearId_key" ON "accounting_voucher_sequences"("bookId", "fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_audit_entries_sequence_key" ON "accounting_ledger_audit_entries"("sequence");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_ledger_audit_entries_entryHash_key" ON "accounting_ledger_audit_entries"("entryHash");

-- CreateIndex
CREATE INDEX "accounting_ledger_audit_entries_entityType_entityId_sequenc_idx" ON "accounting_ledger_audit_entries"("entityType", "entityId", "sequence");

-- CreateIndex
CREATE INDEX "accounting_ledger_audit_entries_actorId_sequence_idx" ON "accounting_ledger_audit_entries"("actorId", "sequence");

-- AddForeignKey
ALTER TABLE "accounting_books" ADD CONSTRAINT "accounting_books_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "accounting_legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_fiscal_years" ADD CONSTRAINT "accounting_fiscal_years_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_posting_periods" ADD CONSTRAINT "accounting_posting_periods_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "accounting_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_code_schemes" ADD CONSTRAINT "accounting_code_schemes_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_accounts" ADD CONSTRAINT "accounting_ledger_accounts_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_accounts" ADD CONSTRAINT "accounting_ledger_accounts_codeSchemeId_fkey" FOREIGN KEY ("codeSchemeId") REFERENCES "accounting_code_schemes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_accounts" ADD CONSTRAINT "accounting_ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_accounts" ADD CONSTRAINT "accounting_ledger_accounts_contraAccountId_fkey" FOREIGN KEY ("contraAccountId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_accounts" ADD CONSTRAINT "accounting_ledger_accounts_successorAccountId_fkey" FOREIGN KEY ("successorAccountId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_dimension_types" ADD CONSTRAINT "accounting_dimension_types_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_dimension_members" ADD CONSTRAINT "accounting_dimension_members_dimensionTypeId_fkey" FOREIGN KEY ("dimensionTypeId") REFERENCES "accounting_dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_account_dimension_rules" ADD CONSTRAINT "accounting_ledger_account_dimension_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_account_dimension_rules" ADD CONSTRAINT "accounting_ledger_account_dimension_rules_dimensionTypeId_fkey" FOREIGN KEY ("dimensionTypeId") REFERENCES "accounting_dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_parties" ADD CONSTRAINT "accounting_parties_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "accounting_legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_party_role_assignments" ADD CONSTRAINT "accounting_party_role_assignments_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "accounting_parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_financial_accounts" ADD CONSTRAINT "accounting_financial_accounts_legalEntityId_fkey" FOREIGN KEY ("legalEntityId") REFERENCES "accounting_legal_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_vouchers" ADD CONSTRAINT "accounting_ledger_vouchers_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_vouchers" ADD CONSTRAINT "accounting_ledger_vouchers_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "accounting_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_vouchers" ADD CONSTRAINT "accounting_ledger_vouchers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_posting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_vouchers" ADD CONSTRAINT "accounting_ledger_vouchers_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_lines" ADD CONSTRAINT "accounting_ledger_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "accounting_ledger_vouchers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_lines" ADD CONSTRAINT "accounting_ledger_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounting_ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_line_dimensions" ADD CONSTRAINT "accounting_ledger_line_dimensions_lineId_fkey" FOREIGN KEY ("lineId") REFERENCES "accounting_ledger_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_line_dimensions" ADD CONSTRAINT "accounting_ledger_line_dimensions_dimensionTypeId_fkey" FOREIGN KEY ("dimensionTypeId") REFERENCES "accounting_dimension_types"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_ledger_line_dimensions" ADD CONSTRAINT "accounting_ledger_line_dimensions_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "accounting_dimension_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_voucher_sequences" ADD CONSTRAINT "accounting_voucher_sequences_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "accounting_books"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_voucher_sequences" ADD CONSTRAINT "accounting_voucher_sequences_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "accounting_fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Domain invariants that Prisma cannot express. The legal ledger is IRR-only,
-- date ranges are ordered, journal amounts are whole positive rials and only
-- one primary book can be active for a reporting entity.
ALTER TABLE "accounting_legal_entities"
  ADD CONSTRAINT "accounting_legal_entities_irr_check" CHECK ("baseCurrency" = 'IRR'),
  ADD CONSTRAINT "accounting_legal_entities_date_range_check" CHECK ("activeTo" IS NULL OR "activeTo" >= "activeFrom");

ALTER TABLE "accounting_books"
  ADD CONSTRAINT "accounting_books_irr_check" CHECK ("baseCurrency" = 'IRR');

CREATE UNIQUE INDEX "accounting_books_one_primary_per_entity_key"
  ON "accounting_books" ("legalEntityId") WHERE "isPrimary" = true;

ALTER TABLE "accounting_fiscal_years"
  ADD CONSTRAINT "accounting_fiscal_years_date_range_check" CHECK ("endsAt" >= "startsAt");

ALTER TABLE "accounting_posting_periods"
  ADD CONSTRAINT "accounting_posting_periods_date_range_check" CHECK ("endsAt" >= "startsAt");

ALTER TABLE "accounting_code_schemes"
  ADD CONSTRAINT "accounting_code_schemes_lengths_check"
  CHECK ("groupLength" > 0 AND "kolLength" > 0 AND "moinLength" > 0);

ALTER TABLE "accounting_ledger_vouchers"
  ADD CONSTRAINT "accounting_ledger_vouchers_balanced_check"
  CHECK ("debitTotalRials" > 0 AND "debitTotalRials" = "creditTotalRials");

ALTER TABLE "accounting_ledger_lines"
  ADD CONSTRAINT "accounting_ledger_lines_one_side_check"
  CHECK (
    ("debitRials" > 0 AND "creditRials" = 0)
    OR ("creditRials" > 0 AND "debitRials" = 0)
  );

-- A posted voucher is append-only. Its only legal mutation is the explicit
-- POSTED -> REVERSED state transition; corrections are represented by a new,
-- linked reversal voucher. Posted lines, dimensions and audit evidence are
-- immutable even for privileged database users.
CREATE OR REPLACE FUNCTION accounting_guard_voucher_immutability()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'سند قطعی حسابداری قابل حذف نیست';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD."status" IN ('POSTED', 'REVERSED') THEN
    IF OLD."status" = 'POSTED'
       AND NEW."status" = 'REVERSED'
       AND NEW."reversedAt" IS NOT NULL
       AND ROW(
         NEW."id", NEW."bookId", NEW."fiscalYearId", NEW."periodId",
         NEW."referenceNumber", NEW."statutoryNumber", NEW."idempotencyKey",
         NEW."correlationId", NEW."description", NEW."documentDate",
         NEW."occurredAt", NEW."recordedAt", NEW."discoveredAt", NEW."postedAt",
         NEW."sourceType", NEW."sourceId", NEW."sourceVersion", NEW."sourceHash",
         NEW."debitTotalRials", NEW."creditTotalRials", NEW."contentHash",
         NEW."reversalOfId", NEW."createdBy", NEW."createdAt"
       ) IS NOT DISTINCT FROM ROW(
         OLD."id", OLD."bookId", OLD."fiscalYearId", OLD."periodId",
         OLD."referenceNumber", OLD."statutoryNumber", OLD."idempotencyKey",
         OLD."correlationId", OLD."description", OLD."documentDate",
         OLD."occurredAt", OLD."recordedAt", OLD."discoveredAt", OLD."postedAt",
         OLD."sourceType", OLD."sourceId", OLD."sourceVersion", OLD."sourceHash",
         OLD."debitTotalRials", OLD."creditTotalRials", OLD."contentHash",
         OLD."reversalOfId", OLD."createdBy", OLD."createdAt"
       )
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'سند قطعی حسابداری تغییرناپذیر است';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_ledger_voucher_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_vouchers"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_voucher_immutability();

CREATE OR REPLACE FUNCTION accounting_guard_posted_child_immutability()
RETURNS trigger AS $$
DECLARE
  target_voucher_id TEXT;
  target_status "AccountingLedgerVoucherStatus";
BEGIN
  IF TG_TABLE_NAME = 'accounting_ledger_lines' THEN
    target_voucher_id := COALESCE(NEW."voucherId", OLD."voucherId");
  ELSE
    SELECT "voucherId" INTO target_voucher_id
      FROM "accounting_ledger_lines"
      WHERE "id" = COALESCE(NEW."lineId", OLD."lineId");
  END IF;
  SELECT "status" INTO target_status
    FROM "accounting_ledger_vouchers" WHERE "id" = target_voucher_id;
  IF target_status IN ('POSTED', 'REVERSED') THEN
    RAISE EXCEPTION 'آرتیکل سند قطعی حسابداری تغییرناپذیر است';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_ledger_line_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_lines"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_posted_child_immutability();

CREATE TRIGGER "accounting_ledger_dimension_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_line_dimensions"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_posted_child_immutability();

CREATE OR REPLACE FUNCTION accounting_guard_audit_immutability()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'زنجیره حسابرسی حسابداری تغییرناپذیر است';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "accounting_ledger_audit_immutability"
BEFORE UPDATE OR DELETE ON "accounting_ledger_audit_entries"
FOR EACH ROW EXECUTE FUNCTION accounting_guard_audit_immutability();
