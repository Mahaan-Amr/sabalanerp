BEGIN READ ONLY;
SET LOCAL statement_timeout='8s';
SELECT count(*) AS sessions, max(octet_length(recovery::text)) AS largest_recovery_bytes, sum(octet_length(recovery::text)) AS all_recovery_bytes FROM sales_contract_edit_sessions;
SELECT left(md5(id),12) AS record_fingerprint,octet_length(recovery::text) AS recovery_bytes, CASE WHEN jsonb_typeof(recovery->'validatedSnapshots')='array' THEN jsonb_array_length(recovery->'validatedSnapshots') ELSE 0 END AS snapshots FROM sales_contract_edit_sessions ORDER BY recovery_bytes DESC LIMIT 6;
SELECT operation,count(*),max(octet_length(outcome::text)) AS largest_bytes,sum(octet_length(outcome::text)) AS total_bytes FROM partner_command_outcomes GROUP BY operation ORDER BY total_bytes DESC LIMIT 6;
SELECT count(*) AS pending_events FROM partner_inquiry_events e LEFT JOIN partner_inquiry_notification_deliveries d ON d."eventId"=e.id WHERE d."handledAt" IS NULL;
ROLLBACK;
