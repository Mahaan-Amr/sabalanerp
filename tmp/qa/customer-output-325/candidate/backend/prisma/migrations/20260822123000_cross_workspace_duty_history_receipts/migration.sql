CREATE TABLE "cross_workspace_duty_history_receipts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "destinationWorkspaceCode" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cross_workspace_duty_history_receipts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cross_workspace_duty_history_receipts_userId_destinationWorkspaceCode_key"
ON "cross_workspace_duty_history_receipts"("userId", "destinationWorkspaceCode");

CREATE INDEX "cross_workspace_duty_history_receipts_destinationWorkspaceCode_lastSeenAt_idx"
ON "cross_workspace_duty_history_receipts"("destinationWorkspaceCode", "lastSeenAt");
