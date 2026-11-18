/** Strip only PostgreSQL's single matched outer psql restriction wrapper.
 * All function bodies, triggers, constraints and other schema SQL remain exact. */
export function canonicalRecoverySchema(output: string) {
  let normalized = output.replace(/\r\n/g, '\n');
  const preamble = normalized.indexOf('\nSET statement_timeout = ');
  if (normalized.startsWith('--\n-- PostgreSQL database dump\n--\n') && preamble !== -1) {
    normalized = normalized.slice(0, preamble).replace(/^-- Dumped (?:from database|by pg_dump) version [^\n]*\n/gm, '')
      + normalized.slice(preamble);
  }
  const directives = [...normalized.matchAll(/^\\(unrestrict|restrict) ([A-Za-z0-9_]+)\n/gm)];
  if (directives.length === 2 && directives[0][1] === 'restrict' && directives[1][1] === 'unrestrict'
    && directives[0][2] === directives[1][2]) {
    return normalized.replace(directives[0][0], '').replace(directives[1][0], '');
  }
  return normalized;
}

export const equivalentRecoverySchemas = (left: string, right: string) => canonicalRecoverySchema(left) === canonicalRecoverySchema(right);

export type RecoveryDatabaseSemantics = {
  encoding: string; collate: string; ctype: string; provider: 'c' | 'i'; icuLocale: string | null;
  collationVersion: string | null; actualCollationVersion: string | null; serverVersionNum: number;
};

export const recoveryDatabaseSemanticsSql = `SELECT pg_encoding_to_char(d.encoding) AS encoding,
  d.datcollate AS collate, d.datctype AS ctype, d.datlocprovider AS provider, d.daticulocale AS "icuLocale",
  d.datcollversion AS "collationVersion", pg_database_collation_actual_version(d.oid) AS "actualCollationVersion",
  current_setting('server_version_num')::integer AS "serverVersionNum"
  FROM pg_database d WHERE d.datname = current_database()`;
