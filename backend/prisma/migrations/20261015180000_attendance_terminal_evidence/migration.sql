-- AlterTable
ALTER TABLE "attendance_intervals" ADD COLUMN     "confirmedAt" TIMESTAMP(3),
ADD COLUMN     "confirmedBy" TEXT,
ADD COLUMN     "confirmedRevision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "entrySource" TEXT NOT NULL DEFAULT 'MANUAL',
ADD COLUMN     "exitSource" TEXT,
ADD COLUMN     "exitUnknown" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ALTER COLUMN "entryRecordedBy" DROP NOT NULL;

-- CreateTable
CREATE TABLE "attendance_terminals" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'SHADOW',
    "activatedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastReceivedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "attendance_terminals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_terminal_periods" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),

    CONSTRAINT "attendance_terminal_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_terminal_mappings" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "personnelId" TEXT,
    "nameSnapshot" TEXT,
    "initialState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "ignored" BOOLEAN NOT NULL DEFAULT false,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "attendance_terminal_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_punches" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "deviceCode" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "verifyMode" INTEGER NOT NULL,
    "inOutRaw" INTEGER NOT NULL,
    "personnelId" TEXT,
    "nameSnapshot" TEXT,
    "mappingId" TEXT,
    "status" TEXT NOT NULL,
    "reason" TEXT,
    "direction" TEXT,
    "intervalId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_device_audits" (
    "id" TEXT NOT NULL,
    "terminalId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_device_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attendance_review_handovers" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "assigneeId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "pendingCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attendance_review_handovers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "attendance_terminal_periods_terminalId_startsAt_idx" ON "attendance_terminal_periods"("terminalId", "startsAt");

-- CreateIndex
CREATE INDEX "attendance_terminal_mappings_terminalId_deviceCode_effectiv_idx" ON "attendance_terminal_mappings"("terminalId", "deviceCode", "effectiveFrom");

-- CreateIndex
CREATE INDEX "attendance_terminal_mappings_personnelId_idx" ON "attendance_terminal_mappings"("personnelId");

-- CreateIndex
CREATE INDEX "attendance_punches_personnelId_occurredAt_idx" ON "attendance_punches"("personnelId", "occurredAt");

-- CreateIndex
CREATE INDEX "attendance_punches_terminalId_status_occurredAt_idx" ON "attendance_punches"("terminalId", "status", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_punches_terminalId_eventKey_key" ON "attendance_punches"("terminalId", "eventKey");

-- CreateIndex
CREATE INDEX "attendance_device_audits_terminalId_createdAt_idx" ON "attendance_device_audits"("terminalId", "createdAt");

-- AddForeignKey
ALTER TABLE "attendance_terminal_periods" ADD CONSTRAINT "attendance_terminal_periods_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "attendance_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_terminal_mappings" ADD CONSTRAINT "attendance_terminal_mappings_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "attendance_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance_punches" ADD CONSTRAINT "attendance_punches_terminalId_fkey" FOREIGN KEY ("terminalId") REFERENCES "attendance_terminals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Same lock for machine and manual writes; enforce against concurrent open/overlap writes.
CREATE FUNCTION attendance_interval_integrity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE subject TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(164000145);
  SELECT "personnelId" INTO subject FROM attendance_records WHERE id = NEW."attendanceRecordId";
  IF NEW."exitedAt" IS NOT NULL AND NEW."exitedAt" <= NEW."enteredAt" THEN
    RAISE EXCEPTION 'attendance_exit_before_entry' USING ERRCODE = '23514';
  END IF;
  IF NEW."exitUnknown" AND NEW."exitedAt" IS NOT NULL THEN
    RAISE EXCEPTION 'attendance_unknown_exit_has_time' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'ACTIVE' AND NOT NEW."exitUnknown" AND subject IS NOT NULL AND EXISTS (
    SELECT 1 FROM attendance_intervals i JOIN attendance_records r ON r.id = i."attendanceRecordId"
    WHERE r."personnelId" = subject AND i.id <> NEW.id AND i.status = 'ACTIVE' AND NOT i."exitUnknown"
      AND i."enteredAt" < COALESCE(NEW."exitedAt", 'infinity'::timestamp)
      AND COALESCE(i."exitedAt", 'infinity'::timestamp) > NEW."enteredAt"
  ) THEN RAISE EXCEPTION 'attendance_interval_overlap' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER attendance_interval_integrity_guard BEFORE INSERT OR UPDATE ON attendance_intervals
FOR EACH ROW EXECUTE FUNCTION attendance_interval_integrity();
CREATE UNIQUE INDEX attendance_terminal_one_current_mapping ON attendance_terminal_mappings ("terminalId", "deviceCode") WHERE "effectiveTo" IS NULL;
ALTER TABLE attendance_terminal_mappings ADD CONSTRAINT attendance_mapping_personnel_fk FOREIGN KEY ("personnelId") REFERENCES personnel(id) ON DELETE RESTRICT;
ALTER TABLE attendance_punches ADD CONSTRAINT attendance_punch_interval_fk FOREIGN KEY ("intervalId") REFERENCES attendance_intervals(id) ON DELETE RESTRICT;
