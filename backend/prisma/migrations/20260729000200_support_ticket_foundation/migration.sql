-- CreateTable
CREATE TABLE "support_tickets" (
    "id" TEXT NOT NULL,
    "referenceCode" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "impact" TEXT NOT NULL,
    "workaroundExists" BOOLEAN NOT NULL,
    "reportedWorkspace" TEXT,
    "reportedFeature" TEXT,
    "originRoute" TEXT NOT NULL,
    "diagnosticSnapshot" JSONB NOT NULL,
    "releaseBuild" TEXT,
    "effectiveAccessSnapshot" JSONB NOT NULL,
    "sensitiveEvidenceConsent" BOOLEAN NOT NULL DEFAULT false,
    "restrictedIncident" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "suggestedPriority" TEXT NOT NULL,
    "confirmedPriority" TEXT,
    "priorityReason" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "waitingForReporterAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "reopenUntil" TIMESTAMP(3),
    "canonicalTicketId" TEXT,
    "slaPolicyVersion" INTEGER,
    "acknowledgmentDueAt" TIMESTAMP(3),
    "resolutionDueAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_participants" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "support_ticket_participants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_entries" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "kind" TEXT NOT NULL DEFAULT 'COMMENT',
    "body" TEXT,
    "correctionOfId" TEXT,
    "transcriptOriginal" TEXT,
    "transcriptCurrent" TEXT,
    "transcriptVersion" INTEGER NOT NULL DEFAULT 0,
    "redactedAt" TIMESTAMP(3),
    "redactionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "entryId" TEXT,
    "kind" TEXT NOT NULL,
    "storageName" TEXT,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "durationSeconds" INTEGER,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "malwareScanStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "retentionClass" TEXT NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletionPolicy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_attachment_accesses" (
    "id" TEXT NOT NULL,
    "attachmentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachment_accesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_audit_events" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "reason" TEXT,
    "beforeData" JSONB,
    "afterData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_legal_holds" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_legal_holds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_referenceCode_key" ON "support_tickets"("referenceCode");

-- CreateIndex
CREATE INDEX "support_tickets_reporterId_createdAt_idx" ON "support_tickets"("reporterId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_reportedWorkspace_status_createdAt_idx" ON "support_tickets"("reportedWorkspace", "status", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_restrictedIncident_status_createdAt_idx" ON "support_tickets"("restrictedIncident", "status", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_canonicalTicketId_idx" ON "support_tickets"("canonicalTicketId");

-- CreateIndex
CREATE INDEX "support_ticket_participants_userId_removedAt_assignedAt_idx" ON "support_ticket_participants"("userId", "removedAt", "assignedAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_ticket_participants_ticketId_userId_key" ON "support_ticket_participants"("ticketId", "userId");

-- CreateIndex
CREATE INDEX "support_ticket_entries_ticketId_createdAt_idx" ON "support_ticket_entries"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_entries_correctionOfId_idx" ON "support_ticket_entries"("correctionOfId");

-- CreateIndex
CREATE INDEX "support_ticket_attachments_ticketId_sensitive_createdAt_idx" ON "support_ticket_attachments"("ticketId", "sensitive", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_attachments_deletedAt_idx" ON "support_ticket_attachments"("deletedAt");

-- CreateIndex
CREATE INDEX "support_ticket_attachment_accesses_attachmentId_createdAt_idx" ON "support_ticket_attachment_accesses"("attachmentId", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_attachment_accesses_userId_createdAt_idx" ON "support_ticket_attachment_accesses"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_audit_events_ticketId_createdAt_idx" ON "support_ticket_audit_events"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_legal_holds_ticketId_releasedAt_idx" ON "support_ticket_legal_holds"("ticketId", "releasedAt");

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_canonicalTicketId_fkey" FOREIGN KEY ("canonicalTicketId") REFERENCES "support_tickets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_participants" ADD CONSTRAINT "support_ticket_participants_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_participants" ADD CONSTRAINT "support_ticket_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_entries" ADD CONSTRAINT "support_ticket_entries_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_entries" ADD CONSTRAINT "support_ticket_entries_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_entries" ADD CONSTRAINT "support_ticket_entries_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "support_ticket_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "support_ticket_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachment_accesses" ADD CONSTRAINT "support_ticket_attachment_accesses_attachmentId_fkey" FOREIGN KEY ("attachmentId") REFERENCES "support_ticket_attachments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachment_accesses" ADD CONSTRAINT "support_ticket_attachment_accesses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_audit_events" ADD CONSTRAINT "support_ticket_audit_events_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_audit_events" ADD CONSTRAINT "support_ticket_audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_legal_holds" ADD CONSTRAINT "support_ticket_legal_holds_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_legal_holds" ADD CONSTRAINT "support_ticket_legal_holds_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
