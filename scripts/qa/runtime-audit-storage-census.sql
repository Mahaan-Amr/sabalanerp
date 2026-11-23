BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '5s';
SET LOCAL lock_timeout = '250ms';

WITH tracked(name) AS (
  VALUES
    ('effective_authorization_audit'),
    ('accounting_audit_logs'),
    ('accounting_ledger_audit_entries'),
    ('accounting_replacement_audit_entries'),
    ('accounting_supply_chain_command_audits'),
    ('partner_operations_control_events'),
    ('partner_profile_events'),
    ('partner_inquiry_events'),
    ('partner_case_events'),
    ('recovery_audit_events')
)
SELECT
  (SELECT clock_timestamp()) AS observed_at,
  (SELECT stats_reset FROM pg_stat_database WHERE datname = current_database()) AS stats_reset_at,
  tracked.name AS relation,
  stats.n_live_tup AS estimated_live_rows,
  stats.n_tup_ins AS inserted_rows_since_stats_reset,
  pg_table_size(stats.relid) AS table_bytes,
  pg_indexes_size(stats.relid) AS index_bytes,
  pg_total_relation_size(stats.relid) AS total_relation_bytes
FROM tracked
LEFT JOIN pg_stat_user_tables stats
  ON stats.schemaname = 'public' AND stats.relname = tracked.name
ORDER BY tracked.name;

COMMIT;
