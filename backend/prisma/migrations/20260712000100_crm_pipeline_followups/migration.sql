-- CRM pipeline, follow-up reporting, next actions, and timeline events.

CREATE TABLE "crm_potential_projects" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "responsibleSellerId" TEXT NOT NULL,
    "createdBy" TEXT,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'جدید',
    "workType" TEXT NOT NULL,
    "address" TEXT,
    "estimatedValue" DECIMAL(15,2),
    "probability" INTEGER,
    "expectedCloseDate" TIMESTAMP(3),
    "description" TEXT,
    "source" TEXT,
    "lostReason" TEXT,
    "dormantReason" TEXT,
    "revisitDate" TIMESTAMP(3),
    "wonSalesContractId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_potential_projects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_follow_up_reports" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "potentialProjectId" TEXT,
    "sellerId" TEXT NOT NULL,
    "communicationType" TEXT NOT NULL,
    "workType" TEXT NOT NULL,
    "happenedAt" TIMESTAMP(3) NOT NULL,
    "summary" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "hasNextAction" BOOLEAN NOT NULL DEFAULT true,
    "noNextActionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_follow_up_reports_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_next_actions" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "potentialProjectId" TEXT,
    "followUpReportId" TEXT,
    "assignedToId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "communicationType" TEXT NOT NULL,
    "workType" TEXT,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "instructions" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'باز',
    "completedAt" TIMESTAMP(3),
    "completedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "crm_next_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "crm_timeline_events" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "potentialProjectId" TEXT,
    "actorId" TEXT,
    "eventType" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_timeline_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_potential_projects_wonSalesContractId_key" ON "crm_potential_projects"("wonSalesContractId");
CREATE INDEX "crm_potential_projects_customerId_idx" ON "crm_potential_projects"("customerId");
CREATE INDEX "crm_potential_projects_responsibleSellerId_idx" ON "crm_potential_projects"("responsibleSellerId");
CREATE INDEX "crm_potential_projects_status_idx" ON "crm_potential_projects"("status");
CREATE INDEX "crm_potential_projects_workType_idx" ON "crm_potential_projects"("workType");
CREATE INDEX "crm_potential_projects_expectedCloseDate_idx" ON "crm_potential_projects"("expectedCloseDate");

CREATE INDEX "crm_follow_up_reports_customerId_idx" ON "crm_follow_up_reports"("customerId");
CREATE INDEX "crm_follow_up_reports_potentialProjectId_idx" ON "crm_follow_up_reports"("potentialProjectId");
CREATE INDEX "crm_follow_up_reports_sellerId_idx" ON "crm_follow_up_reports"("sellerId");
CREATE INDEX "crm_follow_up_reports_happenedAt_idx" ON "crm_follow_up_reports"("happenedAt");

CREATE UNIQUE INDEX "crm_next_actions_followUpReportId_key" ON "crm_next_actions"("followUpReportId");
CREATE INDEX "crm_next_actions_customerId_idx" ON "crm_next_actions"("customerId");
CREATE INDEX "crm_next_actions_potentialProjectId_idx" ON "crm_next_actions"("potentialProjectId");
CREATE INDEX "crm_next_actions_assignedToId_idx" ON "crm_next_actions"("assignedToId");
CREATE INDEX "crm_next_actions_dueAt_idx" ON "crm_next_actions"("dueAt");
CREATE INDEX "crm_next_actions_status_idx" ON "crm_next_actions"("status");

CREATE INDEX "crm_timeline_events_customerId_idx" ON "crm_timeline_events"("customerId");
CREATE INDEX "crm_timeline_events_potentialProjectId_idx" ON "crm_timeline_events"("potentialProjectId");
CREATE INDEX "crm_timeline_events_actorId_idx" ON "crm_timeline_events"("actorId");
CREATE INDEX "crm_timeline_events_eventType_idx" ON "crm_timeline_events"("eventType");

ALTER TABLE "crm_potential_projects" ADD CONSTRAINT "crm_potential_projects_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_potential_projects" ADD CONSTRAINT "crm_potential_projects_responsibleSellerId_fkey" FOREIGN KEY ("responsibleSellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_potential_projects" ADD CONSTRAINT "crm_potential_projects_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_potential_projects" ADD CONSTRAINT "crm_potential_projects_wonSalesContractId_fkey" FOREIGN KEY ("wonSalesContractId") REFERENCES "sales_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_follow_up_reports" ADD CONSTRAINT "crm_follow_up_reports_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_follow_up_reports" ADD CONSTRAINT "crm_follow_up_reports_potentialProjectId_fkey" FOREIGN KEY ("potentialProjectId") REFERENCES "crm_potential_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_follow_up_reports" ADD CONSTRAINT "crm_follow_up_reports_sellerId_fkey" FOREIGN KEY ("sellerId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "crm_next_actions" ADD CONSTRAINT "crm_next_actions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_next_actions" ADD CONSTRAINT "crm_next_actions_potentialProjectId_fkey" FOREIGN KEY ("potentialProjectId") REFERENCES "crm_potential_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_next_actions" ADD CONSTRAINT "crm_next_actions_followUpReportId_fkey" FOREIGN KEY ("followUpReportId") REFERENCES "crm_follow_up_reports"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_next_actions" ADD CONSTRAINT "crm_next_actions_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_next_actions" ADD CONSTRAINT "crm_next_actions_completedBy_fkey" FOREIGN KEY ("completedBy") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "crm_timeline_events" ADD CONSTRAINT "crm_timeline_events_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "crm_customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "crm_timeline_events" ADD CONSTRAINT "crm_timeline_events_potentialProjectId_fkey" FOREIGN KEY ("potentialProjectId") REFERENCES "crm_potential_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "crm_timeline_events" ADD CONSTRAINT "crm_timeline_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
