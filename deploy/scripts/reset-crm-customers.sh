#!/bin/sh
set -eu

ENV_FILE="deploy/.env.prod"
APPLY=0
YES=0
SKIP_BACKUP=0
CLEAR_CONTRACT_PDFS=0
CLEAR_ACCOUNTING_PDFS=0

usage() {
  cat <<'EOF'
Usage:
  sh deploy/scripts/reset-crm-customers.sh [options]

Options:
  --env-file <path>          Docker Compose env file. Default: deploy/.env.prod
  --apply                    Actually delete CRM customer data. Without this, only counts are shown.
  --yes                      Do not ask for interactive confirmation.
  --skip-backup              Do not create a pg_dump backup before applying.
  --clear-contract-pdfs      Delete generated sales contract PDFs from backend storage.
  --clear-accounting-pdfs    Delete generated accounting contract PDFs from backend storage.
  -h, --help                 Show this help.

This resets active CRM customers for a fresh production start while preserving:
users, departments, product catalogs, permissions, templates, discount ranges,
accounting settings, periods, chart of accounts, uploads, and legacy customers.

Because SalesContract rows require a CRM customer, this script also clears sales
contracts and customer-linked accounting rows before deleting CRM customers.
EOF
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --env-file)
      ENV_FILE="${2:-}"
      if [ -z "$ENV_FILE" ]; then
        echo "Missing value for --env-file" >&2
        exit 1
      fi
      shift 2
      ;;
    --apply)
      APPLY=1
      shift
      ;;
    --yes)
      YES=1
      shift
      ;;
    --skip-backup)
      SKIP_BACKUP=1
      shift
      ;;
    --clear-contract-pdfs)
      CLEAR_CONTRACT_PDFS=1
      shift
      ;;
    --clear-accounting-pdfs)
      CLEAR_ACCOUNTING_PDFS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 1
      ;;
  esac
done

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

COMPOSE="docker compose --env-file $ENV_FILE -f docker-compose.prod.yml"

echo "Using env file: $ENV_FILE"
echo "Checking production containers..."
$COMPOSE ps postgres >/dev/null

run_psql() {
  $COMPOSE exec -T postgres sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}

echo
echo "Current CRM customer-related row counts:"
run_psql <<'SQL'
WITH customer_ids AS (
  SELECT id FROM crm_customers
),
contract_ids AS (
  SELECT id FROM sales_contracts
  WHERE "customerId" IN (SELECT id FROM customer_ids)
),
accounting_record_ids AS (
  SELECT id FROM accounting_financial_records
  WHERE "customerId" IN (SELECT id FROM customer_ids)
     OR "contractId" IN (SELECT id FROM contract_ids)
     OR ("sourceKind" = 'SALES_CONTRACT' AND "sourceId" IN (SELECT id FROM contract_ids))
),
receivable_ids AS (
  SELECT id FROM accounting_receivables
  WHERE "customerId" IN (SELECT id FROM customer_ids)
     OR "contractId" IN (SELECT id FROM contract_ids)
     OR "invoiceRecordId" IN (SELECT id FROM accounting_record_ids)
)
SELECT 'crm_customers' AS table_name, count(*) AS rows FROM crm_customers
UNION ALL SELECT 'project_addresses', count(*) FROM project_addresses WHERE "customerId" IN (SELECT id FROM customer_ids)
UNION ALL SELECT 'phone_numbers', count(*) FROM phone_numbers WHERE "customerId" IN (SELECT id FROM customer_ids)
UNION ALL SELECT 'crm_contacts', count(*) FROM crm_contacts WHERE "customerId" IN (SELECT id FROM customer_ids)
UNION ALL SELECT 'crm_communications', count(*) FROM crm_communications WHERE "customerId" IN (SELECT id FROM customer_ids)
UNION ALL SELECT 'crm_leads_linked_to_customers', count(*) FROM crm_leads WHERE "customerId" IN (SELECT id FROM customer_ids)
UNION ALL SELECT 'sales_contracts', count(*) FROM sales_contracts WHERE id IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'contract_items', count(*) FROM contract_items WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'deliveries', count(*) FROM deliveries WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'delivery_products', count(*) FROM delivery_products WHERE "deliveryId" IN (SELECT id FROM deliveries WHERE "contractId" IN (SELECT id FROM contract_ids))
UNION ALL SELECT 'payments', count(*) FROM payments WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'payment_installments', count(*) FROM payment_installments WHERE "paymentId" IN (SELECT id FROM payments WHERE "contractId" IN (SELECT id FROM contract_ids))
UNION ALL SELECT 'contract_verification_codes', count(*) FROM contract_verification_codes WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'contract_public_confirmations', count(*) FROM contract_public_confirmations WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'contract_confirmation_audit_logs', count(*) FROM contract_confirmation_audit_logs WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'accounting_financial_records', count(*) FROM accounting_financial_records WHERE id IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'accounting_invoice_candidate_items', count(*) FROM accounting_invoice_candidate_items WHERE "invoiceId" IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'accounting_receivables', count(*) FROM accounting_receivables WHERE id IN (SELECT id FROM receivable_ids)
UNION ALL SELECT 'accounting_payment_statuses', count(*) FROM accounting_payment_statuses WHERE "contractId" IN (SELECT id FROM contract_ids) OR "receivableId" IN (SELECT id FROM receivable_ids)
UNION ALL SELECT 'accounting_tax_records', count(*) FROM accounting_tax_records WHERE "contractId" IN (SELECT id FROM contract_ids) OR "invoiceRecordId" IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'accounting_contract_flags', count(*) FROM accounting_contract_flags WHERE "contractId" IN (SELECT id FROM contract_ids)
UNION ALL SELECT 'accounting_correction_requests', count(*) FROM accounting_correction_requests WHERE "contractId" IN (SELECT id FROM contract_ids) OR "recordId" IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'accounting_audit_logs', count(*) FROM accounting_audit_logs WHERE "contractId" IN (SELECT id FROM contract_ids) OR "recordId" IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'journal_vouchers', count(*) FROM journal_vouchers WHERE "sourceRecordId" IN (SELECT id FROM accounting_record_ids)
UNION ALL SELECT 'journal_voucher_lines', count(*) FROM journal_voucher_lines WHERE "voucherId" IN (SELECT id FROM journal_vouchers WHERE "sourceRecordId" IN (SELECT id FROM accounting_record_ids))
ORDER BY table_name;
SQL

if [ "$APPLY" -ne 1 ]; then
  echo
  echo "Dry run only. Re-run with --apply when the counts look right."
  exit 0
fi

if [ "$YES" -ne 1 ]; then
  echo
  printf "This will permanently delete all CRM customers and linked customer data. Type RESET_CUSTOMERS to continue: "
  read answer
  if [ "$answer" != "RESET_CUSTOMERS" ]; then
    echo "Aborted."
    exit 1
  fi
fi

if [ "$SKIP_BACKUP" -ne 1 ]; then
  mkdir -p backups
  BACKUP_PATH="backups/sabalanerp-before-customer-reset-$(date +%Y%m%d-%H%M%S).dump"
  echo "Creating database backup: $BACKUP_PATH"
  $COMPOSE exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --no-owner --no-acl' > "$BACKUP_PATH"
  echo "Backup complete."
fi

echo "Deleting CRM customer data..."
run_psql <<'SQL'
BEGIN;

CREATE TEMP TABLE reset_customer_ids AS
SELECT id FROM crm_customers;

CREATE TEMP TABLE reset_contract_ids AS
SELECT id FROM sales_contracts
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

CREATE TEMP TABLE reset_accounting_record_ids AS
SELECT id FROM accounting_financial_records
WHERE "customerId" IN (SELECT id FROM reset_customer_ids)
   OR "contractId" IN (SELECT id FROM reset_contract_ids)
   OR ("sourceKind" = 'SALES_CONTRACT' AND "sourceId" IN (SELECT id FROM reset_contract_ids));

CREATE TEMP TABLE reset_receivable_ids AS
SELECT id FROM accounting_receivables
WHERE "customerId" IN (SELECT id FROM reset_customer_ids)
   OR "contractId" IN (SELECT id FROM reset_contract_ids)
   OR "invoiceRecordId" IN (SELECT id FROM reset_accounting_record_ids);

CREATE TEMP TABLE reset_journal_voucher_ids AS
SELECT id FROM journal_vouchers
WHERE "sourceRecordId" IN (SELECT id FROM reset_accounting_record_ids);

UPDATE crm_customers
SET "primaryContactId" = NULL
WHERE id IN (SELECT id FROM reset_customer_ids);

UPDATE sales_contracts
SET "verificationCodeId" = NULL
WHERE id IN (SELECT id FROM reset_contract_ids);

DELETE FROM journal_voucher_lines
WHERE "voucherId" IN (SELECT id FROM reset_journal_voucher_ids);

DELETE FROM journal_vouchers
WHERE id IN (SELECT id FROM reset_journal_voucher_ids);

DELETE FROM accounting_invoice_candidate_items
WHERE "invoiceId" IN (SELECT id FROM reset_accounting_record_ids);

DELETE FROM accounting_payment_statuses
WHERE "contractId" IN (SELECT id FROM reset_contract_ids)
   OR "receivableId" IN (SELECT id FROM reset_receivable_ids);

DELETE FROM accounting_receivables
WHERE id IN (SELECT id FROM reset_receivable_ids);

DELETE FROM accounting_tax_records
WHERE "contractId" IN (SELECT id FROM reset_contract_ids)
   OR "invoiceRecordId" IN (SELECT id FROM reset_accounting_record_ids);

DELETE FROM accounting_contract_flags
WHERE "contractId" IN (SELECT id FROM reset_contract_ids);

DELETE FROM accounting_correction_requests
WHERE "contractId" IN (SELECT id FROM reset_contract_ids)
   OR "recordId" IN (SELECT id FROM reset_accounting_record_ids);

DELETE FROM accounting_audit_logs
WHERE "contractId" IN (SELECT id FROM reset_contract_ids)
   OR "recordId" IN (SELECT id FROM reset_accounting_record_ids);

DELETE FROM accounting_financial_records
WHERE id IN (SELECT id FROM reset_accounting_record_ids);

DELETE FROM contract_verification_codes
WHERE "contractId" IN (SELECT id FROM reset_contract_ids);

DELETE FROM sales_contracts
WHERE id IN (SELECT id FROM reset_contract_ids);

DELETE FROM crm_communications
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

DELETE FROM crm_leads
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

DELETE FROM crm_contacts
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

DELETE FROM phone_numbers
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

DELETE FROM project_addresses
WHERE "customerId" IN (SELECT id FROM reset_customer_ids);

DELETE FROM crm_customers
WHERE id IN (SELECT id FROM reset_customer_ids);

COMMIT;
SQL

if [ "$CLEAR_CONTRACT_PDFS" -eq 1 ]; then
  echo "Deleting generated sales contract PDFs..."
  $COMPOSE exec -T backend sh -c 'find /app/storage/contracts -type f -name "*.pdf" -delete 2>/dev/null || true'
fi

if [ "$CLEAR_ACCOUNTING_PDFS" -eq 1 ]; then
  echo "Deleting generated accounting contract PDFs..."
  $COMPOSE exec -T backend sh -c 'find /app/storage/accounting-contracts -type f \( -name "*.pdf" -o -name "*.png" \) -delete 2>/dev/null || true'
fi

echo
echo "Remaining CRM customers and sales contracts:"
run_psql <<'SQL'
SELECT 'crm_customers' AS table_name, count(*) AS rows FROM crm_customers
UNION ALL
SELECT 'sales_contracts', count(*) FROM sales_contracts
ORDER BY table_name;
SQL

echo
echo "Customer reset complete. Users can now start with fresh CRM customers."
