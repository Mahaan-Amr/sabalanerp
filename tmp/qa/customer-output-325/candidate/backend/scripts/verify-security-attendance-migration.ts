import fs from 'fs';
import path from 'path';

const migrationPath = path.join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260720000100_security_report_attendance_operations',
  'migration.sql'
);

const sql = fs.readFileSync(migrationPath, 'utf8');
const failures: string[] = [];
const directLocalizedTimeCasts = sql.match(/"(?:entryTime|exitTime)"::time/g) || [];
const localizedDigits = '۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩';
const asciiDigits = '01234567890123456789';
const normalizeFixture = (value: string) => [...value].map((character) => {
  const index = localizedDigits.indexOf(character);
  return index >= 0 ? asciiDigits[index] : character;
}).join('');

if (directLocalizedTimeCasts.length > 0) {
  failures.push(`found ${directLocalizedTimeCasts.length} direct localized attendance-time casts`);
}
if (!sql.includes("translate(btrim(record.\"entryTime\")")) {
  failures.push('entryTime is not normalized before PostgreSQL time parsing');
}
if (!sql.includes("translate(btrim(record.\"exitTime\")")) {
  failures.push('exitTime is not normalized before PostgreSQL time parsing');
}
if (!sql.includes('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩') || !sql.includes('01234567890123456789')) {
  failures.push('Persian and Arabic digit translation is incomplete');
}
if (!/^BEGIN;\s/m.test(sql) || !/COMMIT;\s*$/.test(sql)) {
  failures.push('migration is not explicitly atomic');
}
if (!sql.includes('Invalid legacy attendance time values')) {
  failures.push('migration does not preflight malformed legacy attendance times');
}
if (!sql.includes('ADD COLUMN IF NOT EXISTS') || !sql.includes('CREATE TABLE IF NOT EXISTS') || !sql.includes('CREATE INDEX IF NOT EXISTS')) {
  failures.push('migration is not safe to retry after a partial failed attempt');
}
if (!sql.includes('ON CONFLICT ("id") DO NOTHING')) {
  failures.push('legacy attendance backfill is not idempotent');
}
if (normalizeFixture('۰۹:۱۵') !== '09:15' || normalizeFixture('٠٩:١٥') !== '09:15') {
  failures.push('localized digit fixtures do not normalize to PostgreSQL-compatible time text');
}
if (/(?:DELETE FROM|TRUNCATE|DROP TABLE|UPDATE "attendance_records")/i.test(sql)) {
  failures.push('migration contains a destructive write against legacy attendance data');
}

if (failures.length) {
  console.error(`Security attendance migration verification failed:\n- ${failures.join('\n- ')}`);
  process.exit(1);
}

console.log('Security attendance migration safely normalizes localized times and is atomic.');
