ALTER TABLE partner_sale_cases DROP CONSTRAINT partner_case_shape;

ALTER TABLE partner_sale_cases ADD CONSTRAINT partner_case_shape CHECK
  ("headRevision" > 0 AND "stateRevision" > 0
   AND ("internalRecordId" IS NULL OR "customerContractId" IS NULL OR "internalRecordId" <> "customerContractId")
   AND "integrityHash" ~ '^sha256-v1:[a-f0-9]{64}$'
   AND ((state IN ('COMMITTED','VOIDED') AND "committedAt" IS NOT NULL AND "commitmentTrigger" IS NOT NULL
     AND "commitmentTrigger" IN ('FINALIZED','SIGNED','PRINTED') AND "committedRevision" IS NOT NULL
     AND "committedRevision" > 0 AND "committedRevision" <= "headRevision" AND "commitmentEventId" IS NOT NULL)
   OR (state NOT IN ('COMMITTED','VOIDED') AND "committedAt" IS NULL AND "commitmentTrigger" IS NULL
     AND "committedRevision" IS NULL AND "commitmentEventId" IS NULL)));
