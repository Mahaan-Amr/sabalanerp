CREATE TABLE "accounting_customer_allocation_fences" (
  "profileId" TEXT NOT NULL PRIMARY KEY,
  CONSTRAINT "accounting_customer_allocation_fences_profileId_fkey"
    FOREIGN KEY ("profileId") REFERENCES "accounting_customer_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
