-- CreateTable
CREATE TABLE "workspace_permissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "permissionLevel" TEXT NOT NULL,
    "grantedBy" TEXT,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "role_workspace_permissions" (
    "id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "workspace" TEXT NOT NULL,
    "permissionLevel" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "role_workspace_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_contracts" (
    "id" TEXT NOT NULL,
    "contractNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "titlePersian" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "customerId" TEXT NOT NULL,
    "departmentId" TEXT NOT NULL,
    "templateId" TEXT,
    "createdBy" TEXT NOT NULL,
    "approvedBy" TEXT,
    "signedBy" TEXT,
    "signedAt" TIMESTAMP(3),
    "printedAt" TIMESTAMP(3),
    "totalAmount" DECIMAL(15,2),
    "currency" TEXT NOT NULL DEFAULT 'ریال',
    "notes" TEXT,
    "contractData" JSONB,
    "calculations" JSONB,
    "signatures" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sales_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_customers" (
    "id" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "customerType" TEXT NOT NULL,
    "industry" TEXT,
    "size" TEXT,
    "status" TEXT NOT NULL DEFAULT 'Active',
    "primaryContactId" TEXT,
    "address" TEXT,
    "city" TEXT,
    "country" TEXT NOT NULL DEFAULT 'ایران',
    "communicationPreferences" JSONB,
    "customFields" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_contacts" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "position" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "mobile" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "communicationHistory" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_leads" (
    "id" TEXT NOT NULL,
    "customerId" TEXT,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'New',
    "score" INTEGER NOT NULL DEFAULT 0,
    "companyName" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "assignedTo" TEXT,
    "expectedValue" DECIMAL(15,2),
    "probability" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_communications" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contactId" TEXT,
    "type" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'Sent',
    "scheduledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "attachments" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_communications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "workspace_permissions_userId_workspace_key" ON "workspace_permissions"("userId", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "role_workspace_permissions_role_workspace_key" ON "role_workspace_permissions"("role", "workspace");

-- CreateIndex
CREATE UNIQUE INDEX "sales_contracts_contractNumber_key" ON "sales_contracts"("contractNumber");

-- CreateIndex
CREATE UNIQUE INDEX "crm_customers_primaryContactId_key" ON "crm_customers"("primaryContactId");

-- AddForeignKey
ALTER TABLE "workspace_permissions" ADD CONSTRAINT "workspace_permissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_permissions" ADD CONSTRAINT "workspace_permissions_grantedBy_fkey" FOREIGN KEY ("grantedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_departmentId_fkey" FOREIGN KEY ("departmentId") REFERENCES "departments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "contract_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_approvedBy_fkey" FOREIGN KEY ("approvedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_contracts" ADD CONSTRAINT "sales_contracts_signedBy_fkey" FOREIGN KEY ("signedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_customers" ADD CONSTRAINT "crm_customers_primaryContactId_fkey" FOREIGN KEY ("primaryContactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_contacts" ADD CONSTRAINT "crm_contacts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_leads" ADD CONSTRAINT "crm_leads_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_communications" ADD CONSTRAINT "crm_communications_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "crm_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
