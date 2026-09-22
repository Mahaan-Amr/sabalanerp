ALTER TABLE partner_customer_transfers
  DROP CONSTRAINT partner_customer_transfer_decision_complete;

ALTER TABLE partner_customer_transfers
  ADD CONSTRAINT partner_customer_transfer_decision_complete CHECK (
    (status = 'PENDING' AND revision = 1 AND "decidedBy" IS NULL AND "decisionReason" IS NULL
      AND "decidedAt" IS NULL AND "decisionCommandId" IS NULL) OR
    (status IN ('APPROVED', 'REJECTED', 'CANCELLED') AND revision = 2 AND "decidedBy" IS NOT NULL
      AND length(trim("decisionReason")) >= 3 AND "decidedAt" IS NOT NULL AND "decisionCommandId" IS NOT NULL)
  );
