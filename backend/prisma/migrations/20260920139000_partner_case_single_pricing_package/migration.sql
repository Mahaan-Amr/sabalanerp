-- One numbered Case revision owns one pricing package. Retries replay the same
-- command/package rather than creating duplicate responder work.
CREATE UNIQUE INDEX partner_inquiries_case_revision_key
  ON partner_inquiries ("caseId", "caseRevision");
