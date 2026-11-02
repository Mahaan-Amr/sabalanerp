CREATE TABLE purchasing_attachments (
  id TEXT PRIMARY KEY,
  "documentId" TEXT NOT NULL REFERENCES purchasing_documents(id) ON DELETE RESTRICT,
  "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL CHECK ("mimeType" IN ('application/pdf','image/jpeg','image/png','image/webp')),
  size INTEGER NOT NULL CHECK (size > 0 AND size <= 10485760),
  sha256 TEXT NOT NULL,
  visibility TEXT NOT NULL CHECK (visibility IN ('SPECIFICATION','COMMERCIAL')),
  bytes BYTEA NOT NULL,
  "scanStatus" TEXT NOT NULL CHECK ("scanStatus" = 'CLEAN'),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (octet_length(bytes) = size)
);
CREATE UNIQUE INDEX purchasing_attachments_document_sha_key ON purchasing_attachments("documentId",sha256);
CREATE INDEX purchasing_attachments_document_created_idx ON purchasing_attachments("documentId","createdAt");
CREATE TRIGGER purchasing_attachments_append_only BEFORE UPDATE OR DELETE ON purchasing_attachments
FOR EACH ROW EXECUTE FUNCTION purchasing_reject_evidence_mutation();
