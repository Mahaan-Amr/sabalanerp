ALTER TABLE "crm_customers"
  ADD COLUMN "referrerFirstName" TEXT,
  ADD COLUMN "referrerLastName" TEXT,
  ADD COLUMN "referrerPhoneNumber" TEXT;

ALTER TABLE "project_addresses"
  ADD COLUMN "marketerFirstName" TEXT,
  ADD COLUMN "marketerLastName" TEXT,
  ADD COLUMN "marketerPhoneNumber" TEXT;
