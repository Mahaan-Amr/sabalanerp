-- CreateEnum
CREATE TYPE "AccountingPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "AccountLevel" AS ENUM ('KOL', 'MOIN', 'TAFSILI');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE', 'CONTRA');

-- CreateEnum
CREATE TYPE "AccountingSourceKind" AS ENUM ('SALES_CONTRACT', 'PAYMENT', 'DELIVERY', 'MANUAL', 'CUSTOMER_OPENING_BALANCE', 'IMPORT', 'FUTURE_PURCHASE', 'FUTURE_INVENTORY', 'FUTURE_PAYROLL');

-- CreateEnum
CREATE TYPE "FinancialRecordKind" AS ENUM ('INVOICE_CANDIDATE', 'RECEIVABLE', 'PAYMENT_RECEIPT', 'CHECK_RECEIVABLE', 'TAX_SUBMISSION', 'JOURNAL_VOUCHER', 'CORRECTION_REQUEST');

-- CreateEnum
CREATE TYPE "AccountingRecordStatus" AS ENUM ('DRAFT', 'READY', 'APPROVED_FOR_ISSUE', 'ISSUED', 'POSTED', 'VOIDED', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PARTIALLY_PAID', 'SETTLED', 'OVERDUE', 'VOIDED');

-- CreateEnum
CREATE TYPE "AccountingPaymentMethod" AS ENUM ('CASH', 'CARD', 'BANK_TRANSFER', 'CHECK', 'RECEIPT');

-- CreateEnum
CREATE TYPE "PaymentAccountingStatus" AS ENUM ('EXPECTED', 'RECEIVED', 'RECONCILED', 'DISPUTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "CheckAccountingStatus" AS ENUM ('PENDING_HANDOVER', 'RECEIVED', 'DEPOSITED', 'CLEARED', 'BOUNCED', 'RETURNED', 'REPLACED');

-- CreateEnum
CREATE TYPE "TaxReadinessStatus" AS ENUM ('NOT_READY', 'READY', 'MISSING_DATA', 'NOT_REQUIRED');

-- CreateEnum
CREATE TYPE "TaxSubmissionStatus" AS ENUM ('NOT_READY', 'READY', 'SUBMITTED_MANUALLY', 'SUBMITTED_EXTERNALLY', 'ACCEPTED', 'REJECTED', 'NEEDS_CORRECTION');

-- CreateEnum
CREATE TYPE "AccountingFlagCategory" AS ENUM ('CUSTOMER_IDENTITY', 'AMOUNT_PRICING', 'PAYMENT_PLAN', 'DELIVERY_SCHEDULE', 'TAX_INFO', 'DOCUMENT_SIGNATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "AccountingFlagSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'BLOCKER');

-- CreateEnum
CREATE TYPE "AccountingFlagStatus" AS ENUM ('OPEN', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CorrectionRequestCategory" AS ENUM ('CUSTOMER_IDENTITY', 'AMOUNT_PRICING', 'PAYMENT_PLAN', 'DELIVERY_SCHEDULE', 'TAX_INFO', 'DOCUMENT_SIGNATURE', 'OTHER');

-- CreateEnum
CREATE TYPE "CorrectionRequestPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CorrectionRequestStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "JournalVoucherStatus" AS ENUM ('DRAFT', 'POSTED', 'REVERSED');

-- CreateTable
CREATE TABLE "accounting_settings" (
    "id" TEXT NOT NULL,
    "companyEconomicCode" TEXT,
    "companyNationalId" TEXT,
    "branchCode" TEXT,
    "fiscalMemoryId" TEXT,
    "defaultVatRate" DECIMAL(5,2) NOT NULL DEFAULT 10.00,
    "defaultCurrency" TEXT NOT NULL DEFAULT 'TOMAN',
    "invoiceNumberPrefix" TEXT NOT NULL DEFAULT 'ACC',
    "nextInvoiceSequence" INTEGER NOT NULL DEFAULT 1,
    "defaultInvoiceDueDays" INTEGER NOT NULL DEFAULT 30,
    "requiredTaxFields" JSONB,
    "defaultAccounts" JSONB,
    "createdBy" TEXT,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_periods" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AccountingPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chart_of_accounts" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "level" "AccountLevel" NOT NULL,
    "type" "AccountType" NOT NULL,
    "parentId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "chart_of_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_financial_records" (
    "id" TEXT NOT NULL,
    "kind" "FinancialRecordKind" NOT NULL,
    "status" "AccountingRecordStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceKind" "AccountingSourceKind" NOT NULL,
    "sourceId" TEXT,
    "contractId" TEXT,
    "customerId" TEXT,
    "periodId" TEXT,
    "amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TOMAN',
    "sourceSnapshot" JSONB,
    "metadata" JSONB,
    "idempotencyKey" TEXT,
    "createdBy" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_financial_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_invoice_candidate_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "contractItemId" TEXT,
    "productId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalPrice" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_invoice_candidate_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_receivables" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "invoiceRecordId" TEXT,
    "sourcePaymentId" TEXT,
    "customerId" TEXT,
    "originalAmount" DECIMAL(18,2) NOT NULL,
    "paidAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "remainingAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TOMAN',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_payment_statuses" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "receivableId" TEXT,
    "sourcePaymentId" TEXT,
    "sourceInstallmentId" TEXT,
    "method" "AccountingPaymentMethod" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'TOMAN',
    "status" "PaymentAccountingStatus" NOT NULL DEFAULT 'EXPECTED',
    "checkStatus" "CheckAccountingStatus",
    "checkNumber" TEXT,
    "checkOwnerName" TEXT,
    "checkDueDate" TIMESTAMP(3),
    "handoverDate" TIMESTAMP(3),
    "occurredAt" TIMESTAMP(3),
    "notes" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_payment_statuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_tax_records" (
    "id" TEXT NOT NULL,
    "invoiceRecordId" TEXT,
    "contractId" TEXT,
    "readinessStatus" "TaxReadinessStatus" NOT NULL DEFAULT 'NOT_READY',
    "submissionStatus" "TaxSubmissionStatus" NOT NULL DEFAULT 'NOT_READY',
    "taxableAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "exemptAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "vatRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "vatAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "missingFields" TEXT[],
    "trackingCode" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "notes" TEXT,
    "metadata" JSONB,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_tax_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_contract_flags" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "category" "AccountingFlagCategory" NOT NULL,
    "severity" "AccountingFlagSeverity" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "note" TEXT,
    "status" "AccountingFlagStatus" NOT NULL DEFAULT 'OPEN',
    "createdBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_contract_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_correction_requests" (
    "id" TEXT NOT NULL,
    "contractId" TEXT,
    "recordId" TEXT,
    "category" "CorrectionRequestCategory" NOT NULL,
    "priority" "CorrectionRequestPriority" NOT NULL DEFAULT 'MEDIUM',
    "status" "CorrectionRequestStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "accountantNote" TEXT NOT NULL,
    "resolutionNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "accounting_correction_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "contractId" TEXT,
    "recordId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "accounting_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_vouchers" (
    "id" TEXT NOT NULL,
    "voucherNumber" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "sourceRecordId" TEXT,
    "status" "JournalVoucherStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT NOT NULL,
    "debitTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "creditTotal" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMP(3),
    "reversedAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "journal_vouchers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_voucher_lines" (
    "id" TEXT NOT NULL,
    "voucherId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "description" TEXT,
    "costCenter" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "journal_voucher_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounting_periods_code_key" ON "accounting_periods"("code");
CREATE INDEX "accounting_periods_status_idx" ON "accounting_periods"("status");
CREATE UNIQUE INDEX "chart_of_accounts_code_key" ON "chart_of_accounts"("code");
CREATE INDEX "chart_of_accounts_parentId_idx" ON "chart_of_accounts"("parentId");
CREATE UNIQUE INDEX "accounting_financial_records_idempotencyKey_key" ON "accounting_financial_records"("idempotencyKey");
CREATE INDEX "accounting_financial_records_kind_status_idx" ON "accounting_financial_records"("kind", "status");
CREATE INDEX "accounting_financial_records_sourceKind_sourceId_idx" ON "accounting_financial_records"("sourceKind", "sourceId");
CREATE INDEX "accounting_financial_records_contractId_idx" ON "accounting_financial_records"("contractId");
CREATE INDEX "accounting_financial_records_customerId_idx" ON "accounting_financial_records"("customerId");
CREATE INDEX "accounting_invoice_candidate_items_invoiceId_idx" ON "accounting_invoice_candidate_items"("invoiceId");
CREATE INDEX "accounting_receivables_contractId_idx" ON "accounting_receivables"("contractId");
CREATE INDEX "accounting_receivables_customerId_idx" ON "accounting_receivables"("customerId");
CREATE INDEX "accounting_receivables_dueDate_idx" ON "accounting_receivables"("dueDate");
CREATE INDEX "accounting_receivables_status_idx" ON "accounting_receivables"("status");
CREATE INDEX "accounting_payment_statuses_contractId_idx" ON "accounting_payment_statuses"("contractId");
CREATE INDEX "accounting_payment_statuses_receivableId_idx" ON "accounting_payment_statuses"("receivableId");
CREATE INDEX "accounting_payment_statuses_status_idx" ON "accounting_payment_statuses"("status");
CREATE INDEX "accounting_payment_statuses_checkStatus_idx" ON "accounting_payment_statuses"("checkStatus");
CREATE INDEX "accounting_payment_statuses_checkDueDate_idx" ON "accounting_payment_statuses"("checkDueDate");
CREATE INDEX "accounting_tax_records_contractId_idx" ON "accounting_tax_records"("contractId");
CREATE INDEX "accounting_tax_records_invoiceRecordId_idx" ON "accounting_tax_records"("invoiceRecordId");
CREATE INDEX "accounting_tax_records_readinessStatus_idx" ON "accounting_tax_records"("readinessStatus");
CREATE INDEX "accounting_tax_records_submissionStatus_idx" ON "accounting_tax_records"("submissionStatus");
CREATE INDEX "accounting_contract_flags_contractId_idx" ON "accounting_contract_flags"("contractId");
CREATE INDEX "accounting_contract_flags_status_idx" ON "accounting_contract_flags"("status");
CREATE INDEX "accounting_correction_requests_contractId_idx" ON "accounting_correction_requests"("contractId");
CREATE INDEX "accounting_correction_requests_recordId_idx" ON "accounting_correction_requests"("recordId");
CREATE INDEX "accounting_correction_requests_status_idx" ON "accounting_correction_requests"("status");
CREATE INDEX "accounting_audit_logs_contractId_idx" ON "accounting_audit_logs"("contractId");
CREATE INDEX "accounting_audit_logs_recordId_idx" ON "accounting_audit_logs"("recordId");
CREATE INDEX "accounting_audit_logs_actorId_idx" ON "accounting_audit_logs"("actorId");
CREATE INDEX "accounting_audit_logs_createdAt_idx" ON "accounting_audit_logs"("createdAt");
CREATE UNIQUE INDEX "journal_vouchers_voucherNumber_key" ON "journal_vouchers"("voucherNumber");
CREATE INDEX "journal_vouchers_periodId_idx" ON "journal_vouchers"("periodId");
CREATE INDEX "journal_vouchers_sourceRecordId_idx" ON "journal_vouchers"("sourceRecordId");
CREATE INDEX "journal_vouchers_status_idx" ON "journal_vouchers"("status");
CREATE INDEX "journal_voucher_lines_voucherId_idx" ON "journal_voucher_lines"("voucherId");
CREATE INDEX "journal_voucher_lines_accountId_idx" ON "journal_voucher_lines"("accountId");

-- AddForeignKey
ALTER TABLE "chart_of_accounts" ADD CONSTRAINT "chart_of_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_financial_records" ADD CONSTRAINT "accounting_financial_records_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_invoice_candidate_items" ADD CONSTRAINT "accounting_invoice_candidate_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "accounting_financial_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "accounting_receivables" ADD CONSTRAINT "accounting_receivables_invoiceRecordId_fkey" FOREIGN KEY ("invoiceRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_payment_statuses" ADD CONSTRAINT "accounting_payment_statuses_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "accounting_receivables"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "accounting_tax_records" ADD CONSTRAINT "accounting_tax_records_invoiceRecordId_fkey" FOREIGN KEY ("invoiceRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "accounting_periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "journal_vouchers" ADD CONSTRAINT "journal_vouchers_sourceRecordId_fkey" FOREIGN KEY ("sourceRecordId") REFERENCES "accounting_financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "journal_voucher_lines" ADD CONSTRAINT "journal_voucher_lines_voucherId_fkey" FOREIGN KEY ("voucherId") REFERENCES "journal_vouchers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "journal_voucher_lines" ADD CONSTRAINT "journal_voucher_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
