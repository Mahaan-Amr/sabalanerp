ALTER TABLE "performance_safety_pauses" ADD COLUMN "sourceIncidentId" TEXT;
CREATE UNIQUE INDEX "performance_safety_pauses_sourceIncidentId_key" ON "performance_safety_pauses"("sourceIncidentId");

CREATE TABLE "performance_operational_routes" (
  "id" TEXT NOT NULL,
  "routeKey" TEXT NOT NULL,
  "recipientUserId" TEXT NOT NULL,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "configuredById" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_operational_routes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_operational_routes_routeKey_key" ON "performance_operational_routes"("routeKey");
CREATE INDEX "performance_operational_routes_recipientUserId_verifiedAt_idx" ON "performance_operational_routes"("recipientUserId", "verifiedAt");

CREATE TABLE "performance_operational_heartbeats" (
  "id" TEXT NOT NULL,
  "component" TEXT NOT NULL,
  "observedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_operational_heartbeats_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_operational_heartbeats_component_key" ON "performance_operational_heartbeats"("component");
CREATE INDEX "performance_operational_heartbeats_observedAt_idx" ON "performance_operational_heartbeats"("observedAt");

CREATE TABLE "performance_operational_windows" (
  "id" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "cohortVersionId" TEXT,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "windowEnd" TIMESTAMP(3) NOT NULL,
  "numerator" INTEGER NOT NULL,
  "denominator" INTEGER NOT NULL,
  "p95Ms" INTEGER,
  "p99Ms" INTEGER,
  "maxAgeSeconds" INTEGER,
  "baselineBps" INTEGER,
  "retryExhausted" BOOLEAN NOT NULL DEFAULT false,
  "measuredBps" INTEGER,
  "thresholdState" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_operational_windows_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_operational_windows_identity_key" ON "performance_operational_windows"("metricKey", "scope", "cohortVersionId", "windowStart", "windowEnd");
CREATE INDEX "performance_operational_windows_metric_scope_end_idx" ON "performance_operational_windows"("metricKey", "scope", "cohortVersionId", "windowEnd");
CREATE INDEX "performance_operational_windows_createdAt_idx" ON "performance_operational_windows"("createdAt");

CREATE TABLE "performance_operational_request_observations" (
  "id" TEXT NOT NULL,
  "metricKey" TEXT NOT NULL,
  "durationMs" INTEGER NOT NULL,
  "responseStatus" INTEGER NOT NULL,
  "authorizationDecision" TEXT NOT NULL,
  "timedOut" BOOLEAN NOT NULL DEFAULT false,
  "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_operational_request_observations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_operational_request_observations_observed_metric_idx" ON "performance_operational_request_observations"("observedAt", "metricKey");

CREATE TABLE "performance_operational_incidents" (
  "id" TEXT NOT NULL,
  "deduplicationKey" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "metricKey" TEXT,
  "routeKey" TEXT NOT NULL,
  "scope" TEXT NOT NULL,
  "cohortVersionId" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "thresholdCode" TEXT NOT NULL,
  "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
  "firstObservedAt" TIMESTAMP(3) NOT NULL,
  "lastObservedAt" TIMESTAMP(3) NOT NULL,
  "acknowledgeDueAt" TIMESTAMP(3) NOT NULL,
  "containmentDueAt" TIMESTAMP(3),
  "escalationDueAt" TIMESTAMP(3),
  "acknowledgedAt" TIMESTAMP(3),
  "containedAt" TIMESTAMP(3),
  "escalatedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "safetyPauseId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "performance_operational_incidents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "performance_operational_incidents_deduplicationKey_key" ON "performance_operational_incidents"("deduplicationKey");
CREATE UNIQUE INDEX "performance_operational_incidents_safetyPauseId_key" ON "performance_operational_incidents"("safetyPauseId");
CREATE INDEX "performance_operational_incidents_status_severity_first_idx" ON "performance_operational_incidents"("status", "severity", "firstObservedAt");
CREATE INDEX "performance_operational_incidents_scope_cohort_status_idx" ON "performance_operational_incidents"("scope", "cohortVersionId", "status");

CREATE TABLE "performance_operational_incident_evidence" (
  "id" TEXT NOT NULL,
  "incidentId" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "reasonCode" TEXT NOT NULL,
  "evidenceHash" TEXT NOT NULL,
  "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "performance_operational_incident_evidence_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "performance_operational_incident_evidence_incident_recorded_idx" ON "performance_operational_incident_evidence"("incidentId", "recordedAt");
