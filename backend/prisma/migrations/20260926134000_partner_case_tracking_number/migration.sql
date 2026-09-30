BEGIN;
SET LOCAL lock_timeout = '5s';

-- Public numbers live outside the evidence-guarded Case aggregate.
-- Historical events, digests, and PC identities remain untouched.
CREATE SEQUENCE partner_case_tracking_number_seq AS integer START WITH 1 NO CYCLE;
CREATE TABLE partner_case_tracking_codes (
  "caseId" text PRIMARY KEY REFERENCES partner_sale_cases(id) ON DELETE RESTRICT ON UPDATE NO ACTION,
  number integer NOT NULL UNIQUE
);

INSERT INTO partner_case_tracking_codes ("caseId", number)
SELECT id, row_number() OVER (ORDER BY "createdAt", id)::integer
FROM partner_sale_cases;

SELECT setval('partner_case_tracking_number_seq',
  COALESCE((SELECT max(number) FROM partner_case_tracking_codes), 0) + 1, false);

COMMIT;
