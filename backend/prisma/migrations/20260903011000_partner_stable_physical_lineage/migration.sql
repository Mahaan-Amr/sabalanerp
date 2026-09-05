-- Fail closed if historical rows disagree; never merge or delete physical history.
CREATE UNIQUE INDEX "partner_fulfillment_one_physical_row"
  ON "partner_fulfillment_lineages" ("caseId", "productRowId");
