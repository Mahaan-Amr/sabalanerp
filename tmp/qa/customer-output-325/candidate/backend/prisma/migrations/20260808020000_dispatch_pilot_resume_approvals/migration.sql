ALTER TYPE "DispatchCutoverActionType" ADD VALUE 'PILOT_RESUME_APPROVAL_RECORDED';
CREATE TYPE "DispatchPilotApprovalRole" AS ENUM ('INCIDENT_LEAD', 'GUARD', 'LOGISTICS', 'ACCOUNTING');

CREATE TABLE "dispatch_pilot_resume_approvals" (
  "id" TEXT PRIMARY KEY,
  "controlId" TEXT NOT NULL REFERENCES "dispatch_cutover_control"("id") ON DELETE RESTRICT,
  "cutoverVersion" INTEGER NOT NULL,
  "pauseAt" TIMESTAMP(3) NOT NULL,
  "approvalRole" "DispatchPilotApprovalRole" NOT NULL,
  "evidence" JSONB NOT NULL,
  "approvedBy" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "integrityHash" TEXT NOT NULL UNIQUE
);

CREATE INDEX "dispatch_pilot_resume_approvals_controlId_cutoverVersion_pauseAt_approvalRole_approvedAt_idx"
  ON "dispatch_pilot_resume_approvals"("controlId", "cutoverVersion", "pauseAt", "approvalRole", "approvedAt");

CREATE TRIGGER "dispatch_pilot_resume_approvals_immutable"
  BEFORE UPDATE OR DELETE ON "dispatch_pilot_resume_approvals"
  FOR EACH ROW EXECUTE FUNCTION prevent_dispatch_cutover_evidence_mutation();
