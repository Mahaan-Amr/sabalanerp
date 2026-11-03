ALTER TABLE "security_shift_log_entries" ALTER COLUMN "description" DROP NOT NULL;

CREATE TABLE "security_shift_log_participants" (
  "id" TEXT NOT NULL, "entryId" TEXT NOT NULL, "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_shift_log_participants_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "security_shift_log_participants_entryId_userId_key" ON "security_shift_log_participants"("entryId", "userId");
CREATE INDEX "security_shift_log_participants_userId_idx" ON "security_shift_log_participants"("userId");
ALTER TABLE "security_shift_log_participants" ADD CONSTRAINT "security_shift_log_participants_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "security_shift_log_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_shift_log_participants" ADD CONSTRAINT "security_shift_log_participants_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "security_shift_log_attachments" (
  "id" TEXT NOT NULL, "entryId" TEXT NOT NULL, "storageName" TEXT NOT NULL, "originalName" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL, "size" INTEGER NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_shift_log_attachments_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "security_shift_log_attachments_entryId_idx" ON "security_shift_log_attachments"("entryId");
ALTER TABLE "security_shift_log_attachments" ADD CONSTRAINT "security_shift_log_attachments_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "security_shift_log_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
