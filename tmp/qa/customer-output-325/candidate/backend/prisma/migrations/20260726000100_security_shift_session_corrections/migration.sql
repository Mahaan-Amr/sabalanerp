ALTER TABLE "security_shift_plan_slots"
ADD COLUMN "noShiftConfirmedAt" TIMESTAMP(3),
ADD COLUMN "noShiftConfirmedBy" TEXT,
ADD COLUMN "noShiftConfirmedByName" TEXT,
ADD COLUMN "noShiftConfirmReason" TEXT;

CREATE TABLE "security_shift_session_corrections" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "correctedBy" TEXT NOT NULL,
    "correctedByName" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "previousStartedAt" TIMESTAMP(3),
    "previousEndedAt" TIMESTAMP(3),
    "effectiveStartedAt" TIMESTAMP(3) NOT NULL,
    "effectiveEndedAt" TIMESTAMP(3),
    "reconstructedStart" BOOLEAN NOT NULL DEFAULT false,
    "reconstructedEnd" BOOLEAN NOT NULL DEFAULT false,
    "correctedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_shift_session_corrections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "security_shift_session_corrections_sessionId_correctedAt_idx"
ON "security_shift_session_corrections"("sessionId", "correctedAt");

CREATE INDEX "security_shift_session_corrections_correctedBy_correctedAt_idx"
ON "security_shift_session_corrections"("correctedBy", "correctedAt");

ALTER TABLE "security_shift_session_corrections"
ADD CONSTRAINT "security_shift_session_corrections_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "security_shift_sessions"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
