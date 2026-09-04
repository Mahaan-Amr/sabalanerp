CREATE TABLE "partner_operations_controls" (
    "id" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "enrollmentPaused" BOOLEAN NOT NULL DEFAULT true,
    "operationalPaused" BOOLEAN NOT NULL DEFAULT true,
    "lastOperationalPauseAt" TIMESTAMPTZ(3),
    "cohortId" TEXT,
    "readinessEvidence" JSONB,
    CONSTRAINT "partner_operations_controls_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "partner_operations_control_events" (
    "id" TEXT NOT NULL,
    "controlId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "commandId" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "partner_operations_control_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "partner_operations_controls_cohortId_key" ON "partner_operations_controls"("cohortId");
CREATE UNIQUE INDEX "partner_operations_control_events_commandId_key" ON "partner_operations_control_events"("commandId");
CREATE UNIQUE INDEX "partner_operations_control_events_controlId_revision_key" ON "partner_operations_control_events"("controlId", "revision");

ALTER TABLE "partner_operations_controls" ADD CONSTRAINT "partner_operations_controls_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "partner_release_cohorts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "partner_operations_control_events" ADD CONSTRAINT "partner_operations_control_events_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "partner_operations_controls"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "partner_operations_controls" ("id", "revision", "enrollmentPaused", "operationalPaused")
VALUES ('partner-operations', 1, true, true);
