CREATE TABLE "personnel_behavior_survey_campaigns" (
  "id" TEXT NOT NULL,
  "titleFa" TEXT NOT NULL,
  "periodKey" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "opensAt" TIMESTAMP(3),
  "closesAt" TIMESTAMP(3),
  "createdByUserId" TEXT NOT NULL,
  "activatedByUserId" TEXT,
  "activatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personnel_behavior_survey_campaigns_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_questions" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "sectionCode" TEXT NOT NULL,
  "promptFa" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL,
  CONSTRAINT "personnel_behavior_survey_questions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_targets" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  CONSTRAINT "personnel_behavior_survey_targets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_respondents" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "personnelId" TEXT NOT NULL,
  CONSTRAINT "personnel_behavior_survey_respondents_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_responses" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "targetPersonnelId" TEXT NOT NULL,
  "respondentPersonnelId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "version" INTEGER NOT NULL DEFAULT 1,
  "commentText" TEXT,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "personnel_behavior_survey_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_answers" (
  "id" TEXT NOT NULL,
  "responseId" TEXT NOT NULL,
  "questionId" TEXT NOT NULL,
  "optionCode" TEXT NOT NULL,
  "numericScore" INTEGER,
  CONSTRAINT "personnel_behavior_survey_answers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "personnel_behavior_survey_audits" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT,
  "responseId" TEXT,
  "actorUserId" TEXT NOT NULL,
  "eventType" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "personnel_behavior_survey_audits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "personnel_behavior_survey_campaigns_status_opensAt_closesAt_idx" ON "personnel_behavior_survey_campaigns"("status", "opensAt", "closesAt");
CREATE INDEX "personnel_behavior_survey_campaigns_periodKey_version_idx" ON "personnel_behavior_survey_campaigns"("periodKey", "version");
CREATE UNIQUE INDEX "personnel_behavior_survey_questions_campaignId_sortOrder_key" ON "personnel_behavior_survey_questions"("campaignId", "sortOrder");
CREATE INDEX "personnel_behavior_survey_questions_campaignId_sectionCode_idx" ON "personnel_behavior_survey_questions"("campaignId", "sectionCode");
CREATE UNIQUE INDEX "personnel_behavior_survey_targets_campaignId_personnelId_key" ON "personnel_behavior_survey_targets"("campaignId", "personnelId");
CREATE INDEX "personnel_behavior_survey_targets_personnelId_campaignId_idx" ON "personnel_behavior_survey_targets"("personnelId", "campaignId");
CREATE UNIQUE INDEX "personnel_behavior_survey_respondents_campaignId_personnelId_key" ON "personnel_behavior_survey_respondents"("campaignId", "personnelId");
CREATE INDEX "personnel_behavior_survey_respondents_personnelId_campaignId_idx" ON "personnel_behavior_survey_respondents"("personnelId", "campaignId");
CREATE UNIQUE INDEX "personnel_behavior_survey_responses_campaignId_targetPersonnelId_respondentPersonnelId_key" ON "personnel_behavior_survey_responses"("campaignId", "targetPersonnelId", "respondentPersonnelId");
CREATE INDEX "personnel_behavior_survey_responses_targetPersonnelId_campaignId_status_idx" ON "personnel_behavior_survey_responses"("targetPersonnelId", "campaignId", "status");
CREATE INDEX "personnel_behavior_survey_responses_respondentPersonnelId_campaignId_status_idx" ON "personnel_behavior_survey_responses"("respondentPersonnelId", "campaignId", "status");
CREATE UNIQUE INDEX "personnel_behavior_survey_answers_responseId_questionId_key" ON "personnel_behavior_survey_answers"("responseId", "questionId");
CREATE INDEX "personnel_behavior_survey_answers_questionId_optionCode_idx" ON "personnel_behavior_survey_answers"("questionId", "optionCode");
CREATE INDEX "personnel_behavior_survey_audits_campaignId_createdAt_idx" ON "personnel_behavior_survey_audits"("campaignId", "createdAt");
CREATE INDEX "personnel_behavior_survey_audits_responseId_createdAt_idx" ON "personnel_behavior_survey_audits"("responseId", "createdAt");

ALTER TABLE "personnel_behavior_survey_questions" ADD CONSTRAINT "personnel_behavior_survey_questions_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "personnel_behavior_survey_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_behavior_survey_targets" ADD CONSTRAINT "personnel_behavior_survey_targets_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "personnel_behavior_survey_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_behavior_survey_respondents" ADD CONSTRAINT "personnel_behavior_survey_respondents_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "personnel_behavior_survey_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_behavior_survey_responses" ADD CONSTRAINT "personnel_behavior_survey_responses_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "personnel_behavior_survey_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_behavior_survey_answers" ADD CONSTRAINT "personnel_behavior_survey_answers_responseId_fkey" FOREIGN KEY ("responseId") REFERENCES "personnel_behavior_survey_responses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "personnel_behavior_survey_answers" ADD CONSTRAINT "personnel_behavior_survey_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "personnel_behavior_survey_questions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "personnel_behavior_survey_campaigns" ADD CONSTRAINT "personnel_behavior_survey_campaigns_status_check" CHECK ("status" IN ('DRAFT', 'ACTIVE', 'CLOSED'));
ALTER TABLE "personnel_behavior_survey_questions" ADD CONSTRAINT "personnel_behavior_survey_questions_section_check" CHECK ("sectionCode" IN ('RESPECT', 'TEAMWORK', 'ACCOUNTABILITY', 'COMMUNICATION', 'LEARNING', 'WORKPLACE_STANDARD'));
ALTER TABLE "personnel_behavior_survey_responses" ADD CONSTRAINT "personnel_behavior_survey_responses_status_check" CHECK ("status" IN ('DRAFT', 'FINAL'));
ALTER TABLE "personnel_behavior_survey_answers" ADD CONSTRAINT "personnel_behavior_survey_answers_score_check" CHECK ("numericScore" IS NULL OR "numericScore" IN (0, 25, 50, 75, 100));
