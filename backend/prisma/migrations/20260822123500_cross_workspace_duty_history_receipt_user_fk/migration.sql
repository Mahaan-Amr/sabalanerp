ALTER TABLE "cross_workspace_duty_history_receipts"
ADD CONSTRAINT "cross_workspace_duty_history_receipts_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
