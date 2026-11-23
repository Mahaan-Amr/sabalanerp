CREATE TABLE "stone_return_finalizations" (
  "id" TEXT NOT NULL,
  "receiptId" TEXT NOT NULL,
  "draftId" TEXT NOT NULL,
  "draftVersion" INTEGER NOT NULL CHECK ("draftVersion" > 0),
  "draftHash" TEXT NOT NULL CHECK ("draftHash" ~ '^[0-9a-f]{64}$'),
  "requestId" TEXT NOT NULL,
  "commandHash" TEXT NOT NULL CHECK ("commandHash" ~ '^[0-9a-f]{64}$'),
  "finalizedBy" TEXT NOT NULL,
  "finalizedAt" TIMESTAMP(3) NOT NULL,
  "documentDate" TIMESTAMP(3) NOT NULL,
  "bookId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "postingRuleId" TEXT NOT NULL,
  "summary" JSONB NOT NULL CHECK (jsonb_typeof("summary") = 'object'),
  CONSTRAINT "stone_return_finalizations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "stone_return_finalizations_receiptId_fkey"
    FOREIGN KEY ("receiptId") REFERENCES "stone_return_receipts"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "stone_return_finalizations_draftId_fkey"
    FOREIGN KEY ("draftId") REFERENCES "stone_return_allocation_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "stone_return_finalizations_receiptId_key" ON "stone_return_finalizations"("receiptId");
CREATE UNIQUE INDEX "stone_return_finalizations_draftId_key" ON "stone_return_finalizations"("draftId");

CREATE TRIGGER "stone_return_finalizations_immutability" BEFORE UPDATE OR DELETE ON "stone_return_finalizations"
  FOR EACH ROW EXECUTE FUNCTION accounting_guard_supply_chain_append_only();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    REVOKE ALL ON TABLE public.stone_return_finalizations FROM sabalan_application_runtime;
    GRANT SELECT, INSERT ON TABLE public.stone_return_finalizations TO sabalan_application_runtime;
  END IF;
END $$;
