-- Version 1 catalog inventory for the fail-closed application runtime role.
-- Run on an isolated restored database with psql -X -A -t -v ON_ERROR_STOP=1.
-- This is read-only and does not authorize any grant.
BEGIN READ ONLY;
SELECT jsonb_build_object(
  'version', 1,
  'database', current_database(),
  'objects', (
    SELECT jsonb_agg(object_row ORDER BY object_row->>'kind', object_row->>'identity')
    FROM (
      SELECT jsonb_build_object('kind', CASE c.relkind WHEN 'S' THEN 'sequence' ELSE 'relation' END,
        'identity', format('%I.%I', n.nspname, c.relname),
        'relationKind', c.relkind,
        'owner', pg_get_userbyid(c.relowner),
        'review', 'UNREVIEWED', 'grants', '[]'::jsonb) AS object_row
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S')
      UNION ALL
      SELECT jsonb_build_object('kind', 'function',
        'identity', p.oid::regprocedure::text,
        'securityDefiner', p.prosecdef,
        'owner', pg_get_userbyid(p.proowner),
        'review', 'UNREVIEWED', 'grants', '[]'::jsonb)
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ) AS inventory
  )
)::text;
ROLLBACK;
