/** Local PostgreSQL 15.18 schema-only rollback witness, receipt SHA256 18433ae4f0246cf147e1afc35add6491c0d6d5e0055417ac020bd7d9d1804e4b. This provides no release authority. */
export const invoiceConstraintWitness=[
  {
    "tablename": "sales_dispatch_invoices",
    "conname": "sales_invoice_explicit_void_reason",
    "type": "c",
    "validated": true,
    "deferrable": false,
    "initially_deferred": false,
    "definition": "CHECK (((\"voidedAt\" IS NULL) OR ((\"voidReason\" IS NOT NULL) AND (\"voidedBy\" IS NOT NULL) AND (\"voidedAt\" >= \"issuedAt\"))))"
  },
  {
    "tablename": "sales_dispatch_invoices",
    "conname": "sales_invoice_hashes",
    "type": "c",
    "validated": true,
    "deferrable": false,
    "initially_deferred": false,
    "definition": "CHECK (((\"sourceHash\" ~ '^[0-9a-f]{64}$'::text) AND (\"pdfSha256\" ~ '^[0-9a-f]{64}$'::text) AND (octet_length(pdf) > 0)))"
  },
  {
    "tablename": "sales_dispatch_invoices",
    "conname": "sales_invoice_number_positive",
    "type": "c",
    "validated": true,
    "deferrable": false,
    "initially_deferred": false,
    "definition": "CHECK ((number > 0))"
  }
] as const;
