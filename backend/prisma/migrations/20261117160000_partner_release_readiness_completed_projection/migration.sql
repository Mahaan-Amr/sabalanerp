-- Publish only the identity of a Partner publication whose protected deployment
-- actually completed and passed every mandatory RELEASE gate.
CREATE VIEW public.partner_release_readiness_completed WITH (security_barrier = true) AS
SELECT publication.id
FROM public.partner_release_readiness_publications AS publication
JOIN public.deployment_operations AS deployment
  ON deployment.id = publication."deploymentId" AND deployment.id = publication.id
  AND deployment."releaseId" = publication."releaseId" AND deployment."targetCommit" = publication."targetCommit"
WHERE deployment.phase = 'COMPLETED' AND deployment."completedAt" IS NOT NULL
  AND deployment."reportJson" -> 'format' = '"sabalan-deployment-report"'::jsonb
  AND deployment."reportJson" -> 'version' = '1'::jsonb
  AND deployment."reportJson" -> 'mode' = '"RELEASE"'::jsonb
  AND deployment."reportJson" -> 'deploymentId' = to_jsonb(deployment.id)
  AND deployment."reportJson" -> 'releaseId' = to_jsonb(deployment."releaseId")
  AND deployment."reportJson" -> 'targetCommit' = to_jsonb(deployment."targetCommit")
  AND (
    SELECT bool_and(gate -> 'passed' IS NOT DISTINCT FROM 'true'::jsonb)
      AND array_agg(gate ->> 'name' ORDER BY (gate ->> 'name') COLLATE "C") = ARRAY[
        'accounting-storage', 'backend-readiness', 'checkpoint-manifest', 'contract-financial-evidence',
        'contracts-storage', 'database-connection-capacity', 'database-file-references', 'dispatch-storage',
        'frontend-health', 'hr-storage', 'inquiry-health', 'inquiry-sqlite-integrity', 'migration-history',
        'nginx-health', 'performance-export-storage', 'postgres-query-and-isolated-write',
        'shipment-statement-runtime-state', 'support-storage', 'uploads-storage'
      ]
    FROM jsonb_array_elements(CASE WHEN jsonb_typeof(deployment."reportJson" -> 'gates') = 'array'
      THEN deployment."reportJson" -> 'gates' ELSE '[]'::jsonb END) AS gates(gate)
  );

REVOKE ALL ON public.partner_release_readiness_completed FROM PUBLIC;

DO $grant$
BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'sabalan_application_runtime') THEN
    GRANT SELECT ON public.partner_release_readiness_completed TO sabalan_application_runtime;
  END IF;
END;
$grant$;
