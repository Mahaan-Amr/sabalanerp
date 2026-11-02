-- CreateTable
CREATE TABLE "purchasing_documents" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "kind" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "contractId" TEXT,
    "customerId" TEXT,
    "parentId" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchasing_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing_links" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "quantity" DECIMAL(65,30),
    "unit" TEXT,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchasing_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing_events" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "previousHash" TEXT,
    "entryHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchasing_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing_commands" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchasing_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing_suppliers" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "customerId" TEXT,
    "accountingPartyId" TEXT,
    "name" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "purchasing_suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchasing_existing_evidence" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchasing_existing_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_documents_number_key" ON "purchasing_documents"("number");

-- CreateIndex
CREATE INDEX "purchasing_documents_kind_status_createdAt_idx" ON "purchasing_documents"("kind", "status", "createdAt");

-- CreateIndex
CREATE INDEX "purchasing_documents_contractId_kind_idx" ON "purchasing_documents"("contractId", "kind");

-- CreateIndex
CREATE INDEX "purchasing_documents_creatorId_kind_idx" ON "purchasing_documents"("creatorId", "kind");

-- CreateIndex
CREATE INDEX "purchasing_documents_ownerId_kind_idx" ON "purchasing_documents"("ownerId", "kind");

-- CreateIndex
CREATE INDEX "purchasing_documents_parentId_kind_idx" ON "purchasing_documents"("parentId", "kind");

-- CreateIndex
CREATE INDEX "purchasing_links_targetId_purpose_idx" ON "purchasing_links"("targetId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_links_sourceId_targetId_purpose_key" ON "purchasing_links"("sourceId", "targetId", "purpose");

-- CreateIndex
CREATE INDEX "purchasing_events_actorId_createdAt_idx" ON "purchasing_events"("actorId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_events_documentId_version_key" ON "purchasing_events"("documentId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_commands_actorId_key_key" ON "purchasing_commands"("actorId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_suppliers_identityKey_key" ON "purchasing_suppliers"("identityKey");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_suppliers_customerId_key" ON "purchasing_suppliers"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_suppliers_accountingPartyId_key" ON "purchasing_suppliers"("accountingPartyId");

-- CreateIndex
CREATE INDEX "purchasing_existing_evidence_documentId_idx" ON "purchasing_existing_evidence"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "purchasing_existing_evidence_sourceType_sourceId_key" ON "purchasing_existing_evidence"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "purchasing_links" ADD CONSTRAINT "purchasing_links_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "purchasing_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_links" ADD CONSTRAINT "purchasing_links_targetId_fkey" FOREIGN KEY ("targetId") REFERENCES "purchasing_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "purchasing_events" ADD CONSTRAINT "purchasing_events_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "purchasing_documents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Accepted events and source links are evidence, not editable bookkeeping rows.
CREATE FUNCTION purchasing_reject_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchasing evidence is append-only; create a new referenced event';
END;
$$;
CREATE TRIGGER purchasing_events_append_only BEFORE UPDATE OR DELETE ON purchasing_events
FOR EACH ROW EXECUTE FUNCTION purchasing_reject_evidence_mutation();
CREATE TRIGGER purchasing_existing_evidence_append_only BEFORE UPDATE OR DELETE ON purchasing_existing_evidence
FOR EACH ROW EXECUTE FUNCTION purchasing_reject_evidence_mutation();
CREATE TRIGGER purchasing_commands_append_only BEFORE UPDATE OR DELETE ON purchasing_commands
FOR EACH ROW EXECUTE FUNCTION purchasing_reject_evidence_mutation();
CREATE INDEX purchasing_exchange_order_lookup ON purchasing_documents ((data->>'orderId')) WHERE kind = 'EXCHANGE';
