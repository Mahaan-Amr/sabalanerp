CREATE TABLE "project_return_sepidar_revisions" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "invoices" JSONB NOT NULL,
    "totalRial" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "project_return_sepidar_revisions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "project_return_sepidar_revisions_draftId_fkey" FOREIGN KEY ("draftId")
        REFERENCES "project_return_allocation_drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_return_sepidar_revisions_draftId_number_key"
    ON "project_return_sepidar_revisions"("draftId", "number");
