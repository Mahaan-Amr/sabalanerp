ALTER TABLE "dispatch_outages" ADD COLUMN "actualStartedAt" TIMESTAMP(3);
ALTER TABLE "dispatch_outages" ADD COLUMN "actualEndedAt" TIMESTAMP(3);

UPDATE "dispatch_outages"
SET "actualStartedAt" = "verifiedAt",
    "actualEndedAt" = "endedAt";

ALTER TABLE "dispatch_outages" ALTER COLUMN "actualStartedAt" SET NOT NULL;

CREATE OR REPLACE FUNCTION prevent_shipment_quantity_evidence_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Shipment quantity evidence is append-only and immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "shipment_quantity_evidence_immutable"
BEFORE UPDATE OR DELETE ON "shipment_quantity_evidence"
FOR EACH ROW EXECUTE FUNCTION prevent_shipment_quantity_evidence_mutation();
