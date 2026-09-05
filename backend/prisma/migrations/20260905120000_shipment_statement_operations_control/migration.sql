CREATE TYPE "ShipmentStatementOperationsAction" AS ENUM ('PAUSE_PLANNED', 'PAUSE_INCIDENT', 'RESUME');

CREATE TABLE "shipment_statement_operations_controls" (
    "id" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT true,
    "incident" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changedBy" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_statement_operations_controls_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_statement_operations_controls_incident_pause_check" CHECK (NOT "incident" OR "paused"),
    CONSTRAINT "shipment_statement_operations_controls_revision_check" CHECK ("revision" >= 0),
    CONSTRAINT "shipment_statement_operations_controls_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 8 AND 500)
);

CREATE TABLE "shipment_statement_operations_events" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "ShipmentStatementOperationsAction" NOT NULL,
    "paused" BOOLEAN NOT NULL,
    "incident" BOOLEAN NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousIntegrityHash" TEXT,
    "integrityHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "shipment_statement_operations_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "shipment_statement_operations_events_incident_pause_check" CHECK (NOT "incident" OR "paused"),
    CONSTRAINT "shipment_statement_operations_events_revision_check" CHECK ("revision" > 0),
    CONSTRAINT "shipment_statement_operations_events_reason_check" CHECK (char_length(btrim("reason")) BETWEEN 8 AND 500)
);

CREATE UNIQUE INDEX "shipment_statement_operations_events_revision_key" ON "shipment_statement_operations_events"("revision");
CREATE UNIQUE INDEX "shipment_statement_operations_events_integrityHash_key" ON "shipment_statement_operations_events"("integrityHash");
CREATE INDEX "shipment_statement_operations_events_createdAt_idx" ON "shipment_statement_operations_events"("createdAt");

INSERT INTO "shipment_statement_operations_controls" ("id", "paused", "incident", "revision", "reason")
VALUES ('customer-shipment-statements', true, false, 0, 'Paused safely until an administrator starts the activated flow.');

CREATE OR REPLACE FUNCTION "prevent_shipment_statement_operations_event_mutation"()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Shipment statement operations events are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shipment_statement_operations_events_no_update"
BEFORE UPDATE ON "shipment_statement_operations_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_shipment_statement_operations_event_mutation"();

CREATE TRIGGER "shipment_statement_operations_events_no_delete"
BEFORE DELETE ON "shipment_statement_operations_events"
FOR EACH ROW EXECUTE FUNCTION "prevent_shipment_statement_operations_event_mutation"();
